import { createClient } from 'redis';
import { config } from '../config/env.js';

// Create Redis client
export const redis = createClient({
    url: config.redisUrl,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error('Redis reconnection failed after 10 attempts');
                return new Error('Redis reconnection failed');
            }
            return Math.min(retries * 50, 3000);
        },
    },
});

// Error handling
redis.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redis.on('connect', () => {
    console.log('Redis connected');
});

redis.on('reconnecting', () => {
    console.log('Redis reconnecting...');
});

redis.on('ready', () => {
    console.log('Redis ready');
});

// Connect to Redis
export async function connectRedis() {
    try {
        // Prevent double connection
        if (redis.isOpen) {
            console.log('Redis already connected');
            return;
        }
        await redis.connect();
        console.log('Redis connection established');
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
        throw error;
    }
}

// shutdown
export async function disconnectRedis() {
    try {
        await redis.quit();
        console.log('Redis connection closed');
    } catch (error) {
        console.error('Error closing Redis connection:', error);
    }
}

// Check if Redis is connected
export function isRedisConnected(): boolean {
    return redis.isOpen;
}

// Cache key prefixes for organization
export const CACHE_KEYS = {

    ROOM: (roomId: string) => `room:${roomId}`,
    ROOMS_LIST: (page: number, limit: number, language?: string) =>
        `rooms:list:${page}:${limit}${language ? `:${language}` : ''}`,

    USER: (userId: string) => `user:${userId}`,
    USER_PROFILE: (userId: string) => `user:profile:${userId}`,
    USER_ROOM: (userId: string) => `user:room:${userId}`,

    ROOM_PARTICIPANTS: (roomId: string) => `room:participants:${roomId}`,

    ACTIVE_ROOMS: 'rooms:active',
    ONLINE_USERS: 'users:online',

    USER_SESSION: (userId: string) => `session:${userId}`,
    REFRESH_TOKEN: (token: string) => `refresh:${token}`,
    USER_REFRESH_TOKEN: (userId: string) => `user:refresh:${userId}`, // Maps userId to current refresh token

    // Random Call Keys
    RANDOM_QUEUE_GLOBAL: 'random:queue:global',
    RANDOM_QUEUE_LANGUAGE: (lang: string) => `random:queue:lang:${lang.toLowerCase()}`,
    RANDOM_USER_CALL: (userId: string) => `random:user_call:${userId}`,
    RANDOM_ACTIVE_CALLS: 'random:active_calls',
    RANDOM_STATS: 'random:stats',
} as const;

// Cache TTL values (in seconds)
export const CACHE_TTL = {
    SHORT: 60, // 1 minute
    MEDIUM: 300, // 5 minutes
    LONG: 1800, // 30 minutes
    VERY_LONG: 3600, // 1 hour
    SESSION: 7 * 24 * 60 * 60, // 7 days
} as const;
