/**
 * Random Call Service
 * 
 * Handles random call matching, queue management, and P2P signaling coordination.
 * Uses Redis for real-time queue management and session tracking.
 * 
 * Architecture:
 * - P2P WebRTC for 1-on-1 calls (no Mediasoup overhead)
 * - FIFO queue for true random matching
 * - Optional language preferences with global fallback
 * - Real-time stats broadcasting
 */

import { v4 as uuidv4 } from 'uuid';
import { redis, CACHE_TTL } from '../db/redis.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type {
    RandomCallPreferences,
    RandomCallSession,
    RandomCallStats,
    RandomCallPartner,
} from '@free2talk/shared';

// ----------------------- Redis Key Definitions 

export const RANDOM_KEYS = {
    // Global queue for random matching (all users)
    QUEUE_GLOBAL: 'random:queue:global',
    // Language-specific queues for preferred matching
    QUEUE_LANGUAGE: (lang: string) => `random:queue:lang:${lang.toLowerCase()}`,
    // User's queue entry timestamp
    QUEUE_TIME: (userId: string) => `random:queue_time:${userId}`,
    // User's current preferences
    USER_PREFERENCES: (userId: string) => `random:preferences:${userId}`,
    // Active call session data
    ACTIVE_CALL: (sessionId: string) => `random:call:${sessionId}`,
    // User's current call session ID
    USER_CALL: (userId: string) => `random:user_call:${userId}`,
    // Set of all active call session IDs
    ACTIVE_CALLS_SET: 'random:active_calls',
    // Global stats hash
    STATS: 'random:stats',
    // Set of all users currently in random feature
    ACTIVE_USERS: 'random:active_users',
    // Blocked user pairs (to avoid re-matching)
    BLOCKED_PAIR: (user1: string, user2: string) => {
        const sorted = [user1, user2].sort();
        return `random:blocked:${sorted[0]}:${sorted[1]}`;
    },
    // User's blocked list
    USER_BLOCKED: (userId: string) => `random:user_blocked:${userId}`,
} as const;



// ----------------------- Types 

interface QueuedUser {
    userId: string;
    preferences: RandomCallPreferences;
    queuedAt: number;
    socketId: string;
}

interface ActiveCallData {
    sessionId: string;
    user1Id: string;
    user2Id: string;
    user1SocketId: string;
    user2SocketId: string;
    matchedLanguage: string | null;
    startedAt: number;
    connectedAt: number | null;
    state: 'connecting' | 'connected' | 'ended';
}

// ----------------------- Queue Management 


// Add user to the matching queue
export async function addToQueue(
    userId: string,
    socketId: string,
    preferences: RandomCallPreferences = { preferenceEnabled: false }
): Promise<{ success: boolean; position?: number; error?: string }> {
    try {
        // Check if user is already in a call
        const existingCall = await redis.get(RANDOM_KEYS.USER_CALL(userId));
        if (existingCall) {
            return { success: false, error: 'Already in a call' };
        }

        // Check if user is already in queue
        const existingQueueTime = await redis.get(RANDOM_KEYS.QUEUE_TIME(userId));
        if (existingQueueTime) {
            return { success: false, error: 'Already in queue' };
        }

        const queuedUser: QueuedUser = {
            userId,
            preferences,
            queuedAt: Date.now(),
            socketId,
        };

        // Store user preferences and queue time
        await redis.setEx(
            RANDOM_KEYS.USER_PREFERENCES(userId),
            CACHE_TTL.MEDIUM,
            JSON.stringify(preferences)
        );
        await redis.setEx(
            RANDOM_KEYS.QUEUE_TIME(userId),
            CACHE_TTL.MEDIUM,
            JSON.stringify(queuedUser)
        );

        // Add to global queue (always)
        await redis.rPush(RANDOM_KEYS.QUEUE_GLOBAL, userId);

        // Add to language-specific queues if preferences enabled
        if (preferences.preferenceEnabled && preferences.languages?.length) {
            for (const lang of preferences.languages) {
                // Normalize to lowercase for consistent matching
                await redis.rPush(RANDOM_KEYS.QUEUE_LANGUAGE(lang.toLowerCase()), userId);
            }
        }

        // Add to active users set
        await redis.sAdd(RANDOM_KEYS.ACTIVE_USERS, userId);

        // Get queue position
        const position = await redis.lPos(RANDOM_KEYS.QUEUE_GLOBAL, userId);

        console.log(`[Random] User ${userId} added to queue at position ${position}`);

        return { success: true, position: position ?? 0 };
    } catch (error) {
        console.error('[Random] Error adding to queue:', error);
        return { success: false, error: 'Failed to join queue' };
    }
}


// Remove user from all queues
export async function removeFromQueue(userId: string): Promise<void> {
    try {
        // Get user preferences to know which language queues to remove from
        const prefData = await redis.get(RANDOM_KEYS.USER_PREFERENCES(userId));
        const preferences: RandomCallPreferences = prefData
            ? JSON.parse(prefData)
            : { preferenceEnabled: false };

        // Remove from global queue
        await redis.lRem(RANDOM_KEYS.QUEUE_GLOBAL, 0, userId);

        // Remove from language queues
        if (preferences.preferenceEnabled && preferences.languages?.length) {
            for (const lang of preferences.languages) {
                // Normalize to lowercase for consistent matching
                await redis.lRem(RANDOM_KEYS.QUEUE_LANGUAGE(lang.toLowerCase()), 0, userId);
            }
        }

        // Clean up user data
        await redis.del(RANDOM_KEYS.QUEUE_TIME(userId));
        await redis.del(RANDOM_KEYS.USER_PREFERENCES(userId));

        // Check if user is in a call - if not, remove from active users
        const inCall = await redis.get(RANDOM_KEYS.USER_CALL(userId));
        if (!inCall) {
            await redis.sRem(RANDOM_KEYS.ACTIVE_USERS, userId);
        }

        console.log(`[Random] User ${userId} removed from queue`);
    } catch (error) {
        console.error('[Random] Error removing from queue:', error);
    }
}

// Check if user is in queue
export async function isInQueue(userId: string): Promise<boolean> {
    const queueTime = await redis.get(RANDOM_KEYS.QUEUE_TIME(userId));
    return queueTime !== null;
}

// ----------------------- Matching Engine (OPTIMIZED)


/**
 * OPTIMIZED matching algorithm
 * 
 * Old approach (O(n²)):
 * - For each user in queue, scan all users in queue
 * - Result: n² comparisons
 * 
 * New approach (O(n)):
 * - Pop users from front of queue
 * - Try to match them
 * - If no match found, add back to end of queue
 * - Result: O(n) per cycle, max 100 iterations per call
 */

// Find a match for the given user using queue-pop approach
export async function findMatchOptimized(userId: string): Promise<{
    matchedUserId: string | null;
    matchedLanguage: string | null;
}> {
    try {
        // Get user preferences
        const prefData = await redis.get(RANDOM_KEYS.USER_PREFERENCES(userId));
        const preferences: RandomCallPreferences = prefData
            ? JSON.parse(prefData)
            : { preferenceEnabled: false };

        // Get user's blocked list
        const blockedUsers = await redis.sMembers(RANDOM_KEYS.USER_BLOCKED(userId));
        const blockedSet = new Set(blockedUsers);

        // 1. Try language preference queues first (if enabled)
        if (preferences.preferenceEnabled && preferences.languages?.length) {
            for (const lang of preferences.languages) {
                // ✨ Pop from front instead of scanning all
                const candidateId = await redis.lPop(RANDOM_KEYS.QUEUE_LANGUAGE(lang));

                if (candidateId && candidateId !== userId && !blockedSet.has(candidateId)) {
                    // Check if candidate is also looking for this language
                    const candidatePrefData = await redis.get(RANDOM_KEYS.USER_PREFERENCES(candidateId));
                    if (candidatePrefData) {
                        const candidatePref: RandomCallPreferences = JSON.parse(candidatePrefData);
                        if (
                            candidatePref.preferenceEnabled &&
                            candidatePref.languages?.some(l => l.toLowerCase() === lang.toLowerCase())
                        ) {
                            return { matchedUserId: candidateId, matchedLanguage: lang };
                        }
                    }

                    // Put back if not a match
                    await redis.rPush(RANDOM_KEYS.QUEUE_LANGUAGE(lang), candidateId);
                }
            }
        }

        // 2. Fallback to global queue (true random)
        // ✨ Try up to 10 candidates from global queue
        const maxCandidates = 10;
        for (let i = 0; i < maxCandidates; i++) {
            const candidateId = await redis.lPop(RANDOM_KEYS.QUEUE_GLOBAL);

            if (!candidateId) {
                break; // Queue empty
            }

            if (candidateId === userId) {
                // Skip self
                await redis.rPush(RANDOM_KEYS.QUEUE_GLOBAL, candidateId);
                continue;
            }

            if (blockedSet.has(candidateId)) {
                // Skip blocked users
                await redis.rPush(RANDOM_KEYS.QUEUE_GLOBAL, candidateId);
                continue;
            }

            // Check recently matched pair to avoid immediate rematch
            const recentlyMatched = await redis.get(
                RANDOM_KEYS.BLOCKED_PAIR(userId, candidateId)
            );

            if (!recentlyMatched) {
                return { matchedUserId: candidateId, matchedLanguage: null };
            }

            // Put back and try next
            await redis.rPush(RANDOM_KEYS.QUEUE_GLOBAL, candidateId);
        }

        return { matchedUserId: null, matchedLanguage: null };
    } catch (error) {
        console.error('[Random] Error finding match:', error);
        return { matchedUserId: null, matchedLanguage: null };
    }
}


// Process matching for a specific user (called when user joins queue)
export async function processMatchForUser(
    userId: string,
    getUserSocketId: (userId: string) => string | undefined
): Promise<{
    matched: boolean;
    session?: ActiveCallData;
    user1SocketId?: string;
    user2SocketId?: string;
}> {
    // ✨ Use optimized matching
    const { matchedUserId, matchedLanguage } = await findMatchOptimized(userId);

    if (!matchedUserId) {
        return { matched: false };
    }

    // Get socket IDs for both users
    const user1Data = await redis.get(RANDOM_KEYS.QUEUE_TIME(userId));
    const user2Data = await redis.get(RANDOM_KEYS.QUEUE_TIME(matchedUserId));

    if (!user1Data || !user2Data) {
        return { matched: false };
    }

    const user1: QueuedUser = JSON.parse(user1Data);
    const user2: QueuedUser = JSON.parse(user2Data);

    // Remove from queue
    await removeFromQueue(userId);
    await removeFromQueue(matchedUserId);

    // Create session
    const session = await createCallSession(
        userId,
        user1.socketId,
        matchedUserId,
        user2.socketId,
        matchedLanguage
    );

    return {
        matched: true,
        session,
        user1SocketId: user1.socketId,
        user2SocketId: user2.socketId,
    };
}

// Session Management 

// Create a new call session
export async function createCallSession(
    user1Id: string,
    user1SocketId: string,
    user2Id: string,
    user2SocketId: string,
    matchedLanguage: string | null
): Promise<ActiveCallData> {
    const sessionId = uuidv4();
    const now = Date.now();

    const session: ActiveCallData = {
        sessionId,
        user1Id,
        user2Id,
        user1SocketId,
        user2SocketId,
        matchedLanguage,
        startedAt: now,
        connectedAt: null,
        state: 'connecting',
    };

    // Store session
    await redis.setEx(
        RANDOM_KEYS.ACTIVE_CALL(sessionId),
        CACHE_TTL.VERY_LONG, // 1 hour TTL
        JSON.stringify(session)
    );

    // Link users to session
    await redis.setEx(RANDOM_KEYS.USER_CALL(user1Id), CACHE_TTL.VERY_LONG, sessionId);
    await redis.setEx(RANDOM_KEYS.USER_CALL(user2Id), CACHE_TTL.VERY_LONG, sessionId);

    // Add to active calls set
    await redis.sAdd(RANDOM_KEYS.ACTIVE_CALLS_SET, sessionId);

    // Remove both users from queues
    await removeFromQueue(user1Id);
    await removeFromQueue(user2Id);

    // Keep users in active users set (they're in a call now)
    await redis.sAdd(RANDOM_KEYS.ACTIVE_USERS, user1Id);
    await redis.sAdd(RANDOM_KEYS.ACTIVE_USERS, user2Id);

    // Temporarily block this pair from immediate rematch (1 minute)
    await redis.setEx(
        RANDOM_KEYS.BLOCKED_PAIR(user1Id, user2Id),
        60,
        '1'
    );

    console.log(`[Random] Created call session ${sessionId} for users ${user1Id} <-> ${user2Id}`);

    return session;
}

// Get call session by ID
export async function getCallSession(sessionId: string): Promise<ActiveCallData | null> {
    const data = await redis.get(RANDOM_KEYS.ACTIVE_CALL(sessionId));
    return data ? JSON.parse(data) : null;
}

// Get user's current call session
export async function getUserCallSession(userId: string): Promise<ActiveCallData | null> {
    const sessionId = await redis.get(RANDOM_KEYS.USER_CALL(userId));
    if (!sessionId) return null;
    return getCallSession(sessionId);
}

// Mark call as connected
export async function markCallConnected(sessionId: string): Promise<void> {
    const session = await getCallSession(sessionId);
    if (session) {
        session.connectedAt = Date.now();
        session.state = 'connected';
        await redis.setEx(
            RANDOM_KEYS.ACTIVE_CALL(sessionId),
            CACHE_TTL.VERY_LONG,
            JSON.stringify(session)
        );
        console.log(`[Random] Call ${sessionId} marked as connected`);
    }
}

// End a call session
export async function endCallSession(
    sessionId: string,
    reason: string
): Promise<{ user1Id?: string; user2Id?: string } | null> {
    const session = await getCallSession(sessionId);
    if (!session) return null;

    // Clean up session data
    await redis.del(RANDOM_KEYS.ACTIVE_CALL(sessionId));
    await redis.del(RANDOM_KEYS.USER_CALL(session.user1Id));
    await redis.del(RANDOM_KEYS.USER_CALL(session.user2Id));
    await redis.sRem(RANDOM_KEYS.ACTIVE_CALLS_SET, sessionId);

    // Remove users from active users set
    await redis.sRem(RANDOM_KEYS.ACTIVE_USERS, session.user1Id);
    await redis.sRem(RANDOM_KEYS.ACTIVE_USERS, session.user2Id);

    console.log(`[Random] Call ${sessionId} ended: ${reason}`);

    return { user1Id: session.user1Id, user2Id: session.user2Id };
}


// Get the partner's socket ID in a call
export async function getPartnerSocketId(
    sessionId: string,
    userId: string
): Promise<string | null> {
    const session = await getCallSession(sessionId);
    if (!session) return null;

    if (session.user1Id === userId) {
        return session.user2SocketId;
    } else if (session.user2Id === userId) {
        return session.user1SocketId;
    }
    return null;
}

// Get the partner's user ID in a call
export async function getPartnerId(
    sessionId: string,
    userId: string
): Promise<string | null> {
    const session = await getCallSession(sessionId);
    if (!session) return null;

    if (session.user1Id === userId) {
        return session.user2Id;
    } else if (session.user2Id === userId) {
        return session.user1Id;
    }
    return null;
}

// ------------------- User Info 

// Get user info for matching display
export async function getUserInfo(userId: string): Promise<RandomCallPartner | null> {
    try {
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return null;

        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName ?? undefined,
            avatarUrl: user.avatarUrl ?? undefined,
        };
    } catch (error) {
        console.error('[Random] Error getting user info:', error);
        return null;
    }
}

// ----------------- Stats 

// Get current random call stats
export async function getStats(): Promise<RandomCallStats> {
    try {
        const [activeCallsCount, activeUsersCount, globalQueueLength] = await Promise.all([
            redis.sCard(RANDOM_KEYS.ACTIVE_CALLS_SET),
            redis.sCard(RANDOM_KEYS.ACTIVE_USERS),
            redis.lLen(RANDOM_KEYS.QUEUE_GLOBAL),
        ]);

        const stats: RandomCallStats = {
            activeCalls: activeCallsCount,
            totalActive: activeUsersCount,
            inQueue: globalQueueLength,
            lastUpdate: Date.now(),
        };

        // Cache stats
        await redis.hSet(RANDOM_KEYS.STATS, {
            activeCalls: String(stats.activeCalls),
            totalActive: String(stats.totalActive),
            inQueue: String(stats.inQueue),
            lastUpdate: String(stats.lastUpdate),
        });

        return stats;
    } catch (error) {
        console.error('[Random] Error getting stats:', error);
        return {
            activeCalls: 0,
            totalActive: 0,
            inQueue: 0,
            lastUpdate: Date.now(),
        };
    }
}

//  Cleanup 

// Clean up stale queue entries (run periodically)
export async function cleanupStaleEntries(): Promise<number> {
    const maxQueueAge = 60 * 1000; // 60 seconds
    const now = Date.now();
    let cleaned = 0;

    try {
        // Get all queued users
        const queuedUserIds = await redis.lRange(RANDOM_KEYS.QUEUE_GLOBAL, 0, -1);

        for (const userId of queuedUserIds) {
            const userData = await redis.get(RANDOM_KEYS.QUEUE_TIME(userId));
            if (!userData) {
                // Orphaned queue entry - remove it
                await removeFromQueue(userId);
                cleaned++;
                continue;
            }

            const user: QueuedUser = JSON.parse(userData);
            if (now - user.queuedAt > maxQueueAge) {
                // Stale entry - user probably disconnected
                await removeFromQueue(userId);
                cleaned++;
                console.log(`[Random] Cleaned up stale queue entry for user ${userId}`);
            }
        }

        return cleaned;
    } catch (error) {
        console.error('[Random] Error cleaning up stale entries:', error);
        return cleaned;
    }
}

// Clean up stale call sessions 
export async function cleanupStaleSessions(): Promise<number> {
    const maxConnectingAge = 15 * 1000; // 15 seconds to establish connection
    const maxCallAge = 60 * 60 * 1000; // 1 hour max call duration
    const now = Date.now();
    let cleaned = 0;

    try {
        const sessionIds = await redis.sMembers(RANDOM_KEYS.ACTIVE_CALLS_SET);

        for (const sessionId of sessionIds) {
            const session = await getCallSession(sessionId);
            if (!session) {
                // Orphaned session ID
                await redis.sRem(RANDOM_KEYS.ACTIVE_CALLS_SET, sessionId);
                cleaned++;
                continue;
            }

            const age = now - session.startedAt;

            if (session.state === 'connecting' && age > maxConnectingAge) {
                // Connection timeout
                await endCallSession(sessionId, 'connection_timeout');
                cleaned++;
                console.log(`[Random] Cleaned up timed out connecting session ${sessionId}`);
            } else if (age > maxCallAge) {
                // Max call duration exceeded
                await endCallSession(sessionId, 'max_duration');
                cleaned++;
                console.log(`[Random] Cleaned up max duration session ${sessionId}`);
            }
        }

        return cleaned;
    } catch (error) {
        console.error('[Random] Error cleaning up stale sessions:', error);
        return cleaned;
    }
}

// -------------------- User Blocking 

// Block a user (prevent future matching)
export async function blockUser(userId: string, blockedUserId: string): Promise<void> {
    await redis.sAdd(RANDOM_KEYS.USER_BLOCKED(userId), blockedUserId);
    // Set expiry on the set (30 days)
    await redis.expire(RANDOM_KEYS.USER_BLOCKED(userId), 30 * 24 * 60 * 60);
}

// Check if user is blocked
export async function isUserBlocked(userId: string, targetUserId: string): Promise<boolean> {
    return redis.sIsMember(RANDOM_KEYS.USER_BLOCKED(userId), targetUserId);
}

// Remove user from active users set (cleanup helper)
export async function removeUserFromActiveSet(userId: string): Promise<void> {
    await redis.sRem(RANDOM_KEYS.ACTIVE_USERS, userId);
}
