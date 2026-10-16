/**
 * Room Synchronization Hook
 * 
 * Industry-standard approach for real-time participant synchronization:
 * 
 * 1. On join: Receive full participant list + existing voice producers
 * 2. Listen for: user-joined, user-left, user-kicked, owner-changed, room-closed
 * 3. Merge voice state with participant list for UI rendering
 * 4. Handle reconnection with full state re-sync
 * 
 * This provides a single source of truth for room participant state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useVoice } from '@/lib/services/p2p';
import { toast } from './use-toast';
import type { RoomParticipant } from '@/components/room/types';

export interface RoomSyncState {
    /** All participants in the room */
    participants: RoomParticipant[];
    /** Current room owner ID */
    ownerId: string;
    /** Whether the current user is the owner */
    isOwner: boolean;
    /** Sync status */
    syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
    /** Last sync error */
    error: Error | null;
}

export interface UseRoomSyncOptions {
    /** Room ID */
    roomId: string;
    /** Current user ID */
    currentUserId: string;
    /** Initial owner ID from room data */
    initialOwnerId: string;
    /** Initial participants (if any) */
    initialParticipants?: RoomParticipant[];
    /** Callback when user is kicked */
    onKicked?: () => void;
    /** Callback when room is closed */
    onRoomClosed?: (reason: string) => void;
    /** Callback when ownership changes */
    onOwnerChanged?: (newOwnerId: string) => void;
}

/**
 * Hook for synchronized room participant management
 */
export function useRoomSync({
    roomId,
    currentUserId,
    initialOwnerId,
    initialParticipants = [],
    onKicked,
    onRoomClosed,
    onOwnerChanged,
}: UseRoomSyncOptions) {
    // State
    const [state, setState] = useState<RoomSyncState>({
        participants: initialParticipants,
        ownerId: initialOwnerId,
        isOwner: initialOwnerId === currentUserId,
        syncStatus: 'idle',
        error: null,
    });

    // Refs for callbacks to avoid re-subscriptions
    const callbacksRef = useRef({ onKicked, onRoomClosed, onOwnerChanged });
    callbacksRef.current = { onKicked, onRoomClosed, onOwnerChanged };

    // Ref to access current state in event handlers
    const stateRef = useRef(state);
    stateRef.current = state;

    // Voice service for remote participant audio state
    const { remoteParticipants, isMuted, isSpeaking, localAudioLevel, isConnected } = useVoice();

    /**
     * Transform server participant to UI participant format
     */
    const transformParticipant = useCallback((p: any, ownerId: string): RoomParticipant => ({
        id: p.userId || p.oderId || p.id,
        username: p.username || 'Unknown',
        displayName: p.displayName || null,
        avatarUrl: p.avatarUrl || null,
        isOwner: (p.userId || p.oderId || p.id) === ownerId,
        isMuted: p.isMuted ?? true,
        isDeafened: false,
        isSpeaking: false,
        audioLevel: 0,
        joinedAt: p.joinedAt || new Date().toISOString(),
    }), []);

    /**
     * Set participants from server response
     */
    const setParticipantsFromServer = useCallback((
        serverParticipants: any[],
        newOwnerId?: string
    ) => {
        const ownerId = newOwnerId || state.ownerId;

        setState(prev => ({
            ...prev,
            participants: serverParticipants.map(p => transformParticipant(p, ownerId)),
            ownerId,
            isOwner: ownerId === currentUserId,
            syncStatus: 'synced',
            error: null,
        }));
    }, [state.ownerId, currentUserId, transformParticipant]);

    /**
     * Add a participant to the list
     */
    const addParticipant = useCallback((participant: any) => {
        setState(prev => {
            const id = participant.userId || participant.oderId || participant.id;

            // Don't add if already exists
            if (prev.participants.some(p => p.id === id)) {
                return prev;
            }

            const newParticipant = transformParticipant(participant, prev.ownerId);

            return {
                ...prev,
                participants: [...prev.participants, newParticipant],
            };
        });
    }, [transformParticipant]);

    /**
     * Remove a participant from the list
     */
    const removeParticipant = useCallback((oderId: string) => {
        setState(prev => ({
            ...prev,
            participants: prev.participants.filter(p => p.id !== oderId),
        }));
    }, []);

    /**
     * Update participant mute state
     */
    const updateParticipantMute = useCallback((oderId: string, muted: boolean) => {
        setState(prev => ({
            ...prev,
            participants: prev.participants.map(p =>
                p.id === oderId ? { ...p, isMuted: muted } : p
            ),
        }));
    }, []);

    /**
     * Update owner
     */
    const updateOwner = useCallback((newOwnerId: string) => {
        setState(prev => ({
            ...prev,
            ownerId: newOwnerId,
            isOwner: newOwnerId === currentUserId,
            participants: prev.participants.map(p => ({
                ...p,
                isOwner: p.id === newOwnerId,
            })),
        }));
        callbacksRef.current.onOwnerChanged?.(newOwnerId);
    }, [currentUserId]);

    /**
     * Request full sync from server (for reconnection scenarios)
     */
    const requestSync = useCallback(async () => {
        setState(prev => ({ ...prev, syncStatus: 'syncing' }));

        try {
            const socket = getSocket();

            return new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Sync timeout'));
                }, 10000);

                // Use type assertion since room:sync is a new event
                (socket as any).emit('room:sync', roomId, (response: any) => {
                    clearTimeout(timeout);

                    if (response?.success && response.participants) {
                        setParticipantsFromServer(response.participants);
                        resolve();
                    } else {
                        reject(new Error('Sync failed'));
                    }
                });
            });
        } catch (error) {
            setState(prev => ({
                ...prev,
                syncStatus: 'error',
                error: error instanceof Error ? error : new Error('Sync failed'),
            }));
            throw error;
        }
    }, [roomId, setParticipantsFromServer]);

    // Setup socket event listeners
    useEffect(() => {
        const socket = getSocket();
        console.log('[RoomSync] Setting up socket listeners - Socket ID:', socket.id, 'Connected:', socket.connected);

        // Debug: Log all incoming events
        const handleAnyEvent = (event: string, ...args: any[]) => {
            if (event.startsWith('room:')) {
                console.log(`[RoomSync] Received event: ${event}`, args);
            }
        };
        socket.onAny(handleAnyEvent);

        // Handle socket reconnection - need to rejoin room channel
        const handleReconnect = () => {
            console.log('[RoomSync] Socket reconnected, requesting room sync');
            // When socket reconnects, we need to rejoin the room channel
            // The voice service will call room:join on reconnect, which adds us to the channel
            // But we should request a sync to ensure we have the latest state
            requestSync().catch(err => {
                console.error('[RoomSync] Failed to sync after reconnect:', err);
            });
        };

        // Listen for reconnection via socket.io manager
        socket.io.on('reconnect', handleReconnect);

        // User joined
        const handleUserJoined = (participant: any) => {
            const id = participant.userId || participant.oderId || participant.id;
            console.log('[RoomSync] User joined:', id, 'Full data:', participant);

            // Skip if it's the current user (we already have our own state)
            if (id === currentUserId) return;

            addParticipant(participant);

            const name = participant.displayName || participant.username;
            toast.room.userJoined(name);
        };

        // User left
        const handleUserLeft = (oderId: string) => {
            console.log('[RoomSync] User left:', oderId);
            removeParticipant(oderId);
        };

        // User kicked
        const handleUserKicked = (oderId: string) => {
            console.log('[RoomSync] User kicked:', oderId);

            if (oderId === currentUserId) {
                toast.room.kicked();
                callbacksRef.current.onKicked?.();
            } else {
                removeParticipant(oderId);
            }
        };

        // Owner changed
        const handleOwnerChanged = (newOwnerId: string) => {
            console.log('[RoomSync] Owner changed to:', newOwnerId);

            // Get participant names for better toast messages
            const participants = stateRef.current.participants;
            const newOwner = participants.find(p => p.id === newOwnerId);
            const newOwnerName = newOwner?.displayName || newOwner?.username || 'Unknown';

            if (newOwnerId === currentUserId) {
                toast.success(`You are now the room owner`);
            } else if (stateRef.current.ownerId === currentUserId) {
                // Current user was the owner and transferred ownership
                toast.info(`${newOwnerName} is now the room owner`);
            } else {
                // Another participant became owner
                toast.info(`${newOwnerName} is now the room owner`);
            }

            updateOwner(newOwnerId);
        };

        // Room closed
        const handleRoomClosed = (reason: string) => {
            console.log('[RoomSync] Room closed:', reason);
            toast.room.closed(reason || 'The room has been closed');
            callbacksRef.current.onRoomClosed?.(reason);
        };

        // User muted
        const handleUserMuted = (oderId: string, muted: boolean) => {
            console.log('[RoomSync] User muted:', oderId, muted);
            updateParticipantMute(oderId, muted);
        };

        // Full participant list update (for reconciliation)
        const handleParticipantsUpdated = (data: { participants: any[]; reason: string }) => {
            console.log('[RoomSync] Participants updated:', data.reason, '- count:', data.participants.length);
            // Update with full participant list from server
            setParticipantsFromServer(data.participants);
        };

        socket.on('room:user-joined', handleUserJoined);
        socket.on('room:user-left', handleUserLeft);
        socket.on('room:user-kicked', handleUserKicked);
        socket.on('room:owner-changed', handleOwnerChanged);
        socket.on('room:closed', handleRoomClosed);
        socket.on('room:user-muted', handleUserMuted);
        // Note: Using type assertion since 'room:participants-updated' is a new event
        (socket as any).on('room:participants-updated', handleParticipantsUpdated);

        console.log('[RoomSync] Event listeners registered for room:', roomId);

        return () => {
            console.log('[RoomSync] Cleaning up event listeners for room:', roomId);
            socket.offAny(handleAnyEvent);
            socket.io.off('reconnect', handleReconnect);
            socket.off('room:user-joined', handleUserJoined);
            socket.off('room:user-left', handleUserLeft);
            socket.off('room:user-kicked', handleUserKicked);
            socket.off('room:owner-changed', handleOwnerChanged);
            socket.off('room:closed', handleRoomClosed);
            socket.off('room:user-muted', handleUserMuted);
            (socket as any).off('room:participants-updated', handleParticipantsUpdated);
        };
    }, [roomId, currentUserId, addParticipant, removeParticipant, updateParticipantMute, updateOwner, requestSync, setParticipantsFromServer]);

    /**
     * Merge voice state with participant list for final UI representation
     */
    const participantsWithVoice = state.participants.map(p => {
        const isCurrentUser = p.id === currentUserId;
        // Match by oderId (user ID) not by id (consumer ID)
        const remoteParticipant = remoteParticipants.find(rp => rp.id === p.id);

        return {
            ...p,
            // For mute: if current user, use local state; if remote has consumer, they're producing (not muted); else use participant state
            isMuted: isCurrentUser ? isMuted : (remoteParticipant ? false : p.isMuted),
            isSpeaking: isCurrentUser ? isSpeaking : (remoteParticipant?.isSpeaking ?? false),
            audioLevel: isCurrentUser ? (isMuted ? 0 : localAudioLevel) : (remoteParticipant?.volume ?? 0),
        };
    }).sort((a, b) => {
        // Owner first, then by join time
        if (a.isOwner) return -1;
        if (b.isOwner) return 1;
        return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    });

    return {
        /** Participants with merged voice state - use this for rendering */
        participants: participantsWithVoice,
        /** Raw participant count */
        participantCount: state.participants.length,
        /** Current owner ID */
        ownerId: state.ownerId,
        /** Whether current user is owner */
        isOwner: state.isOwner,
        /** Current sync status */
        syncStatus: state.syncStatus,
        /** Last sync error */
        error: state.error,
        /** Set participants from server response (call after joinRoom) */
        setParticipantsFromServer,
        /** Add current user to participant list */
        addParticipant,
        /** Request full sync from server */
        requestSync,
    };
}
