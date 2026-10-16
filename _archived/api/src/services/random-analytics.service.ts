import { db } from '../db/index.js';
import { randomCallSessions, callRatings, userCallPreferences } from '../db/schema.js';
import { eq, and, or, desc, sql } from 'drizzle-orm';

// ------------------ Types 

interface CallSessionRecord {
    user1Id: string;
    user2Id: string;
    matchedLanguage: string | null;
    startedAt: Date;
    connectedAt: Date | null;
    endedAt: Date | null;
    durationSeconds: number | null;
    connectionType: string | null;
    endReason: string | null;
}

interface CallRatingRecord {
    sessionId: string;
    ratingFromUserId: string;
    rating: 1 | 2 | 3 | 4 | 5;
    feedback?: string;
    reportedAsAbuse?: boolean;
    reportReason?: string;
}

// ------------------ Batch Queue 

const sessionBatch: CallSessionRecord[] = [];
const ratingBatch: CallRatingRecord[] = [];
let flushInterval: NodeJS.Timeout | null = null;


// Start the batch flush interval
export function startBatchFlush(intervalMs: number = 30000) {
    if (flushInterval) {
        clearInterval(flushInterval);
    }

    flushInterval = setInterval(async () => {
        await flushSessions();
        await flushRatings();
    }, intervalMs);

    console.log('[Analytics] Batch flush started');
}


// Stop the batch flush interval
export function stopBatchFlush() {
    if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
    }
    console.log('[Analytics] Batch flush stopped');
}

// ------------------ Session Recording 

// Queue a call session for persistence
export function queueSessionRecord(record: CallSessionRecord): void {
    sessionBatch.push(record);
    console.log(`[Analytics] Session queued for recording (batch size: ${sessionBatch.length})`);
}

// Flush queued sessions to database
async function flushSessions(): Promise<void> {
    if (sessionBatch.length === 0) return;

    const toFlush = [...sessionBatch];
    sessionBatch.length = 0;

    try {
        await db.insert(randomCallSessions).values(
            toFlush.map(s => ({
                user1Id: s.user1Id,
                user2Id: s.user2Id,
                matchedLanguage: s.matchedLanguage,
                startedAt: s.startedAt,
                connectedAt: s.connectedAt,
                endedAt: s.endedAt,
                durationSeconds: s.durationSeconds,
                connectionType: s.connectionType,
                endReason: s.endReason,
            }))
        );
        console.log(`[Analytics] Flushed ${toFlush.length} sessions to database`);
    } catch (error) {
        console.error('[Analytics] Error flushing sessions:', error);
        // Re-queue failed records
        sessionBatch.push(...toFlush);
    }
}
// ------------------ Rating Recording 

// Queue a rating for persistence
export function queueRatingRecord(record: CallRatingRecord): void {
    ratingBatch.push(record);
}

// Flush queued ratings to database
async function flushRatings(): Promise<void> {
    if (ratingBatch.length === 0) return;

    const toFlush = [...ratingBatch];
    ratingBatch.length = 0;

    try {
        await db.insert(callRatings).values(
            toFlush.map(r => ({
                sessionId: r.sessionId,
                ratingFromUserId: r.ratingFromUserId,
                rating: r.rating,
                feedback: r.feedback,
                reportedAsAbuse: r.reportedAsAbuse ?? false,
                reportReason: r.reportReason,
            }))
        );
        console.log(`[Analytics] Flushed ${toFlush.length} ratings to database`);
    } catch (error) {
        console.error('[Analytics] Error flushing ratings:', error);
        // Re-queue failed records
        ratingBatch.push(...toFlush);
    }
}

// ------------------ User Preferences 

// Get user call preferences
export async function getUserPreferences(userId: string) {
    const [prefs] = await db
        .select()
        .from(userCallPreferences)
        .where(eq(userCallPreferences.userId, userId))
        .limit(1);

    return prefs;
}

// Update user call preferences
export async function updateUserPreferences(
    userId: string,
    updates: {
        preferredLanguages?: string[];
        languagePreferenceEnabled?: boolean;
        blockedUsers?: string[];
    }
) {
    const existing = await getUserPreferences(userId);

    if (existing) {
        await db
            .update(userCallPreferences)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(userCallPreferences.userId, userId));
    } else {
        await db.insert(userCallPreferences).values({
            userId,
            preferredLanguages: updates.preferredLanguages ?? [],
            languagePreferenceEnabled: updates.languagePreferenceEnabled ?? false,
            blockedUsers: updates.blockedUsers ?? [],
        });
    }
}


// Increment user call stats
export async function incrementUserCallStats(
    userId: string,
    callMinutes: number
) {
    const existing = await getUserPreferences(userId);

    if (existing) {
        await db
            .update(userCallPreferences)
            .set({
                totalCallsCompleted: sql`${userCallPreferences.totalCallsCompleted} + 1`,
                totalCallMinutes: sql`${userCallPreferences.totalCallMinutes} + ${callMinutes}`,
                updatedAt: new Date(),
            })
            .where(eq(userCallPreferences.userId, userId));
    } else {
        await db.insert(userCallPreferences).values({
            userId,
            totalCallsCompleted: 1,
            totalCallMinutes: callMinutes,
        });
    }
}

// --------------------- Analytics Queries 

// Get user's call history
export async function getUserCallHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
) {
    return db
        .select()
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
}

// Get call statistics for a user
export async function getUserCallStats(userId: string) {
    const prefs = await getUserPreferences(userId);

    return {
        totalCallsCompleted: prefs?.totalCallsCompleted ?? 0,
        totalCallMinutes: prefs?.totalCallMinutes ?? 0,
        preferredLanguages: prefs?.preferredLanguages ?? [],
        languagePreferenceEnabled: prefs?.languagePreferenceEnabled ?? false,
    };
}

// Get global call statistics
export async function getGlobalCallStats() {
    const result = await db
        .select({
            totalSessions: sql<number>`COUNT(*)`,
            totalMinutes: sql<number>`COALESCE(SUM(duration_seconds) / 60, 0)`,
            avgDuration: sql<number>`COALESCE(AVG(duration_seconds), 0)`,
        })
        .from(randomCallSessions);

    return result[0] ?? {
        totalSessions: 0,
        totalMinutes: 0,
        avgDuration: 0,
    };
}
