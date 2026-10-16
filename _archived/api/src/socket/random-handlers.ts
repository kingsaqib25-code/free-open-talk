/**
 * Random Call Socket Handlers
 * 
 * Handles all WebSocket events for the random call feature.
 * Includes P2P signaling, queue management, stats broadcasting, and text chat.
 */

import { Server, Socket } from 'socket.io';
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    RandomStartQueuePayload,
    RandomIceCandidatePayload,
    RandomOfferPayload,
    RandomAnswerPayload,
    RandomEndCallPayload,
    RandomNextPartnerPayload,
    RandomReportUserPayload,
    RandomQueueResponse,
    RandomCallSession,
    RandomCallStats,
} from '@free2talk/shared';
import * as randomService from '../services/random.service.js';
import * as callHistoryService from '../services/call-history.service.js';

// Type for authenticated socket
type AuthSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
    userId?: string;
    roomId?: string;
};

// Track user socket mappings
const userSocketMap = new Map<string, string>(); // userId -> socketId

// Stats subscribers
const statsSubscribers = new Set<string>(); // socketIds subscribed to stats

// Matching interval reference
let matchingInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;
let statsInterval: NodeJS.Timeout | null = null;


// Initialize random call socket handlers
export function initRandomCallHandlers(
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    // Start background processes
    startMatchingLoop(io);
    startCleanupLoop();
    startStatsLoop(io);

    console.log('[Random] Random call handlers initialized');
}


// Register random call event handlers for a socket
export function registerRandomCallEvents(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    socket: AuthSocket
) {
    const userId = socket.userId!;

    // Track socket mapping
    userSocketMap.set(userId, socket.id);

    // Queue Events 


    // Join the random matching queue
    socket.on('random:start_queue' as any, async (
        payload: RandomStartQueuePayload,
        callback?: (response: RandomQueueResponse) => void
    ) => {
        console.log(`[Random] User ${userId} joining queue with preferences:`, payload.preferences);

        try {
            const result = await randomService.addToQueue(
                userId,
                socket.id,
                payload.preferences
            );

            if (!result.success) {
                if (callback) callback({ success: false, error: result.error });
                return;
            }

            // Get current stats
            const stats = await randomService.getStats();

            // Try immediate match
            const matchResult = await randomService.processMatchForUser(
                userId,
                (uid) => userSocketMap.get(uid)
            );

            if (matchResult.matched && matchResult.session) {
                // Match found! Notify both users immediately
                await notifyMatchFound(io, matchResult.session);
            }

            if (callback) {
                callback({
                    success: true,
                    position: result.position,
                    stats,
                });
            }
        } catch (error) {
            console.error('[Random] Error in start_queue:', error);
            if (callback) callback({ success: false, error: 'Failed to join queue' });
        }
    });

    // Leave the random matching queue
    socket.on('random:cancel_queue' as any, async (
        callback?: (response: { success: boolean }) => void
    ) => {
        console.log(`[Random] User ${userId} canceling queue`);

        try {
            await randomService.removeFromQueue(userId);
            if (callback) callback({ success: true });
        } catch (error) {
            console.error('[Random] Error in cancel_queue:', error);
            if (callback) callback({ success: false });
        }
    });

    // -------------------- P2P Signaling Events 

    // Forward ICE candidate to peer
    socket.on('random:ice_candidate' as any, async (payload: RandomIceCandidatePayload) => {
        const { sessionId, candidate } = payload;

        try {
            const partnerSocketId = await randomService.getPartnerSocketId(sessionId, userId);
            if (partnerSocketId) {
                io.to(partnerSocketId).emit('random:ice_candidate' as any, { candidate });
            } else {
                console.warn(`[Random] Partner socket not found for ICE candidate in session ${sessionId}`);
                socket.emit('random:error' as any, { message: 'Partner disconnected' });
            }
        } catch (error) {
            console.error('[Random] Error forwarding ICE candidate:', error);
        }
    });

    // Relay text chat message to partner (ephemeral - not stored in DB)
    socket.on('random:chat_message' as any, async (
        payload: { sessionId: string; message: string },
        callback?: (response: { success: boolean }) => void
    ) => {
        const { sessionId, message } = payload;

        try {
            // Validate message
            if (!message || typeof message !== 'string') {
                if (callback) callback({ success: false });
                return;
            }

            // Limit message length to prevent abuse
            const trimmedMessage = message.trim().slice(0, 500);
            if (!trimmedMessage) {
                if (callback) callback({ success: false });
                return;
            }

            const partnerSocketId = await randomService.getPartnerSocketId(sessionId, userId);
            if (partnerSocketId) {
                io.to(partnerSocketId).emit('random:chat_message' as any, {
                    message: trimmedMessage,
                    senderId: userId,
                    timestamp: Date.now(),
                });
                if (callback) callback({ success: true });
            } else {
                console.warn(`[Random] Partner socket not found for chat in session ${sessionId}`);
                socket.emit('random:error' as any, { message: 'Partner disconnected' });
                if (callback) callback({ success: false });
            }
        } catch (error) {
            console.error('[Random] Error relaying chat message:', error);
            if (callback) callback({ success: false });
        }
    });

    // Forward WebRTC offer to peer
    socket.on('random:offer' as any, async (payload: RandomOfferPayload) => {
        const { sessionId, offer } = payload;

        try {
            // Validate offer SDP
            if (!offer || !offer.type || !offer.sdp || offer.type !== 'offer') {
                console.warn(`[Random] Invalid offer from ${userId}`);
                socket.emit('random:error' as any, { message: 'Invalid offer format' });
                return;
            }

            const partnerSocketId = await randomService.getPartnerSocketId(sessionId, userId);
            if (partnerSocketId) {
                io.to(partnerSocketId).emit('random:offer' as any, { offer });
                console.log(`[Random] Forwarded offer from ${userId} to partner`);
            } else {
                console.warn(`[Random] Partner socket not found for offer in session ${sessionId}`);
                socket.emit('random:error' as any, { message: 'Partner disconnected' });
            }
        } catch (error) {
            console.error('[Random] Error forwarding offer:', error);
            socket.emit('random:error' as any, { message: 'Failed to forward offer' });
        }
    });


    // Forward WebRTC answer to peer
    socket.on('random:answer' as any, async (payload: RandomAnswerPayload) => {
        const { sessionId, answer } = payload;

        try {
            // Validate answer SDP
            if (!answer || !answer.type || !answer.sdp || answer.type !== 'answer') {
                console.warn(`[Random] Invalid answer from ${userId}`);
                socket.emit('random:error' as any, { message: 'Invalid answer format' });
                return;
            }

            const partnerSocketId = await randomService.getPartnerSocketId(sessionId, userId);
            if (partnerSocketId) {
                io.to(partnerSocketId).emit('random:answer' as any, { answer });

                // Mark call as connected
                await randomService.markCallConnected(sessionId);

                // Record in database
                await callHistoryService.recordCallConnected(sessionId);

                console.log(`[Random] Forwarded answer from ${userId} - call connected`);
            } else {
                console.warn(`[Random] Partner socket not found for answer in session ${sessionId}`);
                socket.emit('random:error' as any, { message: 'Partner disconnected' });
            }
        } catch (error) {
            console.error('[Random] Error forwarding answer:', error);
            socket.emit('random:error' as any, { message: 'Failed to forward answer' });
        }
    });

    // -------------------- Call Control Events 

    // Skip current partner and find next
    socket.on('random:next_partner' as any, async (
        payload: RandomNextPartnerPayload,
        callback?: (response: RandomQueueResponse) => void
    ) => {
        const { sessionId } = payload;
        console.log(`[Random] User ${userId} requesting next partner`);

        try {
            // End current call
            const endResult = await randomService.endCallSession(sessionId, 'next_clicked');

            if (endResult) {
                // Record call end in history
                await callHistoryService.recordCallEnd(sessionId, 'skipped');

                // Notify the other user
                const partnerId = endResult.user1Id === userId ? endResult.user2Id : endResult.user1Id;
                if (partnerId) {
                    const partnerSocketId = userSocketMap.get(partnerId);
                    if (partnerSocketId) {
                        io.to(partnerSocketId).emit('random:call_ended' as any, {
                            reason: 'partner_left',
                            message: 'Partner clicked next',
                        });
                    }
                }
            }

            // Re-queue the user for next match
            const queueResult = await randomService.addToQueue(userId, socket.id);
            const stats = await randomService.getStats();

            // Try immediate match
            const matchResult = await randomService.processMatchForUser(
                userId,
                (uid) => userSocketMap.get(uid)
            );

            if (matchResult.matched && matchResult.session) {
                await notifyMatchFound(io, matchResult.session);
            }

            if (callback) {
                callback({
                    success: true,
                    position: queueResult.position,
                    stats,
                });
            }
        } catch (error) {
            console.error('[Random] Error in next_partner:', error);
            if (callback) callback({ success: false, error: 'Failed to find next partner' });
        }
    });

    // End the current call
    socket.on('random:end_call' as any, async (
        payload: RandomEndCallPayload,
        callback?: (response: { success: boolean }) => void
    ) => {
        const { sessionId, rating } = payload;
        console.log(`[Random] User ${userId} ending call ${sessionId} with rating: ${rating}`);

        try {
            const endResult = await randomService.endCallSession(sessionId, 'user_ended');

            if (endResult) {
                // Notify the other user
                const partnerId = endResult.user1Id === userId ? endResult.user2Id : endResult.user1Id;
                if (partnerId) {
                    const partnerSocketId = userSocketMap.get(partnerId);
                    if (partnerSocketId) {
                        io.to(partnerSocketId).emit('random:call_ended' as any, {
                            reason: 'partner_left',
                            message: 'Partner ended the call',
                        });
                    }
                }
            }

            // Record call end in history
            await callHistoryService.recordCallEnd(sessionId, 'user_ended');

            // Save rating if provided
            if (rating !== undefined && rating !== null) {
                await callHistoryService.saveCallRating(sessionId, userId, rating);
            }

            if (callback) callback({ success: true });
        } catch (error) {
            console.error('[Random] Error in end_call:', error);
            if (callback) callback({ success: false });
        }
    });

    // Report a user for inappropriate behavior
    socket.on('random:report_user' as any, async (
        payload: RandomReportUserPayload,
        callback?: (response: { success: boolean }) => void
    ) => {
        const { sessionId, reason, details } = payload;
        console.log(`[Random] User ${userId} reporting in session ${sessionId}: ${reason}`);

        try {
            // Get the reported user
            const partnerId = await randomService.getPartnerId(sessionId, userId);

            if (partnerId) {
                // Block this user for the reporter
                await randomService.blockUser(userId, partnerId);

                console.log(`[Random] User ${partnerId} reported by ${userId}: ${reason}`);
            }

            if (callback) callback({ success: true });
        } catch (error) {
            console.error('[Random] Error in report_user:', error);
            if (callback) callback({ success: false });
        }
    });

    //  Stats Events 

    // Subscribe to stats updates
    socket.on('random:subscribe_stats' as any, () => {
        statsSubscribers.add(socket.id);
        console.log(`[Random] Socket ${socket.id} subscribed to stats`);
    });

    // Unsubscribe from stats updates
    socket.on('random:unsubscribe_stats' as any, () => {
        statsSubscribers.delete(socket.id);
        console.log(`[Random] Socket ${socket.id} unsubscribed from stats`);
    });

    // ------------------- Disconnect Handler 

    socket.on('disconnect', async () => {
        console.log(`[Random] User ${userId} disconnected`);

        // Remove from socket map
        userSocketMap.delete(userId);
        statsSubscribers.delete(socket.id);

        // Remove from queue
        await randomService.removeFromQueue(userId);

        // End any active call
        const session = await randomService.getUserCallSession(userId);
        if (session) {
            const endResult = await randomService.endCallSession(session.sessionId, 'disconnected');

            // Record call end in history
            await callHistoryService.recordCallEnd(session.sessionId, 'disconnected');

            if (endResult) {
                // Notify the other user
                const partnerId = endResult.user1Id === userId ? endResult.user2Id : endResult.user1Id;
                if (partnerId) {
                    const partnerSocketId = userSocketMap.get(partnerId);
                    if (partnerSocketId) {
                        io.to(partnerSocketId).emit('random:partner_disconnected' as any);
                    }
                }
            }
        } else {
            // If not in call, explicitly remove from active users set
            // (endCallSession already removes both users, but this is a fallback)
            await randomService.removeUserFromActiveSet(userId);
        }
    });
}

// ---------------------- Helper Functions 


// Notify both users that a match was found
async function notifyMatchFound(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    session: Awaited<ReturnType<typeof randomService.createCallSession>>
): Promise<void> {
    // Get user info for both users
    const [user1Info, user2Info] = await Promise.all([
        randomService.getUserInfo(session.user1Id),
        randomService.getUserInfo(session.user2Id),
    ]);

    if (!user1Info || !user2Info) {
        console.error('[Random] Failed to get user info for match notification');
        return;
    }

    // Notify user1 (initiator)
    const user1Payload: RandomCallSession = {
        sessionId: session.sessionId,
        partnerId: session.user2Id,
        partnerInfo: user2Info,
        isInitiator: true,
        matchedLanguage: session.matchedLanguage,
    };
    io.to(session.user1SocketId).emit('random:match_instant' as any, user1Payload);

    // Notify user2 (receiver)
    const user2Payload: RandomCallSession = {
        sessionId: session.sessionId,
        partnerId: session.user1Id,
        partnerInfo: user1Info,
        isInitiator: false,
        matchedLanguage: session.matchedLanguage,
    };
    io.to(session.user2SocketId).emit('random:match_instant' as any, user2Payload);

    // Record call start in database
    await callHistoryService.recordCallStart(
        session.sessionId,
        session.user1Id,
        session.user2Id,
        session.matchedLanguage
    );

    console.log(`[Random] Match notification sent: ${session.user1Id} <-> ${session.user2Id}`);
}

// ------------------- Background Processes 


// Start the matching loop (processes queue every 100ms)
function startMatchingLoop(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    if (matchingInterval) {
        clearInterval(matchingInterval);
    }

    matchingInterval = setInterval(async () => {
        try {
            // Get all users in queue
            const queueLength = await randomService.getStats();

            if (queueLength.inQueue < 2) {
                return; // Not enough users to match
            }

            // The matching is done when users join queue (immediate matching)
            // This loop is a backup to catch any missed matches
        } catch (error) {
            console.error('[Random] Error in matching loop:', error);
        }
    }, 100);

    console.log('[Random] Matching loop started');
}

// Start the cleanup loop (runs every 10 seconds)
function startCleanupLoop() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(async () => {
        try {
            const queueCleaned = await randomService.cleanupStaleEntries();
            const sessionsCleaned = await randomService.cleanupStaleSessions();

            if (queueCleaned > 0 || sessionsCleaned > 0) {
                console.log(`[Random] Cleanup: ${queueCleaned} queue entries, ${sessionsCleaned} sessions`);
            }
        } catch (error) {
            console.error('[Random] Error in cleanup loop:', error);
        }
    }, 10000);

    console.log('[Random] Cleanup loop started');
}

// Start the stats broadcast loop (runs every 2 seconds)
function startStatsLoop(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    if (statsInterval) {
        clearInterval(statsInterval);
    }

    statsInterval = setInterval(async () => {
        if (statsSubscribers.size === 0) {
            return; // No subscribers
        }

        try {
            const stats = await randomService.getStats();

            // Broadcast to all subscribers
            for (const socketId of statsSubscribers) {
                io.to(socketId).emit('random:stats_update' as any, stats);
            }
        } catch (error) {
            console.error('[Random] Error in stats loop:', error);
        }
    }, 2000);

    console.log('[Random] Stats broadcast loop started');
}


// Stop all background processes (for graceful shutdown)
export function stopRandomCallProcesses() {
    if (matchingInterval) {
        clearInterval(matchingInterval);
        matchingInterval = null;
    }
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    console.log('[Random] Background processes stopped');
}


// Get user socket ID (for external use)
export function getUserSocketId(userId: string): string | undefined {
    return userSocketMap.get(userId);
}
