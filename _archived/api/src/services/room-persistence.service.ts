/**
 * Room Persistence Service
 * 
 * Handles persistence of room state to Redis to enable:
 * - Server restarts without losing active calls
 * - Horizontal scaling of API servers
 * - Session recovery on connection loss
 * 
 * State is stored with TTL to auto-cleanup after rooms close
 */

import { redis } from '../db/redis.js';
import type { Router, AudioLevelObserver } from 'mediasoup/types';

const ROOM_STATE_KEY = (roomId: string) => `room:state:${roomId}`;
const ROOM_PARTICIPANTS_KEY = (roomId: string) => `room:participants:${roomId}`;
const ROOM_METADATA_KEY = (roomId: string) => `room:metadata:${roomId}`;
const ROOM_TTL = 3600; // 1 hour - auto cleanup if room becomes inactive

/**
 * Serializable room metadata (Router and observers can't be serialized)
 */
interface RoomMetadata {
    roomId: string;
    createdAt: number;
    updatedAt: number;
    participantCount: number;
    lastActivityAt: number;
}

/**
 * Serializable participant state
 */
interface PersistedParticipantState {
    userId: string;
    producerId: string | null;
    consumerIds: string[];
    transportIds: {
        send: string | null;
        recv: string | null;
    };
    joinedAt: number;
    mutedAt: number | null;
}

/**
 * Persist room metadata to Redis
 * Called when room is created or updated
 */
export async function persistRoomMetadata(
    roomId: string,
    participantCount: number
): Promise<void> {
    try {
        const metadata: RoomMetadata = {
            roomId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            participantCount,
            lastActivityAt: Date.now(),
        };

        await redis.setEx(
            ROOM_METADATA_KEY(roomId),
            ROOM_TTL,
            JSON.stringify(metadata)
        );

        console.log(`[RoomPersistence] Persisted metadata for room ${roomId}`);
    } catch (error) {
        console.error(`[RoomPersistence] Failed to persist room metadata:`, error);
        // Non-critical - don't throw
    }
}

/**
 * Persist participant state to Redis
 * Called when participant joins/leaves or changes state
 */
export async function persistParticipantState(
    roomId: string,
    userId: string,
    participantData: {
        producerId: string | null;
        consumerIds: string[];
        transportIds: { send: string | null; recv: string | null };
    }
): Promise<void> {
    try {
        const persistedData: PersistedParticipantState = {
            userId,
            producerId: participantData.producerId,
            consumerIds: participantData.consumerIds,
            transportIds: participantData.transportIds,
            joinedAt: Date.now(),
            mutedAt: null,
        };

        const key = `${ROOM_PARTICIPANTS_KEY(roomId)}:${userId}`;
        await redis.setEx(
            key,
            ROOM_TTL,
            JSON.stringify(persistedData)
        );

        console.log(
            `[RoomPersistence] Persisted participant ${userId} in room ${roomId}`
        );
    } catch (error) {
        console.error(
            `[RoomPersistence] Failed to persist participant state:`,
            error
        );
    }
}

/**
 * Load room metadata from Redis
 * Returns null if room state expired or doesn't exist
 */
export async function loadRoomMetadata(roomId: string): Promise<RoomMetadata | null> {
    try {
        const data = await redis.get(ROOM_METADATA_KEY(roomId));
        if (!data) {
            return null;
        }

        const metadata = JSON.parse(data) as RoomMetadata;
        console.log(`[RoomPersistence] Loaded metadata for room ${roomId}`);
        return metadata;
    } catch (error) {
        console.error(`[RoomPersistence] Failed to load room metadata:`, error);
        return null;
    }
}

/**
 * Load all participant states for a room
 */
export async function loadRoomParticipants(
    roomId: string
): Promise<Map<string, PersistedParticipantState>> {
    try {
        const pattern = `${ROOM_PARTICIPANTS_KEY(roomId)}:*`;
        const keys = await redis.keys(pattern);

        const participants = new Map<string, PersistedParticipantState>();

        for (const key of keys) {
            const data = await redis.get(key);
            if (data) {
                const participant = JSON.parse(data) as PersistedParticipantState;
                participants.set(participant.userId, participant);
            }
        }

        console.log(
            `[RoomPersistence] Loaded ${participants.size} participants for room ${roomId}`
        );
        return participants;
    } catch (error) {
        console.error(`[RoomPersistence] Failed to load room participants:`, error);
        return new Map();
    }
}

/**
 * Delete room state from Redis
 * Called when room is closed
 */
export async function deleteRoomState(roomId: string): Promise<void> {
    try {
        // Delete metadata
        await redis.del(ROOM_METADATA_KEY(roomId));

        // Delete all participant states
        const participantPattern = `${ROOM_PARTICIPANTS_KEY(roomId)}:*`;
        const participantKeys = await redis.keys(participantPattern);

        if (participantKeys.length > 0) {
            await redis.del(participantKeys);
        }

        console.log(`[RoomPersistence] Deleted state for room ${roomId}`);
    } catch (error) {
        console.error(`[RoomPersistence] Failed to delete room state:`, error);
    }
}

/**
 * Update last activity timestamp for a room
 * Helps keep room alive while actively used
 */
export async function updateRoomActivity(roomId: string): Promise<void> {
    try {
        const metadata = await loadRoomMetadata(roomId);
        if (metadata) {
            metadata.lastActivityAt = Date.now();
            await redis.setEx(
                ROOM_METADATA_KEY(roomId),
                ROOM_TTL,
                JSON.stringify(metadata)
            );
        }
    } catch (error) {
        console.error(`[RoomPersistence] Failed to update room activity:`, error);
    }
}

/**
 * Get all active rooms from Redis
 * Useful for monitoring and cleanup
 */
export async function getActiveRooms(): Promise<string[]> {
    try {
        const keys = await redis.keys('room:metadata:*');
        const rooms = keys.map(key => key.replace('room:metadata:', ''));
        return rooms;
    } catch (error) {
        console.error(`[RoomPersistence] Failed to get active rooms:`, error);
        return [];
    }
}

/**
 * Cleanup stale room states from Redis
 * Runs periodically to ensure no orphaned data
 */
export async function cleanupStaleRoomStates(): Promise<number> {
    try {
        const now = Date.now();
        const rooms = await getActiveRooms();
        let cleaned = 0;

        for (const roomId of rooms) {
            const metadata = await loadRoomMetadata(roomId);
            if (metadata) {
                // If room hasn't had activity in 2 hours, consider it stale
                const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours
                if (now - metadata.lastActivityAt > staleThreshold) {
                    await deleteRoomState(roomId);
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            console.log(
                `[RoomPersistence] Cleaned up ${cleaned} stale room states`
            );
        }

        return cleaned;
    } catch (error) {
        console.error(`[RoomPersistence] Failed to cleanup stale states:`, error);
        return 0;
    }
}

/**
 * Check if room exists in persistent storage
 * Used for recovery scenarios
 */
export async function roomExistsInPersistence(roomId: string): Promise<boolean> {
    try {
        const metadata = await loadRoomMetadata(roomId);
        return metadata !== null;
    } catch (error) {
        return false;
    }
}
