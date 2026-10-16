import { db } from '../db/index.js';
import { randomCallSessions, callRatings, userCallPreferences, users } from '../db/schema.js';
import { eq, desc, or, and, sql } from 'drizzle-orm';

// ---------------- Types

export interface CallHistoryEntry {
    id: string;
    partnerId: string;
    partnerUsername: string;
    partnerDisplayName?: string;
    partnerAvatarUrl?: string;
    matchedLanguage: string | null;
    startedAt: Date;
    endedAt: Date | null;
    durationSeconds: number | null;
    endReason: string | null;
    rating?: number | null;
}

export interface UserCallStats {
    totalCalls: number;
    totalMinutes: number;
    averageCallDuration: number;
    languagesUsed: string[];
    callsThisWeek: number;
    callsThisMonth: number;
    longestCallMinutes: number;
}

// -------------------- Call Session Recording 


// Record a new call session to the database
export async function recordCallStart(
    sessionId: string,
    user1Id: string,
    user2Id: string,
    matchedLanguage: string | null
): Promise<void> {
    try {
        await db.insert(randomCallSessions).values({
            id: sessionId,
            user1Id,
            user2Id,
            matchedLanguage,
            startedAt: new Date(),
        });
        console.log(`[CallHistory] Recorded call start: ${sessionId}`);
    } catch (error) {
        console.error('[CallHistory] Error recording call start:', error);
    }
}

// Update call session when connection is established
export async function recordCallConnected(sessionId: string): Promise<void> {
    try {
        await db.update(randomCallSessions)
            .set({ connectedAt: new Date() })
            .where(eq(randomCallSessions.id, sessionId));
        console.log(`[CallHistory] Recorded call connected: ${sessionId}`);
    } catch (error) {
        console.error('[CallHistory] Error recording call connected:', error);
    }
}


// Record call end and calculate duration
export async function recordCallEnd(
    sessionId: string,
    endReason: string
): Promise<void> {
    try {
        // Get the session to calculate duration
        const [session] = await db.select()
            .from(randomCallSessions)
            .where(eq(randomCallSessions.id, sessionId))
            .limit(1);

        if (!session) {
            console.warn(`[CallHistory] Session not found: ${sessionId}`);
            return;
        }

        const endedAt = new Date();
        const startTime = session.connectedAt || session.startedAt;
        const durationSeconds = Math.floor((endedAt.getTime() - startTime.getTime()) / 1000);

        await db.update(randomCallSessions)
            .set({
                endedAt,
                durationSeconds,
                endReason,
            })
            .where(eq(randomCallSessions.id, sessionId));

        // Update user stats
        await updateUserStats(session.user1Id, durationSeconds);
        await updateUserStats(session.user2Id, durationSeconds);

        console.log(`[CallHistory] Recorded call end: ${sessionId}, duration: ${durationSeconds}s`);
    } catch (error) {
        console.error('[CallHistory] Error recording call end:', error);
    }
}

// Update user's aggregate call stats
async function updateUserStats(userId: string, durationSeconds: number): Promise<void> {
    const durationMinutes = Math.ceil(durationSeconds / 60);

    try {
        // Upsert user call preferences with updated stats
        await db.insert(userCallPreferences)
            .values({
                userId,
                totalCallsCompleted: 1,
                totalCallMinutes: durationMinutes,
            })
            .onConflictDoUpdate({
                target: userCallPreferences.userId,
                set: {
                    totalCallsCompleted: sql`${userCallPreferences.totalCallsCompleted} + 1`,
                    totalCallMinutes: sql`${userCallPreferences.totalCallMinutes} + ${durationMinutes}`,
                    updatedAt: new Date(),
                },
            });
    } catch (error) {
        console.error('[CallHistory] Error updating user stats:', error);
    }
}

// -------------------- Call History Retrieval 

// Get call history for a user
export async function getCallHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
): Promise<CallHistoryEntry[]> {
    try {
        const sessions = await db.select({
            id: randomCallSessions.id,
            user1Id: randomCallSessions.user1Id,
            user2Id: randomCallSessions.user2Id,
            matchedLanguage: randomCallSessions.matchedLanguage,
            startedAt: randomCallSessions.startedAt,
            endedAt: randomCallSessions.endedAt,
            durationSeconds: randomCallSessions.durationSeconds,
            endReason: randomCallSessions.endReason,
        })
            .from(randomCallSessions)
            .where(
                or(
                    eq(randomCallSessions.user1Id, userId),
                    eq(randomCallSessions.user2Id, userId)
                )
            )
            .orderBy(desc(randomCallSessions.startedAt))
            .limit(limit)
            .offset(offset);

        // Enrich with partner info
        const history: CallHistoryEntry[] = [];

        for (const session of sessions) {
            const partnerId = session.user1Id === userId ? session.user2Id : session.user1Id;

            // Get partner info
            const [partner] = await db.select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
            })
                .from(users)
                .where(eq(users.id, partnerId))
                .limit(1);

            // Get rating if exists
            const [rating] = await db.select({ rating: callRatings.rating })
                .from(callRatings)
                .where(
                    and(
                        eq(callRatings.sessionId, session.id),
                        eq(callRatings.ratingFromUserId, userId)
                    )
                )
                .limit(1);

            history.push({
                id: session.id,
                partnerId,
                partnerUsername: partner?.username || 'Unknown',
                partnerDisplayName: partner?.displayName || undefined,
                partnerAvatarUrl: partner?.avatarUrl || undefined,
                matchedLanguage: session.matchedLanguage,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                durationSeconds: session.durationSeconds,
                endReason: session.endReason,
                rating: rating?.rating || null,
            });
        }

        return history;
    } catch (error) {
        console.error('[CallHistory] Error getting call history:', error);
        return [];
    }
}

// Get user's aggregate call stats
export async function getUserCallStats(userId: string): Promise<UserCallStats> {
    try {
        // Get from preferences table first
        const [prefs] = await db.select({
            totalCalls: userCallPreferences.totalCallsCompleted,
            totalMinutes: userCallPreferences.totalCallMinutes,
        })
            .from(userCallPreferences)
            .where(eq(userCallPreferences.userId, userId))
            .limit(1);

        // Calculate additional stats from sessions
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Get unique languages used
        const languageSessions = await db.selectDistinct({ lang: randomCallSessions.matchedLanguage })
            .from(randomCallSessions)
            .where(
                and(
                    or(
                        eq(randomCallSessions.user1Id, userId),
                        eq(randomCallSessions.user2Id, userId)
                    ),
                    sql`${randomCallSessions.matchedLanguage} IS NOT NULL`
                )
            );

        // Count recent calls
        const recentCalls = await db.select({
            callsThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${randomCallSessions.startedAt} >= ${oneWeekAgo})`,
            callsThisMonth: sql<number>`COUNT(*) FILTER (WHERE ${randomCallSessions.startedAt} >= ${oneMonthAgo})`,
            longestCall: sql<number>`MAX(${randomCallSessions.durationSeconds})`,
        })
            .from(randomCallSessions)
            .where(
                or(
                    eq(randomCallSessions.user1Id, userId),
                    eq(randomCallSessions.user2Id, userId)
                )
            );

        const totalCalls = prefs?.totalCalls || 0;
        const totalMinutes = prefs?.totalMinutes || 0;

        return {
            totalCalls,
            totalMinutes,
            averageCallDuration: totalCalls > 0 ? Math.round(totalMinutes / totalCalls) : 0,
            languagesUsed: languageSessions.map(s => s.lang).filter(Boolean) as string[],
            callsThisWeek: Number(recentCalls[0]?.callsThisWeek) || 0,
            callsThisMonth: Number(recentCalls[0]?.callsThisMonth) || 0,
            longestCallMinutes: Math.ceil((Number(recentCalls[0]?.longestCall) || 0) / 60),
        };
    } catch (error) {
        console.error('[CallHistory] Error getting user stats:', error);
        return {
            totalCalls: 0,
            totalMinutes: 0,
            averageCallDuration: 0,
            languagesUsed: [],
            callsThisWeek: 0,
            callsThisMonth: 0,
            longestCallMinutes: 0,
        };
    }
}

// Save a call rating
export async function saveCallRating(
    sessionId: string,
    userId: string,
    rating: number,
    feedback?: string
): Promise<void> {
    try {
        await db.insert(callRatings).values({
            sessionId,
            ratingFromUserId: userId,
            rating,
            feedback,
        }).onConflictDoNothing();
        console.log(`[CallHistory] Saved rating for session ${sessionId}: ${rating}`);
    } catch (error) {
        console.error('[CallHistory] Error saving rating:', error);
    }
}
