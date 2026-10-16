import { db } from '../db/index.js';
import { users, rooms, roomParticipants, randomCallSessions, userCallPreferences } from '../db/schema.js';
import { eq, and, or, desc, sql, count } from 'drizzle-orm';
import { UserCache } from './cache.service.js';

// -------------------- Types 

export interface UserProfile {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    nativeLanguages: string[] | null;
    learningLanguages: string[] | null;
    isOnline: boolean | null;
    lastSeenAt: Date | null;
    createdAt: Date;
}

export interface UserStats {
    totalPracticeMinutes: number;
    roomsJoined: number;
    roomsCreated: number;
    randomCallsCompleted: number;
    randomCallMinutes: number;
}

export interface ProfileUpdateData {
    displayName?: string;
    bio?: string;
    avatarUrl?: string | null;
    nativeLanguages?: string[];
    learningLanguages?: string[];
}

// -------------------- Profile Functions 

// Get user profile by ID (excludes sensitive data)
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
    // Check cache first
    const cached = await UserCache.getUser(userId);
    if (cached) {
        return cached as UserProfile;
    }

    const [user] = await db
        .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            bio: users.bio,
            nativeLanguages: users.nativeLanguages,
            learningLanguages: users.learningLanguages,
            isOnline: users.isOnline,
            lastSeenAt: users.lastSeenAt,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) return null;

    // Cache the result
    await UserCache.cacheUser(userId, user);

    return user;
}

// Get user profile by username
export async function getUserByUsername(username: string): Promise<UserProfile | null> {
    const [user] = await db
        .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            bio: users.bio,
            nativeLanguages: users.nativeLanguages,
            learningLanguages: users.learningLanguages,
            isOnline: users.isOnline,
            lastSeenAt: users.lastSeenAt,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

    return user || null;
}

// Get user statistics
export async function getUserStats(userId: string): Promise<UserStats> {
    // Get room stats
    const roomStats = await db
        .select({
            roomsCreated: sql<number>`COUNT(DISTINCT CASE WHEN ${rooms.ownerId} = ${userId} THEN ${rooms.id} END)`,
            roomsJoined: sql<number>`COUNT(DISTINCT ${roomParticipants.roomId})`,
        })
        .from(roomParticipants)
        .leftJoin(rooms, eq(roomParticipants.roomId, rooms.id))
        .where(eq(roomParticipants.userId, userId));

    // Get random call stats from preferences table
    const [callPrefs] = await db
        .select({
            totalCallsCompleted: userCallPreferences.totalCallsCompleted,
            totalCallMinutes: userCallPreferences.totalCallMinutes,
        })
        .from(userCallPreferences)
        .where(eq(userCallPreferences.userId, userId))
        .limit(1);

    // Calculate total practice time from room participations
    const [practiceTime] = await db
        .select({
            totalMinutes: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(${roomParticipants.leftAt}, NOW()) - ${roomParticipants.joinedAt})) / 60), 0)::integer`,
        })
        .from(roomParticipants)
        .where(eq(roomParticipants.userId, userId));

    return {
        totalPracticeMinutes: (practiceTime?.totalMinutes || 0) + (callPrefs?.totalCallMinutes || 0),
        roomsJoined: roomStats[0]?.roomsJoined || 0,
        roomsCreated: roomStats[0]?.roomsCreated || 0,
        randomCallsCompleted: callPrefs?.totalCallsCompleted || 0,
        randomCallMinutes: callPrefs?.totalCallMinutes || 0,
    };
}


// Get user's recent activity
export async function getUserActivity(userId: string, limit: number = 10) {
    // Get recent room participations
    const recentRooms = await db
        .select({
            id: roomParticipants.id,
            type: sql<string>`CASE WHEN ${rooms.ownerId} = ${userId} THEN 'room_created' ELSE 'room_joined' END`,
            roomId: rooms.id,
            roomName: rooms.name,
            roomTopic: rooms.topic,
            timestamp: roomParticipants.joinedAt,
        })
        .from(roomParticipants)
        .innerJoin(rooms, eq(roomParticipants.roomId, rooms.id))
        .where(eq(roomParticipants.userId, userId))
        .orderBy(desc(roomParticipants.joinedAt))
        .limit(limit);

    // Get recent random calls
    const recentCalls = await db
        .select({
            id: randomCallSessions.id,
            type: sql<string>`'random_call'`,
            matchedLanguage: randomCallSessions.matchedLanguage,
            durationSeconds: randomCallSessions.durationSeconds,
            timestamp: randomCallSessions.startedAt,
        })
        .from(randomCallSessions)
        .where(
            and(
                or(
                    eq(randomCallSessions.user1Id, userId),
                    eq(randomCallSessions.user2Id, userId)
                ),
                sql`${randomCallSessions.endedAt} IS NOT NULL`
            )
        )
        .orderBy(desc(randomCallSessions.startedAt))
        .limit(limit);

    // Combine and sort by timestamp
    const allActivity = [
        ...recentRooms.map(r => ({
            id: r.id,
            type: r.type as 'room_created' | 'room_joined',
            data: { roomName: r.roomName, roomTopic: r.roomTopic },
            timestamp: r.timestamp,
        })),
        ...recentCalls.map(c => ({
            id: c.id,
            type: 'random_call' as const,
            data: { matchedLanguage: c.matchedLanguage, durationSeconds: c.durationSeconds },
            timestamp: c.timestamp,
        })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

    return allActivity;
}


// Get user's created rooms
export async function getUserRooms(userId: string, limit: number = 20) {
    return db
        .select({
            id: rooms.id,
            name: rooms.name,
            slug: rooms.slug,
            topic: rooms.topic,
            languages: rooms.languages,
            maxParticipants: rooms.maxParticipants,
            isActive: rooms.isActive,
            createdAt: rooms.createdAt,
        })
        .from(rooms)
        .where(eq(rooms.ownerId, userId))
        .orderBy(desc(rooms.createdAt))
        .limit(limit);
}

// Update user profile
export async function updateProfile(userId: string, data: ProfileUpdateData): Promise<UserProfile | null> {
    // Validate data
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (data.displayName !== undefined) {
        updateData.displayName = data.displayName.trim().slice(0, 100) || null;
    }
    if (data.bio !== undefined) {
        updateData.bio = data.bio.trim().slice(0, 500) || null;
    }
    if (data.avatarUrl !== undefined) {
        updateData.avatarUrl = data.avatarUrl || null;
    }
    if (data.nativeLanguages !== undefined) {
        updateData.nativeLanguages = data.nativeLanguages.slice(0, 5);
    }
    if (data.learningLanguages !== undefined) {
        updateData.learningLanguages = data.learningLanguages.slice(0, 10);
    }

    const [updated] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            bio: users.bio,
            nativeLanguages: users.nativeLanguages,
            learningLanguages: users.learningLanguages,
            isOnline: users.isOnline,
            lastSeenAt: users.lastSeenAt,
            createdAt: users.createdAt,
        });

    if (!updated) return null;

    // Invalidate cache
    await UserCache.invalidateUser(userId);

    return updated;
}


// Check if username is available
export async function isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1);

    if (!existing) return true;
    if (excludeUserId && existing.id === excludeUserId) return true;
    return false;
}

// Update username
export async function updateUsername(userId: string, newUsername: string): Promise<boolean> {
    const username = newUsername.toLowerCase().trim();

    // Validate username format
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        throw new Error('Username must be 3-30 characters, lowercase letters, numbers, and underscores only');
    }

    // Check availability
    const available = await isUsernameAvailable(username, userId);
    if (!available) {
        throw new Error('Username is already taken');
    }

    const [updated] = await db
        .update(users)
        .set({ username, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id });

    if (updated) {
        await UserCache.invalidateUser(userId);
    }

    return !!updated;
}
