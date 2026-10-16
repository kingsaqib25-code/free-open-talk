/**
 * Voice Room Component
 * 
 * Main orchestrating component that combines all room pieces.
 * Manages voice connection lifecycle and coordinates sub-components.
 */

'use client';

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/design-system';
import { Button } from '@/components/ui';
import { Loader2, AlertCircle, RefreshCw } from '@/components/ui/icons';
import {
    useVoice,
    useVoiceConnection,
    useVoiceMute
} from '@/lib/services/p2p';
import { RoomHeader } from './room-header';
import { ParticipantsGrid } from './participants-grid';
import { AudioControls } from './audio-controls';
import { DeviceSelector } from './device-selector';
import type { RoomData, RoomParticipant } from './types';

export interface VoiceRoomProps {
    /** Room data from API */
    room: RoomData;
    /** Current user ID */
    currentUserId: string;
    /** Whether current user is owner */
    isOwner: boolean;
    /** Callback when leaving room */
    onLeave?: () => void;
    /** Callback when room is closed (owner action) */
    onRoomClosed?: () => void;
}

/**
 * Main voice room component
 */
export const VoiceRoom = memo(function VoiceRoom({
    room,
    currentUserId,
    isOwner,
    onLeave,
    onRoomClosed,
}: VoiceRoomProps) {
    const router = useRouter();
    const { isInitialized, connectionState,
        isConnecting,
        isConnected,
        isMuted,
        isSpeaking,
        error,
        remoteParticipants,
        joinRoom,
        leaveRoom,
        setMuted,
    } = useVoice();
    const { toggleMute } = useVoiceMute();

    // Local state
    const [isDeafened, setIsDeafened] = useState(false);
    const [deviceSelectorOpen, setDeviceSelectorOpen] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    // Refs for cleanup
    const hasJoinedRef = useRef(false);
    const isUnmountingRef = useRef(false);

    // Join room on mount (wait for initialization)
    useEffect(() => {
        // Wait for voice service to initialize
        if (!isInitialized) return;

        // Prevent duplicate joins
        if (hasJoinedRef.current) return;
        hasJoinedRef.current = true;

        const join = async () => {
            try {
                await joinRoom(room.id);
            } catch (err) {
                console.error('Failed to join room:', err);
                hasJoinedRef.current = false;
            }
        };

        join();

        // Cleanup on unmount
        return () => {
            isUnmountingRef.current = true;
            leaveRoom().catch(console.error);
        };
    }, [isInitialized, room.id, joinRoom, leaveRoom]);

    // Handle leave
    const handleLeave = useCallback(async () => {
        try {
            await leaveRoom();
            onLeave?.();
            router.push('/');
        } catch (err) {
            console.error('Failed to leave room:', err);
            // Navigate anyway
            router.push('/');
        }
    }, [leaveRoom, onLeave, router]);

    // Handle mute toggle
    const handleMuteToggle = useCallback(() => {
        toggleMute();
    }, [toggleMute]);

    // Handle deafen toggle
    const handleDeafenToggle = useCallback(() => {
        setIsDeafened(prev => {
            const newDeafened = !prev;
            // If deafening, also mute
            if (newDeafened && !isMuted) {
                setMuted(true);
            }
            return newDeafened;
        });
    }, [isMuted, setMuted]);

    // Handle settings
    const handleSettings = useCallback(() => {
        setDeviceSelectorOpen(true);
    }, []);

    // Handle device selector close
    const handleDeviceSelectorClose = useCallback(() => {
        setDeviceSelectorOpen(false);
    }, []);

    // Handle retry connection
    const handleRetry = useCallback(async () => {
        hasJoinedRef.current = false;
        setRetryCount(prev => prev + 1);

        try {
            await joinRoom(room.id);
            hasJoinedRef.current = true;
        } catch (err) {
            console.error('Retry failed:', err);
            hasJoinedRef.current = false;
        }
    }, [joinRoom, room.id]);

    // Handle close room (owner only)
    const handleCloseRoom = useCallback(async () => {
        // TODO: Implement API call to close room
        await leaveRoom();
        onRoomClosed?.();
        router.push('/');
    }, [leaveRoom, onRoomClosed, router]);

    // Build participants list with voice state
    const participantsWithVoice = buildParticipantsList(
        room.participants,
        currentUserId,
        remoteParticipants,
        isMuted,
        isDeafened,
        isSpeaking
    );

    // Map connection state for header
    const headerConnectionStatus = mapConnectionStatus(connectionState);

    // Render initialization loading state
    if (!isInitialized) {
        return <ConnectingState message="Initializing voice service..." />;
    }

    // Render error state
    if (error && !isConnecting) {
        return (
            <ErrorState
                error={error}
                onRetry={handleRetry}
                retryCount={retryCount}
            />
        );
    }

    // Render connecting state
    if (isConnecting && !isConnected) {
        return <ConnectingState message="Connecting to voice..." />;
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <RoomHeader
                room={room}
                participantCount={participantsWithVoice.length}
                isOwner={isOwner}
                connectionStatus={headerConnectionStatus}
                onCloseRoom={handleCloseRoom}
            />

            {/* Main Content - Participants Grid */}
            <div className="flex-1 overflow-hidden">
                <ParticipantsGrid
                    participants={participantsWithVoice}
                    maxParticipants={room.maxParticipants}
                    currentUserId={currentUserId}
                />
            </div>

            {/* Bottom Controls */}
            <div className="flex-shrink-0">
                <AudioControls
                    onLeave={handleLeave}
                    onSettingsClick={handleSettings}
                />
            </div>

            {/* Device Selector Modal */}
            <DeviceSelector
                open={deviceSelectorOpen}
                onClose={handleDeviceSelectorClose}
            />
        </div>
    );
});

/**
 * Map voice connection state to header status
 */
function mapConnectionStatus(
    state: string
): 'connected' | 'connecting' | 'reconnecting' | 'disconnected' {
    switch (state) {
        case 'connected':
            return 'connected';
        case 'connecting':
            return 'connecting';
        case 'reconnecting':
            return 'reconnecting';
        default:
            return 'disconnected';
    }
}

/**
 * Remote participant from voice service
 */
interface VoiceRemoteParticipant {
    id: string;
    isSpeaking: boolean;
    volume: number;
}

/**
 * Build unified participants list with voice state
 */
function buildParticipantsList(
    roomParticipants: RoomParticipant[],
    currentUserId: string,
    remoteParticipants: VoiceRemoteParticipant[],
    localIsMuted: boolean,
    localIsDeafened: boolean,
    localIsSpeaking: boolean
): RoomParticipant[] {
    // Create a map for quick lookup of remote participants
    const remoteMap = new Map(
        remoteParticipants.map(p => [p.id, p])
    );

    return roomParticipants.map(p => {
        const isCurrentUser = p.id === currentUserId;
        const remote = remoteMap.get(p.id);

        return {
            ...p,
            isMuted: isCurrentUser ? localIsMuted : (remote ? false : p.isMuted),
            isDeafened: isCurrentUser ? localIsDeafened : p.isDeafened,
            isSpeaking: isCurrentUser ? localIsSpeaking : (remote?.isSpeaking ?? false),
            audioLevel: isCurrentUser ? 0 : (remote?.volume ?? 0),
        };
    });
}

/**
 * Connecting state component
 */
const ConnectingState = memo(function ConnectingState({ message }: { message?: string }) {
    return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
                <div className="absolute inset-0 rounded-full bg-primary-500/20 animate-ping" />
                <div className="relative w-16 h-16 rounded-full bg-primary-500/20 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
                </div>
            </div>
            <div className="text-center">
                <h3 className="text-lg font-semibold text-text-primary">
                    {message || 'Connecting to voice...'}
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                    Setting up your microphone and connecting to the room
                </p>
            </div>
        </div>
    );
});

/**
 * Error state component
 */
const ErrorState = memo(function ErrorState({
    error,
    onRetry,
    retryCount,
}: {
    error: Error;
    onRetry: () => void;
    retryCount: number;
}) {
    const router = useRouter();

    const handleGoHome = useCallback(() => {
        router.push('/');
    }, [router]);

    return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
            <div className="w-16 h-16 rounded-full bg-status-error/20 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-status-error" />
            </div>
            <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold text-text-primary">Failed to connect</h3>
                <p className="text-sm text-text-secondary mt-1">
                    {error.message || 'Unable to connect to the voice room. Please try again.'}
                </p>
            </div>
            <div className="flex gap-3">
                <Button variant="ghost" onClick={handleGoHome}>
                    Go Home
                </Button>
                <Button variant="primary" onClick={onRetry}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Try Again {retryCount > 0 && `(${retryCount})`}
                </Button>
            </div>
        </div>
    );
});

VoiceRoom.displayName = 'VoiceRoom';
ConnectingState.displayName = 'ConnectingState';
ErrorState.displayName = 'ErrorState';
