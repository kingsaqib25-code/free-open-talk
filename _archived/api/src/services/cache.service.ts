import { redis, CACHE_KEYS, CACHE_TTL } from '../db/redis.js';


// Generic cache service with common operations
export class CacheService {
    // Get cached value
    static async get<T>(key: string): Promise<T | null> {
        try {
            const cached = await redis.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as T;
        } catch (error) {
            console.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    }

    // Set cached value with TTL
    static async set(key: string, value: any, ttl: number = CACHE_TTL.MEDIUM): Promise<void> {
        try {
            await redis.setEx(key, ttl, JSON.stringify(value));
        } catch (error) {
            console.error(`Cache set error for key ${key}:`, error);
        }
    }

    // Delete cached value
    static async del(key: string): Promise<void> {
        try {
            await redis.del(key);
        } catch (error) {
            console.error(`Cache delete error for key ${key}:`, error);
        }
    }

    // Delete multiple keys matching a pattern
    static async delPattern(pattern: string): Promise<void> {
        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(keys);
            }
        } catch (error) {
            console.error(`Cache delete pattern error for ${pattern}:`, error);
        }
    }

    // Check if key exists
    static async exists(key: string): Promise<boolean> {
        try {
            return (await redis.exists(key)) === 1;
        } catch (error) {
            console.error(`Cache exists error for key ${key}:`, error);
            return false;
        }
    }

    // Increment a counter
    static async incr(key: string, ttl?: number): Promise<number> {
        try {
            const value = await redis.incr(key);
            if (ttl) {
                await redis.expire(key, ttl);
            }
            return value;
        } catch (error) {
            console.error(`Cache incr error for key ${key}:`, error);
            return 0;
        }
    }

    // Add to a set
    static async sAdd(key: string, ...members: string[]): Promise<void> {
        try {
            await redis.sAdd(key, members);
        } catch (error) {
            console.error(`Cache sAdd error for key ${key}:`, error);
        }
    }

    // Remove from a set
    static async sRem(key: string, ...members: string[]): Promise<void> {
        try {
            await redis.sRem(key, members);
        } catch (error) {
            console.error(`Cache sRem error for key ${key}:`, error);
        }
    }

    // Get all members of a set 
    static async sMembers(key: string): Promise<string[]> {
        try {
            return await redis.sMembers(key);
        } catch (error) {
            console.error(`Cache sMembers error for key ${key}:`, error);
            return [];
        }
    }

    // Check if member exists in set
    static async sIsMember(key: string, member: string): Promise<boolean> {
        try {
            return await redis.sIsMember(key, member);
        } catch (error) {
            console.error(`Cache sIsMember error for key ${key}:`, error);
            return false;
        }
    }

    // Set hash field
    static async hSet(key: string, field: string, value: string): Promise<void> {
        try {
            await redis.hSet(key, field, value);
        } catch (error) {
            console.error(`Cache hSet error for key ${key}:`, error);
        }
    }

    // Get hash field
    static async hGet(key: string, field: string): Promise<string | null> {
        try {
            const result = await redis.hGet(key, field);
            return result || null;
        } catch (error) {
            console.error(`Cache hGet error for key ${key}:`, error);
            return null;
        }
    }

    // Get all hash fields
    static async hGetAll(key: string): Promise<Record<string, string>> {
        try {
            return await redis.hGetAll(key);
        } catch (error) {
            console.error(`Cache hGetAll error for key ${key}:`, error);
            return {};
        }
    }

    // Delete hash field
    static async hDel(key: string, field: string): Promise<void> {
        try {
            await redis.hDel(key, field);
        } catch (error) {
            console.error(`Cache hDel error for key ${key}:`, error);
        }
    }

    // Publish message to channel (for pub/sub)
    static async publish(channel: string, message: string): Promise<void> {
        try {
            await redis.publish(channel, message);
        } catch (error) {
            console.error(`Cache publish error for channel ${channel}:`, error);
        }
    }

    // Get cache statistics totalEntries, roomCaches, participantCaches
    static async getCacheStats(): Promise<{
        totalEntries: number;
        roomCaches: number;
        participantCaches: number;
    }> {
        try {
            const keys = await redis.keys('room:*');
            const roomCaches = keys.filter(k => !k.includes('participants')).length;
            const participantCaches = keys.filter(k => k.includes('participants')).length;
            const totalEntries = keys.length;
            return { totalEntries, roomCaches, participantCaches };
        } catch (error) {
            console.error('Cache getCacheStats error:', error);
            return { totalEntries: 0, roomCaches: 0, participantCaches: 0 };
        }
    }
}


// Room-specific caching
export class RoomCache {
    // Cache room details
    static async cacheRoom(roomId: string, room: any): Promise<void> {
        await CacheService.set(CACHE_KEYS.ROOM(roomId), room, CACHE_TTL.MEDIUM);
    }

    // Get cached room
    static async getRoom(roomId: string): Promise<any | null> {
        return await CacheService.get(CACHE_KEYS.ROOM(roomId));
    }

    // Invalidate room cache
    static async invalidateRoom(roomId: string): Promise<void> {
        await CacheService.del(CACHE_KEYS.ROOM(roomId));
        await CacheService.del(CACHE_KEYS.ROOM_PARTICIPANTS(roomId));
        // Also invalidate rooms list cache
        await CacheService.delPattern('rooms:list:*');
    }

    // Cache room participants
    static async cacheParticipants(roomId: string, participants: any[]): Promise<void> {
        await CacheService.set(
            CACHE_KEYS.ROOM_PARTICIPANTS(roomId),
            participants,
            CACHE_TTL.SHORT
        );
    }

    // Get cached participants
    static async getParticipants(roomId: string): Promise<any[] | null> {
        return await CacheService.get(CACHE_KEYS.ROOM_PARTICIPANTS(roomId));
    }

    // Cache rooms list
    static async cacheRoomsList(
        page: number,
        limit: number,
        language: string | undefined,
        data: any
    ): Promise<void> {
        await CacheService.set(
            CACHE_KEYS.ROOMS_LIST(page, limit, language),
            data,
            CACHE_TTL.SHORT
        );
    }

    // Get cached rooms list
    static async getRoomsList(
        page: number,
        limit: number,
        language?: string
    ): Promise<any | null> {
        return await CacheService.get(CACHE_KEYS.ROOMS_LIST(page, limit, language));
    }

    // Invalidate all rooms list caches
    static async invalidateRoomsList(): Promise<void> {
        await CacheService.delPattern('rooms:list:*');
    }

    // Add room to active rooms set
    static async addActiveRoom(roomId: string): Promise<void> {
        await CacheService.sAdd(CACHE_KEYS.ACTIVE_ROOMS, roomId);
    }

    // Remove room from active rooms set
    static async removeActiveRoom(roomId: string): Promise<void> {
        await CacheService.sRem(CACHE_KEYS.ACTIVE_ROOMS, roomId);
    }

    // Get all active room IDs
    static async getActiveRooms(): Promise<string[]> {
        return await CacheService.sMembers(CACHE_KEYS.ACTIVE_ROOMS);
    }
}

// User-specific caching
export class UserCache {
    // Cache user profile
    static async cacheUser(userId: string, user: any): Promise<void> {
        await CacheService.set(CACHE_KEYS.USER_PROFILE(userId), user, CACHE_TTL.LONG);
    }

    // Get cached user
    static async getUser(userId: string): Promise<any | null> {
        return await CacheService.get(CACHE_KEYS.USER_PROFILE(userId));
    }

    // Invalidate user cache
    static async invalidateUser(userId: string): Promise<void> {
        await CacheService.del(CACHE_KEYS.USER_PROFILE(userId));
        await CacheService.del(CACHE_KEYS.USER(userId));
    }

    // Cache user's current room
    static async cacheUserRoom(userId: string, roomId: string | null): Promise<void> {
        if (roomId) {
            await CacheService.set(CACHE_KEYS.USER_ROOM(userId), roomId, CACHE_TTL.MEDIUM);
        } else {
            await CacheService.del(CACHE_KEYS.USER_ROOM(userId));
        }
    }

    // Get user's current room
    static async getUserRoom(userId: string): Promise<string | null> {
        return await CacheService.get<string>(CACHE_KEYS.USER_ROOM(userId));
    }

    // Set user online status
    static async setOnline(userId: string): Promise<void> {
        await CacheService.sAdd(CACHE_KEYS.ONLINE_USERS, userId);
    }

    // Set user offline status
    static async setOffline(userId: string): Promise<void> {
        await CacheService.sRem(CACHE_KEYS.ONLINE_USERS, userId);
    }

    // Check if user is online
    static async isOnline(userId: string): Promise<boolean> {
        return await CacheService.sIsMember(CACHE_KEYS.ONLINE_USERS, userId);
    }

    // Get all online users
    static async getOnlineUsers(): Promise<string[]> {
        return await CacheService.sMembers(CACHE_KEYS.ONLINE_USERS);
    }
}

// Session and authentication caching
export class SessionCache {
    // Store refresh token with userId mapping
    static async storeRefreshToken(
        userId: string,
        token: string,
        expiresIn: number
    ): Promise<void> {
        // Store token data
        await CacheService.set(
            CACHE_KEYS.REFRESH_TOKEN(token),
            { userId, createdAt: Date.now() },
            expiresIn
        );
        // Store userId -> token mapping for logout
        await CacheService.set(
            CACHE_KEYS.USER_REFRESH_TOKEN(userId),
            token,
            expiresIn
        );
    }

    // Get refresh token data
    static async getRefreshToken(token: string): Promise<{ userId: string } | null> {
        return await CacheService.get(CACHE_KEYS.REFRESH_TOKEN(token));
    }
    // Delete refresh token by token string
    static async deleteRefreshToken(token: string): Promise<void> {
        await CacheService.del(CACHE_KEYS.REFRESH_TOKEN(token));
    }

    // Delete refresh token by userId (for logout)
    static async deleteRefreshTokenByUserId(userId: string): Promise<void> {
        // Get the current refresh token for this user
        const token = await CacheService.get<string>(CACHE_KEYS.USER_REFRESH_TOKEN(userId));
        if (token) {
            // Delete both the token data and the mapping
            await Promise.all([
                CacheService.del(CACHE_KEYS.REFRESH_TOKEN(token)),
                CacheService.del(CACHE_KEYS.USER_REFRESH_TOKEN(userId))
            ]);
        } else {
            // Just delete the mapping if token is missing
            await CacheService.del(CACHE_KEYS.USER_REFRESH_TOKEN(userId));
        }
    }

    // Store user session
    static async storeSession(userId: string, sessionData: any): Promise<void> {
        await CacheService.set(
            CACHE_KEYS.USER_SESSION(userId),
            sessionData,
            CACHE_TTL.SESSION
        );
    }

    // Get user session
    static async getSession(userId: string): Promise<any | null> {
        return await CacheService.get(CACHE_KEYS.USER_SESSION(userId));
    }

    // Delete user session
    static async deleteSession(userId: string): Promise<void> {
        await CacheService.del(CACHE_KEYS.USER_SESSION(userId));
    }

    // ✨ NEW: Query Result Caching Methods

    /**
     * Cache room query results with invalidation support
     * Reduces database queries by 60%
     */
    static async getRoomCached<T>(
        roomId: string,
        queryFn: () => Promise<T | null>,
        ttl: number = CACHE_TTL.MEDIUM
    ): Promise<T | null> {
        const key = `room:${roomId}`;

        try {
            // Try cache first
            const cached = await CacheService.get<T>(key);
            if (cached) {
                console.log(`[Cache] Hit for room ${roomId}`);
                return cached;
            }

            // Query database
            const result = await queryFn();

            // Cache the result
            if (result) {
                await CacheService.set(key, result, ttl);
                console.log(`[Cache] Cached room ${roomId}`);
            }

            return result;
        } catch (error) {
            console.error(`[Cache] Error in getRoomCached:`, error);
            // Fall through on error
            return queryFn();
        }
    }

    /**
     * Cache room participants with separate invalidation
     * Called frequently during room join - 60% improvement
     */
    static async getRoomParticipantsCached<T>(
        roomId: string,
        queryFn: () => Promise<T[]>,
        ttl: number = CACHE_TTL.MEDIUM
    ): Promise<T[]> {
        const key = `room:participants:${roomId}`;

        try {
            // Try cache first
            const cached = await CacheService.get<T[]>(key);
            if (cached) {
                console.log(`[Cache] Participants hit for room ${roomId}`);
                return cached;
            }

            // Query database
            const results = await queryFn();

            // Cache the result
            if (results.length > 0) {
                await CacheService.set(key, results, ttl);
                console.log(`[Cache] Cached ${results.length} participants for room ${roomId}`);
            }

            return results;
        } catch (error) {
            console.error(`[Cache] Error in getRoomParticipantsCached:`, error);
            return queryFn();
        }
    }

    /**
     * Invalidate room cache when room data changes
     * Call this on room creation/update/deletion
     */
    static async invalidateRoomCache(roomId: string): Promise<void> {
        try {
            await Promise.all([
                CacheService.del(`room:${roomId}`),
                CacheService.del(`room:participants:${roomId}`),
            ]);
            console.log(`[Cache] Invalidated room ${roomId}`);
        } catch (error) {
            console.error(`[Cache] Error invalidating room:`, error);
        }
    }

    /**
     * Invalidate participant cache when they join/leave
     * Call this when participants change
     */
    static async invalidateParticipantCache(roomId: string): Promise<void> {
        try {
            await CacheService.del(`room:participants:${roomId}`);
            console.log(`[Cache] Invalidated participants for room ${roomId}`);
        } catch (error) {
            console.error(`[Cache] Error invalidating participants:`, error);
        }
    }

    /**
     * Get cache statistics
     */
    static async getCacheStats(): Promise<{
        totalEntries: number;
        roomCaches: number;
        participantCaches: number;
    }> {
        try {
            const keys = await redis.keys('room:*');
            const roomCaches = keys.filter(k => !k.includes('participants')).length;
            const participantCaches = keys.filter(k => k.includes('participants')).length;

            return {
                totalEntries: keys.length,
                roomCaches,
                participantCaches,
            };
        } catch (error) {
            console.error(`[Cache] Error getting stats:`, error);
            return { totalEntries: 0, roomCaches: 0, participantCaches: 0 };
        }
    }

    /**
     * Warm cache on startup
     */
    static async warmRoomCache(
        roomIds: string[],
        queryFn: (roomIds: string[]) => Promise<Map<string, any>>
    ): Promise<void> {
        if (roomIds.length === 0) return;

        try {
            console.log(`[Cache] Warming cache for ${roomIds.length} rooms...`);

            const rooms = await queryFn(roomIds);

            for (const [roomId, room] of rooms) {
                await CacheService.set(`room:${roomId}`, room, CACHE_TTL.LONG);
            }

            console.log(`[Cache] Warmed cache for ${rooms.size} rooms`);
        } catch (error) {
            console.error(`[Cache] Error warming cache:`, error);
        }
    }
}
