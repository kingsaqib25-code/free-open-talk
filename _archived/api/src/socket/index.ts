import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@free2talk/shared';
import { verifyAccessToken } from '../utils/JWT.js';
import * as voiceService from '../services/voice.service.js';
import * as roomService from '../services/room.service.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { UserCache } from '../services/cache.service.js';
import { initRandomCallHandlers, registerRandomCallEvents } from './random-handlers.js';

type AuthSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
    userId?: string;
    roomId?: string;
};

// Track user connections
const userSockets = new Map<string, string>(); // userId -> socketId
const socketUsers = new Map<string, string>(); // socketId -> userId

// Custom error class for socket errors with codes
class SocketAuthError extends Error {
    constructor(
        message: string,
        public code: string = 'AUTH_ERROR',
        public statusCode: number = 401
    ) {
        super(message);
        this.name = 'SocketAuthError';
    }
}

export function initSocketHandlers(
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    // Initialize random call background processes
    initRandomCallHandlers(io);

    // Authentication middleware - optional for hallway viewing
    io.use(async (socket: AuthSocket, next) => {
        const socketId = socket.id;
        const clientIp = socket.handshake.address;

        console.log(`[Socket Auth] Connection attempt - Socket: ${socketId}, IP: ${clientIp}`);

        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

            // Authentication is optional - allow unauthenticated users for hallway viewing
            if (!token) {
                console.log(`[Socket Auth] UNAUTHENTICATED - Socket: ${socketId} (allowed for hallway viewing)`);
                socket.userId = undefined; // Mark as unauthenticated
                return next();
            }

            // If token is provided, verify it
            let payload;
            try {
                payload = verifyAccessToken(token);
                socket.userId = payload.userId;
                console.log(`[Socket Auth] SUCCESS - Socket: ${socketId}, User: ${payload.userId}`);
                next();
            } catch (tokenError: any) {
                const isExpired = tokenError.name === 'TokenExpiredError';
                const errorCode = isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
                const message = isExpired ? 'Access token expired' : 'Invalid access token';

                console.warn(`[Socket Auth] FAILED - ${message} - Socket: ${socketId}, Error: ${tokenError.message}`);

                // Even if token is invalid, allow connection for hallway viewing
                console.log(`[Socket Auth] Allowing connection despite token error - Socket: ${socketId}`);
                socket.userId = undefined; // Mark as unauthenticated
                next();
            }
        } catch (error: any) {
            console.error(`[Socket Auth] FAILED - Unexpected error - Socket: ${socketId}`, error);
            // Allow connection even on unexpected errors (fail safe)
            socket.userId = undefined;
            next();
        }
    });

    io.on('connection', (socket: AuthSocket) => {
        const userId = socket.userId;
        const isAuthenticated = !!userId;

        if (isAuthenticated) {
            console.log(`Client connected: ${socket.id} (User: ${userId})`);
        } else {
            console.log(`Client connected: ${socket.id} (Unauthenticated - Hallway only)`);
        }

        // Track connection (synchronous) - only for authenticated users
        if (isAuthenticated) {
            userSockets.set(userId, socket.id);
            socketUsers.set(socket.id, userId);
        }

        // Debug: Log all events received
        socket.onAny((event, ...args) => {
            const timestamp = new Date().toISOString();
            console.log(`[Socket Debug] ${timestamp} Event received: ${event}`, args.slice(0, -1).map(a => typeof a === 'function' ? '[callback]' : JSON.stringify(a).slice(0, 100)));
        });

        // ------------------- REGISTER ALL EVENT HANDLERS FIRST (synchronously) 
        // This ensures handlers are ready before any async operations complete
        // and before the client can send events

        // -------------------- Random Call Events 
        // Only register for authenticated users
        if (isAuthenticated) {
            registerRandomCallEvents(io, socket);
        }

        // -------------------- Hallway Events 
        // Available for both authenticated and unauthenticated users

        socket.on('hallway:subscribe', async () => {
            socket.join('hallway');
            const userLabel = isAuthenticated ? `User ${userId}` : `Guest ${socket.id}`;
            console.log(`${userLabel} subscribed to hallway`);
        });

        socket.on('hallway:unsubscribe', () => {
            socket.leave('hallway');
            const userLabel = isAuthenticated ? `User ${userId}` : `Guest ${socket.id}`;
            console.log(`${userLabel} unsubscribed from hallway`);
        });

        // --------------------- Room Events 

        /**
         * Room Join Flow
         * 
         * 1. Verify room is active
         * 2. Add user to room in database (if not already present)
         * 3. Join socket room channel
         * 4. Get all existing voice producers
         * 5. Send full state to joining user (participants + producers)
         * 6. Notify existing participants about new user
         * 7. Update hallway with new participant count
         */
        socket.on('room:join', async (roomId, callback) => {
            // Only authenticated users can join rooms
            if (!isAuthenticated) {
                console.log(`[RoomJoin] REJECTED - Unauthenticated user cannot join room ${roomId}`);
                socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required' });
                if (callback) callback({ success: false, error: 'Authentication required' });
                return;
            }

            console.log(`[RoomJoin] User ${userId} joining room ${roomId}`);
            console.log(`[RoomJoin] Socket ID: ${socket.id}`);

            try {
                // 1. Verify room exists and is active
                const room = await roomService.getRoomById(roomId);

                if (!room.isActive) {
                    console.log(`[RoomJoin] REJECTED - Room ${roomId} is closed`);
                    socket.emit('error', { code: 'ROOM_CLOSED', message: 'Room is closed' });
                    if (callback) callback({ success: false, error: 'Room is closed' });
                    return;
                }

                // 2. Add user to room in database (if not already a participant)
                // This ensures participant is persisted in DB for UI state consistency
                let joinResult;
                let currentParticipant;

                // Check if user is already a participant
                let participants = await roomService.getRoomParticipants(roomId);
                const existingParticipant = participants.find((p) => p.userId === userId || p.oderId === userId);

                if (!existingParticipant) {
                    // User is not in the room yet - add them to database
                    try {
                        joinResult = await roomService.joinRoom(roomId, userId);
                        currentParticipant = joinResult.participant;
                        console.log(`[RoomJoin] User ${userId} added to database as participant`);

                        // Refresh participants list to include the new user
                        participants = await roomService.getRoomParticipants(roomId);
                    } catch (joinError: any) {
                        console.error(`[RoomJoin] Failed to add user to database:`, joinError);
                        socket.emit('error', { code: 'JOIN_FAILED', message: joinError.message || 'Failed to join room' });
                        if (callback) callback({ success: false, error: joinError.message || 'Failed to join room' });
                        return;
                    }
                } else {
                    // User is already in the room (reconnection or refresh)
                    currentParticipant = existingParticipant;
                    console.log(`[RoomJoin] User ${userId} already exists as participant - skipping database insert`);
                }

                // 3. Join socket room channel
                socket.join(`room:${roomId}`);
                socket.roomId = roomId;
                console.log(`[RoomJoin] Socket ${socket.id} joined room channel room:${roomId}`);

                // 4. Get all existing voice producers in the room (includes paused state)
                const existingProducers = voiceService.getOtherProducers(roomId, userId);
                console.log(`[RoomJoin] Room ${roomId} has ${existingProducers.length} active producers`);

                // 5. Get mute states for all participants from voice service
                const muteStates = voiceService.getParticipantMuteStates(roomId);

                console.log(`[RoomJoin] Room ${roomId} has ${participants.length} participants in database`);

                // 6. Transform participants for client with actual mute states
                const participantList = participants.map(p => {
                    const participantUserId = p.userId || p.oderId;
                    // Check actual mute state from voice service, default to true if no producer
                    const isMuted = muteStates.get(participantUserId) ?? true;

                    return {
                        id: p.id,
                        userId: participantUserId,
                        username: p.username,
                        displayName: p.displayName || undefined,
                        avatarUrl: p.avatarUrl || undefined,
                        role: p.role,
                        isMuted,
                        isSpeaking: false,
                        joinedAt: p.joinedAt,
                    };
                });

                // 7. Notify ALL participants about new user (including sender - client filters)
                if (currentParticipant) {
                    const roomChannel = `room:${roomId}`;
                    const roomSockets = io.sockets.adapter.rooms.get(roomChannel);
                    console.log(`[RoomJoin] Broadcasting room:user-joined to channel ${roomChannel}`);
                    console.log(`[RoomJoin] Sockets in room channel: ${roomSockets ? Array.from(roomSockets).join(', ') : 'none'}`);
                    console.log(`[RoomJoin] Broadcasting to ALL sockets in room (client filters self)`);

                    // Broadcast to ALL sockets in the room - client-side filtering handles self
                    io.to(roomChannel).emit('room:user-joined', {
                        id: currentParticipant.id,
                        oderId: currentParticipant.userId || currentParticipant.oderId,
                        userId: currentParticipant.userId || currentParticipant.oderId,
                        username: currentParticipant.username,
                        displayName: currentParticipant.displayName || undefined,
                        avatarUrl: currentParticipant.avatarUrl || undefined,
                        role: currentParticipant.role,
                        isMuted: true, // New users always start muted
                        isSpeaking: false,
                        joinedAt: currentParticipant.joinedAt,
                    });
                    console.log(`[RoomJoin] Broadcast sent for user ${currentParticipant.username} to ${roomSockets?.size || 0} sockets`);

                    (io.to(roomChannel) as any).emit('room:participants-updated', {
                        participants: participantList,
                        reason: 'user-joined',
                    });
                    console.log(`[RoomJoin] Broadcast room:participants-updated with ${participantList.length} participants`);
                }

                // 8. Update hallway with new participant count
                io.to('hallway').emit('hallway:room-updated', {
                    id: room.id,
                    name: room.name,
                    topic: room.topic || undefined,
                    languages: room.languages || [],
                    participantCount: participants.length,
                    maxParticipants: room.maxParticipants,
                    ownerId: room.ownerId,
                    ownerName: room.owner.username,
                });

                console.log(`[RoomJoin] SUCCESS - User ${userId} joined room ${roomId}`);

                // Send full state to joining user
                if (callback) {
                    callback({
                        success: true,
                        participants: participantList,
                        producers: existingProducers,
                    });
                }
            } catch (error: any) {
                console.error(`[RoomJoin] ERROR - User ${userId} failed to join room ${roomId}:`, error);
                socket.emit('error', { code: 'JOIN_FAILED', message: error.message || 'Failed to join room' });
                if (callback) callback({ success: false, error: error.message || 'Failed to join room' });
            }
        });


        // Room Sync - Request full room state (for reconnection scenarios)
        // Also rejoins the socket to the room channel (important after reconnection!)
        socket.on('room:sync', async (roomId, callback) => {
            // Only authenticated users
            if (!isAuthenticated) {
                if (callback) callback({ success: false, error: 'Authentication required' });
                return;
            }

            console.log(`[RoomSync] User ${userId} requesting sync for room ${roomId}`);
            console.log(`[RoomSync] Socket ID: ${socket.id}`);

            try {
                // Verify user is a participant in this room
                const participants = await roomService.getRoomParticipants(roomId);
                const isParticipant = participants.some(p =>
                    (p.userId || p.oderId) === userId
                );

                if (!isParticipant) {
                    console.log(`[RoomSync] User ${userId} is not a participant in room ${roomId}`);
                    if (callback) callback({ success: false, error: 'Not a participant' });
                    return;
                }

                // Rejoin socket to room channel (important for reconnection!)
                socket.join(`room:${roomId}`);
                socket.roomId = roomId;
                console.log(`[RoomSync] Socket ${socket.id} rejoined room channel room:${roomId}`);

                const existingProducers = voiceService.getOtherProducers(roomId, userId);
                const muteStates = voiceService.getParticipantMuteStates(roomId);

                const participantList = participants.map(p => {
                    const participantUserId = p.userId || p.oderId;
                    const isMuted = muteStates.get(participantUserId) ?? true;

                    return {
                        id: p.id,
                        userId: participantUserId,
                        username: p.username,
                        displayName: p.displayName || undefined,
                        avatarUrl: p.avatarUrl || undefined,
                        role: p.role,
                        isMuted,
                        isSpeaking: false,
                        joinedAt: p.joinedAt,
                    };
                });

                if (callback) {
                    callback({
                        success: true,
                        participants: participantList,
                        producers: existingProducers,
                    });
                }
            } catch (error) {
                console.error(`[RoomSync] ERROR:`, error);
                if (callback) callback({ success: false });
            }
        });

        socket.on('room:leave', async (roomId: string, callback?: (response: { success: boolean }) => void) => {
            // Only authenticated users
            if (!isAuthenticated) {
                if (callback) callback({ success: false });
                return;
            }

            console.log(`[RoomLeave] User ${userId} leaving room ${roomId}`);

            try {
                socket.leave(`room:${roomId}`);
                socket.roomId = undefined;

                // Cleanup voice resources first
                await voiceService.cleanupParticipant(roomId, userId);

                // Notify others that user left
                socket.to(`room:${roomId}`).emit('room:user-left', userId);

                // Leave the room (handles ownership transfer and room closure)
                const { roomClosed } = await roomService.leaveRoom(roomId, userId);

                if (roomClosed) {
                    // Notify everyone in the room it's closing
                    io.to(`room:${roomId}`).emit('room:closed', 'Room was closed by the owner');
                    io.to('hallway').emit('hallway:room-closed', roomId);
                    console.log(`[RoomLeave] Room ${roomId} closed - owner left`);
                } else {
                    // Check if ownership was transferred
                    const room = await roomService.getRoomById(roomId);
                    if (room.ownerId !== userId) {
                        io.to(`room:${roomId}`).emit('room:owner-changed', room.ownerId);
                    }

                    // Broadcast updated participant list for reconciliation
                    const participants = await roomService.getRoomParticipants(roomId);
                    const muteStates = voiceService.getParticipantMuteStates(roomId);
                    const participantList = participants.map(p => {
                        const participantUserId = p.userId || p.oderId;
                        const isMuted = muteStates.get(participantUserId) ?? true;
                        return {
                            id: p.id,
                            userId: participantUserId,
                            oderId: participantUserId,
                            username: p.username,
                            displayName: p.displayName || undefined,
                            avatarUrl: p.avatarUrl || undefined,
                            role: p.role,
                            isMuted,
                            isSpeaking: false,
                            joinedAt: p.joinedAt,
                        };
                    });

                    (io.to(`room:${roomId}`) as any).emit('room:participants-updated', {
                        participants: participantList,
                        reason: 'user-left',
                    });
                    console.log(`[RoomLeave] Broadcast room:participants-updated with ${participantList.length} participants`);
                }

                console.log(`User ${userId} left room ${roomId}`);
                callback?.({ success: true });
            } catch (error) {
                console.error('Error leaving room:', error);
                callback?.({ success: false });
            }
        });

        socket.on('room:mute', async (muted: boolean) => {
            // Only authenticated users
            if (!isAuthenticated) {
                return;
            }

            try {
                if (!socket.roomId) {
                    return;
                }

                await voiceService.setProducerPaused(socket.roomId, userId, muted);

                // Notify others
                socket.to(`room:${socket.roomId}`).emit('room:user-muted', userId, muted);

                console.log(`User ${userId} ${muted ? 'muted' : 'unmuted'}`);
            } catch (error) {
                console.error('Error muting/unmuting:', error);
            }
        });

        // ------------------- Voice (mediasoup) Events 

        socket.on('voice:get-rtp-capabilities', async (callback) => {
            if (!isAuthenticated) {
                callback(null as any);
                return;
            }
            try {
                if (!socket.roomId) {
                    callback(null as any);
                    return;
                }

                const rtpCapabilities = await voiceService.getRtpCapabilities(socket.roomId);
                callback(rtpCapabilities);
            } catch (error) {
                console.error('Error getting RTP capabilities:', error);
                callback(null as any);
            }
        });

        socket.on('voice:create-transport', async (direction, callback) => {
            if (!isAuthenticated) {
                callback(null as any);
                return;
            }
            try {
                if (!socket.roomId) {
                    callback(null as any);
                    return;
                }

                const transportParams = await voiceService.createTransport(
                    socket.roomId,
                    userId,
                    direction
                );
                callback(transportParams);
            } catch (error) {
                console.error('Error creating transport:', error);
                callback(null as any);
            }
        });

        socket.on('voice:connect-transport', async (transportId, dtlsParameters, callback) => {
            if (!isAuthenticated) {
                callback?.();
                return;
            }
            try {
                if (!socket.roomId) {
                    callback();
                    return;
                }

                await voiceService.connectTransport(
                    socket.roomId,
                    userId,
                    transportId,
                    dtlsParameters
                );
                callback();
            } catch (error) {
                console.error('Error connecting transport:', error);
                callback();
            }
        });

        socket.on('voice:produce', async (transportId, rtpParameters, callback) => {
            if (!isAuthenticated) {
                callback(null as any);
                return;
            }
            try {
                if (!socket.roomId) {
                    callback('' as any);
                    return;
                }

                const producerId = await voiceService.produce(
                    socket.roomId,
                    userId,
                    transportId,
                    rtpParameters,
                    'audio'
                );

                // Notify others about new producer
                const roomChannel = `room:${socket.roomId}`;
                const socketsInRoom = io.sockets.adapter.rooms.get(roomChannel);
                console.log(`[Voice:Produce] Broadcasting voice:new-producer to room ${roomChannel}`);
                console.log(`[Voice:Produce] Sockets in room: ${socketsInRoom ? Array.from(socketsInRoom).join(', ') : 'none'}`);
                console.log(`[Voice:Produce] Producer: ${producerId}, User: ${userId}`);
                socket.to(roomChannel).emit('voice:new-producer', userId, producerId);
                console.log(`[Voice:Produce] Broadcast sent to ${socketsInRoom ? socketsInRoom.size - 1 : 0} other sockets`);

                // Setup speaking detection
                setupSpeakingDetection(io, socket.roomId, userId);

                callback(producerId);
            } catch (error) {
                console.error('Error producing:', error);
                callback('' as any);
            }
        });

        socket.on('voice:consume', async (producerId, rtpCapabilities, callback) => {
            if (!isAuthenticated) {
                callback(null as any);
                return;
            }
            try {
                if (!socket.roomId) {
                    callback(null as any);
                    return;
                }

                // Use client's device RTP capabilities (sent from client)
                // This is required to check if client can consume this producer
                const consumerParams = await voiceService.consume(
                    socket.roomId,
                    userId,
                    producerId,
                    rtpCapabilities
                );

                if (consumerParams) {
                    // Find the producer's userId
                    const room = voiceService.getRoomState(socket.roomId);
                    let producerUserId = '';
                    if (room) {
                        for (const [uid, participant] of room.participants) {
                            if (participant.producer?.id === producerId) {
                                producerUserId = uid;
                                break;
                            }
                        }
                    }

                    callback({
                        ...consumerParams,
                        userId: producerUserId,
                    });
                } else {
                    callback(null);
                }
            } catch (error) {
                console.error('Error consuming:', error);
                callback(null);
            }
        });

        // ----------------- Disconnect 

        socket.on('disconnect', async () => {
            const disconnectLabel = isAuthenticated ? `User: ${userId}` : `Guest: ${socket.id}`;
            console.log(`Client disconnected: ${socket.id} (${disconnectLabel})`);

            // Only cleanup authenticated users
            if (isAuthenticated) {
                // Cleanup tracking
                userSockets.delete(userId);
                socketUsers.delete(socket.id);

                // Update user online status (DB + Redis)
                await db.update(users).set({ isOnline: false, lastSeenAt: new Date() }).where(eq(users.id, userId));
                await UserCache.setOffline(userId);

                // Cleanup voice resources and leave room if in one
                if (socket.roomId) {
                    const roomId = socket.roomId;
                    try {
                        // Cleanup voice resources first
                        await voiceService.cleanupParticipant(roomId, userId);

                        // Notify others that user left
                        socket.to(`room:${roomId}`).emit('room:user-left', userId);

                        // Leave the room (this handles ownership transfer and room closure)
                        const { roomClosed } = await roomService.leaveRoom(roomId, userId);

                        if (roomClosed) {
                            // Notify hallway that room was closed
                            io.to('hallway').emit('hallway:room-closed', roomId);
                            console.log(`Room ${roomId} closed - owner left and no participants remaining`);
                        } else {
                            // Check if ownership was transferred
                            const room = await roomService.getRoomById(roomId);
                            if (room.ownerId !== userId) {
                                io.to(`room:${roomId}`).emit('room:owner-changed', room.ownerId);
                            }
                        }
                    } catch (error) {
                        console.error('Error during disconnect cleanup:', error);
                    }
                }
            }
        });

        // --------------------- Async Initialization (runs after all handlers are registered) 
        // Update user online status in background - don't block event handling
        // Only for authenticated users
        if (isAuthenticated) {
            (async () => {
                try {
                    await db.update(users).set({ isOnline: true }).where(eq(users.id, userId));
                    await UserCache.setOnline(userId);
                } catch (error) {
                    console.error('Error updating user online status:', error);
                }
            })();
        }
    });
}

// Helper: Setup speaking detection for a user
function setupSpeakingDetection(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    roomId: string,
    userId: string
) {
    const audioLevelObserver = voiceService.getAudioLevelObserver(roomId);
    if (!audioLevelObserver) {
        return;
    }

    // Listen for volume changes
    audioLevelObserver.on('volumes', (volumes) => {
        // volumes is an array of { producer, volume }
        if (volumes.length > 0) {
            const loudestProducer = volumes[0].producer;

            // Find which user owns this producer
            const room = voiceService.getRoomState(roomId);
            if (room) {
                for (const [uid, participant] of room.participants) {
                    if (participant.producer?.id === loudestProducer.id) {
                        io.to(`room:${roomId}`).emit('room:active-speaker', uid);
                        break;
                    }
                }
            }
        }
    });

    // Listen for silence
    audioLevelObserver.on('silence', () => {
        io.to(`room:${roomId}`).emit('room:active-speaker', null);
    });
}

// Helper: Broadcast to hallway when rooms change
export async function broadcastRoomUpdate(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    event: 'created' | 'updated' | 'closed',
    roomId: string
) {
    try {
        if (event === 'closed') {
            io.to('hallway').emit('hallway:room-closed', roomId);
        } else {
            const room = await roomService.getRoomById(roomId);
            const roomSummary = {
                id: room.id,
                name: room.name,
                topic: room.topic || undefined,
                languages: room.languages || [],
                participantCount: room.participantCount,
                maxParticipants: room.maxParticipants,
                ownerId: room.ownerId,
                ownerName: room.owner.username,
            };

            if (event === 'created') {
                io.to('hallway').emit('hallway:room-created', roomSummary);
            } else {
                io.to('hallway').emit('hallway:room-updated', roomSummary);
            }
        }
    } catch (error) {
        console.error('Error broadcasting room update:', error);
    }
}
