/**
 * Enhanced Voice Room Component (Refactored)
 * 
 * Industry-standard implementation with:
 * - Centralized participant state via useRoomSync hook
 * - Proper voice-participant state synchronization
 * - Real-time updates for joins, leaves, kicks, ownership changes
 * - Reliable voice connection with existing producer consumption
 */

'use client';

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/design-system';
import { Avatar } from '@/components/ui';
import {
    Mic,
    MicOff,
    Phone,
    Settings,
    Volume2,
    VolumeX,
    Loader2,
    AlertCircle,
    RefreshCw,
    ChevronLeft,
    Users,
    MoreVertical,
    Crown,
    LogOut,
    Trash2,
    UserMinus,
    Copy,
    Check,
} from '@/components/ui/icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/primitives';
import { useVoice, useVoiceMute } from '@/lib/services/p2p';
import { useRoomSync, toast, useAuth } from '@/lib/hooks';
import { api } from '@/lib/api';
import type { RoomData, RoomParticipant } from './types';
import Link from 'next/link';
import { DeviceSelector } from './device-selector';
import { VoiceRoomLayout } from './voice-room-layout';

export interface EnhancedVoiceRoomProps {
    room: RoomData;
    currentUserId: string;
    isOwner: boolean;
    onLeave?: () => void;
    onRoomClosed?: () => void;
}

/**
 * Main voice room component
 */
export const EnhancedVoiceRoom = memo(function EnhancedVoiceRoom({
    room: initialRoom,
    currentUserId,
    isOwner: initialIsOwner,
    onLeave,
    onRoomClosed,
}: EnhancedVoiceRoomProps) {
    const router = useRouter();
    const { user } = useAuth();

    // Voice service
    const {
        isInitialized,
        connectionState,
        isConnecting,
        isConnected,
        isMuted,
        isSpeaking,
        localAudioLevel,
        error,
        remoteParticipants,
        joinRoom,
        leaveRoom,
        setMuted,
    } = useVoice();
    const { toggleMute } = useVoiceMute();

    // Room state
    const [room] = useState<RoomData>(initialRoom);
    const [isDeafened, setIsDeafened] = useState(false);
    const [deviceSelectorOpen, setDeviceSelectorOpen] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const [isLeaving, setIsLeaving] = useState(false);
    const [copied, setCopied] = useState(false);

    // Refs
    const hasJoinedRef = useRef(false);
    const isUnmountingRef = useRef(false);

    // Participant sync hook - centralized state management
    const {
        participants,
        participantCount,
        ownerId,
        isOwner,
        setParticipantsFromServer,
        addParticipant,
    } = useRoomSync({
        roomId: room.id,
        currentUserId,
        initialOwnerId: room.ownerId,
        initialParticipants: room.participants,
        onKicked: () => {
            isUnmountingRef.current = true;
            leaveRoom().catch(console.error);
            router.push('/');
        },
        onRoomClosed: (reason) => {
            isUnmountingRef.current = true;
            leaveRoom().catch(console.error);
            onRoomClosed?.();
            router.push('/');
        },
        onOwnerChanged: (newOwnerId) => {
            console.log('[Room] Owner changed to:', newOwnerId);
        },
    });

    // Merge local state (mute, speaking, audio level) with participants for current user
    const participantsWithLocalState = participants.map(p => {
        if (p.id === currentUserId) {
            return {
                ...p,
                isMuted,
                isSpeaking,
                audioLevel: isMuted ? 0 : localAudioLevel, // Show local audio level
            };
        }

        // For remote participants, get voice state from remoteParticipants (matched by oderId)
        const remote = remoteParticipants.find(rp => rp.id === p.id);
        return {
            ...p,
            isMuted: remote ? false : p.isMuted, // If we have a consumer, they're producing audio
            isSpeaking: remote?.isSpeaking ?? false,
            audioLevel: remote?.volume ?? 0,
        };
    });

    // Join room on mount
    useEffect(() => {
        if (!isInitialized) return;
        if (hasJoinedRef.current) return;
        hasJoinedRef.current = true;

        const join = async () => {
            try {
                console.log('[Room] Joining voice room:', room.id);

                // joinRoom now returns participants and producers
                const result = await joinRoom(room.id);

                console.log('[Room] Join result:', result);

                // Update participant state with server response
                if (result?.participants) {
                    setParticipantsFromServer(result.participants);
                }

                // Add current user if not in list
                if (user && !result?.participants?.some((p: any) =>
                    (p.userId || p.oderId) === currentUserId
                )) {
                    addParticipant({
                        userId: currentUserId,
                        username: user.username,
                        displayName: user.displayName,
                        avatarUrl: user.avatarUrl,
                        role: initialIsOwner ? 'owner' : 'participant',
                        isMuted: true,
                        isSpeaking: false,
                        joinedAt: new Date().toISOString(),
                    });
                }

                toast.room.joined(room.name);
            } catch (err: any) {
                console.error('[Room] Failed to join:', err);
                hasJoinedRef.current = false;

                const message = err?.message?.toLowerCase() || '';

                if (message.includes('full')) {
                    toast.room.full();
                } else if (message.includes('already in')) {
                    toast.room.alreadyInRoom();
                } else if (message.includes('not found') || message.includes('closed')) {
                    toast.error('Room not available', 'This room has been closed or does not exist');
                    router.push('/');
                    return;
                } else {
                    toast.error('Failed to join room', err?.message || 'Please try again');
                }
            }
        };

        join();

        return () => {
            if (!isUnmountingRef.current) {
                isUnmountingRef.current = true;
                leaveRoom().catch(console.error);
            }
        };
    }, [isInitialized, room.id, room.name, joinRoom, leaveRoom, setParticipantsFromServer, addParticipant, user, currentUserId, initialIsOwner, router]);

    // Handle leave
    const handleLeave = useCallback(async () => {
        if (isLeaving) return;
        setIsLeaving(true);

        try {
            await leaveRoom();
            onLeave?.();
            router.push('/');
        } catch (err) {
            console.error('Failed to leave room:', err);
            setIsLeaving(false);
            router.push('/');
        }
    }, [leaveRoom, onLeave, router, isLeaving]);

    // Handle mute toggle
    const handleMuteToggle = useCallback(() => {
        toggleMute();
    }, [toggleMute]);

    // Handle deafen toggle
    const handleDeafenToggle = useCallback(() => {
        setIsDeafened(prev => {
            const newDeafened = !prev;
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

    // Handle retry
    const handleRetry = useCallback(async () => {
        hasJoinedRef.current = false;
        setRetryCount(prev => prev + 1);

        try {
            const result = await joinRoom(room.id);
            if (result?.participants) {
                setParticipantsFromServer(result.participants);
            }
            hasJoinedRef.current = true;
        } catch (err) {
            console.error('Retry failed:', err);
            hasJoinedRef.current = false;
        }
    }, [joinRoom, room.id, setParticipantsFromServer]);

    // Handle close room (owner only)
    const handleCloseRoom = useCallback(async () => {
        if (!confirm('Are you sure you want to close this room? All participants will be disconnected.')) {
            return;
        }

        try {
            await api.delete(`/rooms/${room.id}`);
            await leaveRoom();
            onRoomClosed?.();
            router.push('/');
        } catch (err) {
            console.error('Failed to close room:', err);
            toast.error('Failed to close room');
        }
    }, [room.id, leaveRoom, onRoomClosed, router]);

    // Handle kick user (owner only)
    const handleKickUser = useCallback(async (userId: string) => {
        try {
            await api.post(`/rooms/${room.id}/kick/${userId}`);
            toast.success('User removed from room');
        } catch (err) {
            console.error('Failed to kick user:', err);
            toast.error('Failed to remove user');
        }
    }, [room.id]);

    // Handle transfer ownership (owner only)
    const handleTransferOwnership = useCallback(async (userId: string) => {
        if (!isOwner) {
            toast.error('Only the owner can transfer ownership');
            return;
        }

        // Confirm transfer
        const participant = participants.find(p => p.id === userId);
        const targetName = participant?.displayName || participant?.username || 'this user';

        if (!confirm(`Transfer room ownership to ${targetName}? You will remain in the room as a participant.`)) {
            return;
        }

        try {
            console.log(`[Room] Transferring ownership to user ${userId}`);
            await api.post(`/rooms/${room.id}/transfer/${userId}`);

            // Success - the socket event will update UI
            toast.success(`Ownership transferred to ${targetName}`);
            console.log(`[Room] Ownership transfer successful`);
        } catch (err: any) {
            console.error('[Room] Failed to transfer ownership:', err);
            const message = err?.response?.data?.message || 'Failed to transfer ownership';
            toast.error(message);
        }
    }, [room.id, isOwner, participants]);

    // Handle copy invite link
    const handleCopyLink = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            toast.success('Link copied!');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Failed to copy link');
        }
    }, []);

    // Loading state
    if (!isInitialized) {
        return <LoadingScreen message="Initializing voice service..." />;
    }

    // Error state
    if (error && !isConnecting) {
        return (
            <ErrorScreen
                error={error}
                onRetry={handleRetry}
                retryCount={retryCount}
            />
        );
    }

    // Connecting state
    if (isConnecting && !isConnected) {
        return <LoadingScreen message="Connecting to voice..." />;
    }

    return (
        <VoiceRoomLayout
            room={room}
            participants={participantsWithLocalState}
            participantCount={participantCount}
            currentUserId={currentUserId}
            isOwner={isOwner}
            connectionState={connectionState}
            isMuted={isMuted}
            isDeafened={isDeafened}
            isLeaving={isLeaving}
            isDisconnected={connectionState === 'disconnected' || connectionState === 'failed'}
            copied={copied}
            onMuteToggle={handleMuteToggle}
            onDeafenToggle={handleDeafenToggle}
            onLeave={handleLeave}
            onSettings={handleSettings}
            onCloseRoom={handleCloseRoom}
            onCopyLink={handleCopyLink}
            onKickUser={handleKickUser}
            onTransferOwnership={handleTransferOwnership}
        />
    );
});

// 
// SUB-COMPONENTS
// 

const RoomHeader = memo(function RoomHeader({
    room,
    participantCount,
    isOwner,
    connectionState,
    onCloseRoom,
    onCopyLink,
    copied,
}: {
    room: RoomData;
    participantCount: number;
    isOwner: boolean;
    connectionState: string;
    onCloseRoom: () => void;
    onCopyLink: () => void;
    copied: boolean;
}) {
    return (
        <header className="shrink-0 border-b border-white/5 bg-[#0d0d14]/90 backdrop-blur-xl">
            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Link
                        href="/"
                        className="p-2 -ml-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </Link>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h1 className="font-semibold text-white truncate">{room.name}</h1>
                            <ConnectionIndicator state={connectionState} />
                        </div>
                        <LanguageTags languages={room.languages} />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onCopyLink}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">{copied ? 'Copied!' : 'Invite'}</span>
                    </button>

                    <div className="flex items-center gap-1 px-2 py-1 bg-white/5 rounded-lg text-xs text-gray-400">
                        <Users className="h-3.5 w-3.5" />
                        <span className="tabular-nums">{participantCount}/{room.maxParticipants}</span>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white transition-colors">
                                <MoreVertical className="h-5 w-5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-[#1a1a2e] border-white/10">
                            <DropdownMenuItem asChild>
                                <Link href="/" className="flex items-center text-gray-300 hover:text-white">
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Leave Room
                                </Link>
                            </DropdownMenuItem>

                            {isOwner && (
                                <>
                                    <DropdownMenuSeparator className="bg-white/10" />
                                    <DropdownMenuItem onClick={onCloseRoom} className="text-red-400 hover:text-red-300 focus:text-red-300">
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Close Room
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    );
});

const ConnectionIndicator = memo(function ConnectionIndicator({ state }: { state: string }) {
    const config = {
        connected: { color: 'bg-emerald-500', pulse: false },
        connecting: { color: 'bg-amber-500', pulse: true },
        reconnecting: { color: 'bg-amber-500', pulse: true },
        disconnected: { color: 'bg-red-500', pulse: false },
        failed: { color: 'bg-red-500', pulse: false },
    }[state] || { color: 'bg-gray-500', pulse: false };

    return (
        <span
            className={cn('w-2 h-2 rounded-full', config.color, config.pulse && 'animate-pulse')}
            title={state}
        />
    );
});

const LanguageTags = memo(function LanguageTags({ languages }: { languages: string[] }) {
    const displayLangs = languages.slice(0, 3);
    const remaining = languages.length - 3;

    return (
        <div className="flex items-center gap-1.5 mt-1">
            {displayLangs.map(lang => (
                <span
                    key={lang}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/5 text-gray-400 border border-white/5"
                >
                    {lang}
                </span>
            ))}
            {remaining > 0 && (
                <span className="text-[10px] text-gray-500">+{remaining}</span>
            )}
        </div>
    );
});

const ParticipantGrid = memo(function ParticipantGrid({
    participants,
    maxParticipants,
    currentUserId,
    isViewerOwner,
    onKick,
    onTransferOwnership,
}: {
    participants: RoomParticipant[];
    maxParticipants: number;
    currentUserId: string;
    isViewerOwner: boolean;
    onKick: (userId: string) => void;
    onTransferOwnership: (userId: string) => void;
}) {
    const count = participants.length;
    const gridClass = count === 1 ? 'grid-cols-1 max-w-xs'
        : count === 2 ? 'grid-cols-2 max-w-lg'
            : count <= 4 ? 'grid-cols-2 md:grid-cols-2 max-w-2xl'
                : count <= 6 ? 'grid-cols-2 md:grid-cols-3 max-w-3xl'
                    : count <= 9 ? 'grid-cols-3 max-w-4xl'
                        : 'grid-cols-3 md:grid-cols-4 max-w-5xl';

    return (
        <div className={cn('grid gap-4 mx-auto', gridClass)}>
            {participants.map((participant) => (
                <ParticipantCard
                    key={participant.id}
                    participant={participant}
                    isCurrentUser={participant.id === currentUserId}
                    isViewerOwner={isViewerOwner}
                    onKick={onKick}
                    onTransferOwnership={onTransferOwnership}
                />
            ))}
        </div>
    );
});

const ParticipantCard = memo(function ParticipantCard({
    participant,
    isCurrentUser,
    isViewerOwner,
    onKick,
    onTransferOwnership,
}: {
    participant: RoomParticipant;
    isCurrentUser: boolean;
    isViewerOwner: boolean;
    onKick: (userId: string) => void;
    onTransferOwnership: (userId: string) => void;
}) {
    const displayName = participant.displayName || participant.username;
    const showOwnerControls = isViewerOwner && !participant.isOwner && !isCurrentUser;

    return (
        <div
            className={cn(
                'relative group rounded-2xl p-6 transition-all duration-300',
                'bg-linear-to-b from-white/3 to-transparent',
                'border border-white/5',
                participant.isSpeaking && 'ring-2 ring-emerald-500/50 border-emerald-500/30 bg-emerald-500/5'
            )}
        >
            {participant.isOwner && (
                <div className="absolute top-3 left-3">
                    <div className="p-1.5 rounded-lg bg-amber-500/10">
                        <Crown className="h-4 w-4 text-amber-400" />
                    </div>
                </div>
            )}

            {isCurrentUser && (
                <div className="absolute top-3 right-3">
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/20">
                        You
                    </span>
                </div>
            )}

            {showOwnerControls && (
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                                <MoreVertical className="h-4 w-4 text-gray-400" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#1a1a2e] border-white/10">
                            <DropdownMenuItem onClick={() => onTransferOwnership(participant.id)} className="text-gray-300">
                                <Crown className="mr-2 h-4 w-4" />
                                Make Owner
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-white/10" />
                            <DropdownMenuItem
                                onClick={() => onKick(participant.id)}
                                className="text-red-400 hover:text-red-300"
                            >
                                <UserMinus className="mr-2 h-4 w-4" />
                                Remove
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}

            <div className="flex flex-col items-center">
                <div className="relative mb-4">
                    <AudioLevelRing
                        level={participant.audioLevel || 0}
                        isSpeaking={participant.isSpeaking}
                        isMuted={participant.isMuted}
                    />

                    <div className="relative z-10">
                        <Avatar
                            fallback={displayName}
                            src={participant.avatarUrl ?? undefined}
                            size="2xl"
                            className="border-4 border-[#0a0a0f]"
                        />
                    </div>

                    {participant.isMuted && (
                        <div className="absolute -bottom-1 -right-1 z-20 p-1.5 rounded-full bg-red-500 shadow-lg shadow-red-500/20">
                            <MicOff className="h-3 w-3 text-white" />
                        </div>
                    )}
                </div>

                <p className="font-medium text-white text-sm truncate max-w-full">
                    {displayName}
                </p>

                {/* Voice Level Meter - shows for all participants */}
                <VoiceMeter
                    level={participant.audioLevel || 0}
                    isMuted={participant.isMuted}
                    isSpeaking={participant.isSpeaking}
                />
            </div>
        </div>
    );
});

const AudioLevelRing = memo(function AudioLevelRing({
    level,
    isSpeaking,
    isMuted,
}: {
    level: number;
    isSpeaking: boolean;
    isMuted: boolean;
}) {
    const normalizedLevel = Math.min(1, Math.max(0, level));
    const scale = isMuted ? 1 : (1 + normalizedLevel * 0.15);
    const opacity = isMuted ? 0 : (normalizedLevel > 0.01 ? 0.4 + normalizedLevel * 0.6 : 0);

    return (
        <div
            className={cn(
                'absolute inset-0 rounded-full transition-all duration-75',
                !isMuted && normalizedLevel > 0.01 && 'bg-emerald-500/20'
            )}
            style={{
                transform: `scale(${scale})`,
                opacity,
                boxShadow: !isMuted && normalizedLevel > 0.01
                    ? `0 0 ${10 + normalizedLevel * 25}px ${normalizedLevel * 12}px rgba(16, 185, 129, ${0.15 + normalizedLevel * 0.35})`
                    : 'none',
            }}
        />
    );
});

/**
 * Voice Meter - Horizontal colored bar indicator showing audio levels
 * Classic audio meter style: green → yellow → orange → red gradient
 */
const VoiceMeter = memo(function VoiceMeter({
    level,
    isMuted,
    isSpeaking,
}: {
    level: number;
    isMuted: boolean;
    isSpeaking: boolean;
}) {
    // Industry standard: Apply noise gate to filter out background noise
    // Only show meter activity when level exceeds noise floor threshold
    const NOISE_GATE_THRESHOLD = 0.08; // Filter out background noise below ~8%
    const METER_SCALE_FACTOR = 1.2;    // Scale remaining signal for better visual response

    // Apply noise gate: levels below threshold become 0, above threshold are scaled
    const gatedLevel = level <= NOISE_GATE_THRESHOLD
        ? 0
        : Math.min(1, (level - NOISE_GATE_THRESHOLD) * METER_SCALE_FACTOR / (1 - NOISE_GATE_THRESHOLD));

    const normalizedLevel = Math.min(1, Math.max(0, gatedLevel));
    const segmentCount = 12;

    // Calculate how many segments should be "active" based on gated level
    const activeSegments = isMuted ? 0 : Math.ceil(normalizedLevel * segmentCount);

    // Define color thresholds for classic audio meter look
    // Segments 1-6: green, 7-9: yellow, 10-11: orange, 12: red
    const getSegmentColor = (index: number, isActive: boolean) => {
        if (!isActive || isMuted) return 'bg-gray-700/40';

        if (index < 6) return 'bg-green-500';      // Green zone (0-50%)
        if (index < 9) return 'bg-yellow-400';     // Yellow zone (50-75%)
        if (index < 11) return 'bg-orange-500';    // Orange zone (75-92%)
        return 'bg-red-500';                        // Red zone (92-100%)
    };

    return (
        <div className="flex items-center justify-center gap-[2px] h-3 mt-2 px-2">
            {Array.from({ length: segmentCount }).map((_, i) => {
                const isActive = i < activeSegments;

                return (
                    <div
                        key={i}
                        className={cn(
                            'w-1.5 h-2.5 rounded-[1px] transition-colors duration-75',
                            getSegmentColor(i, isActive)
                        )}
                    />
                );
            })}
        </div>
    );
});

const AudioControlBar = memo(function AudioControlBar({
    isMuted,
    isDeafened,
    isLeaving,
    isDisconnected,
    onMuteToggle,
    onDeafenToggle,
    onLeave,
    onSettings,
}: {
    isMuted: boolean;
    isDeafened: boolean;
    isLeaving: boolean;
    isDisconnected: boolean;
    onMuteToggle: () => void;
    onDeafenToggle: () => void;
    onLeave: () => void;
    onSettings: () => void;
}) {
    return (
        <div className="shrink-0 border-t border-white/5 bg-[#0d0d14]/95 backdrop-blur-xl safe-area-bottom">
            <div className="flex items-center justify-center gap-4 px-4 py-4">
                <button
                    onClick={onMuteToggle}
                    disabled={isDisconnected}
                    className={cn(
                        'relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        isMuted
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25'
                            : 'bg-white/10 hover:bg-white/15 text-white'
                    )}
                >
                    {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </button>

                <button
                    onClick={onDeafenToggle}
                    disabled={isDisconnected}
                    className={cn(
                        'flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        isDeafened
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
                    )}
                >
                    {isDeafened ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>

                <button
                    onClick={onLeave}
                    disabled={isLeaving}
                    className={cn(
                        'flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200',
                        'bg-red-500 hover:bg-red-600 text-white',
                        'shadow-lg shadow-red-500/25',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                >
                    {isLeaving ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                        <Phone className="h-6 w-6 rotate-135" />
                    )}
                </button>

                <button
                    onClick={onSettings}
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all duration-200"
                >
                    <Settings className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
});

const EmptyState = memo(function EmptyState({ onCopyLink }: { onCopyLink: () => void }) {
    return (
        <div className="mt-8 p-8 text-center rounded-2xl bg-white/2 border border-white/5 max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                <Users className="h-7 w-7 text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Waiting for others</h3>
            <p className="text-sm text-gray-400 mt-2 mb-4">
                Share the room link to invite people to join
            </p>
            <button
                onClick={onCopyLink}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-colors"
            >
                <Copy className="h-4 w-4" />
                Copy Invite Link
            </button>
        </div>
    );
});

const LoadingScreen = memo(function LoadingScreen({ message }: { message: string }) {
    return (
        <div className="flex flex-col h-dvh bg-[#0a0a0f]">
            <header className="flex items-center px-4 py-3 border-b border-white/5">
                <Link href="/" className="p-2 -ml-2 rounded-xl hover:bg-white/5 text-gray-400 transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                </Link>
            </header>

            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
                        <div className="relative w-16 h-16 rounded-full bg-violet-500/10 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
                        </div>
                    </div>
                    <p className="text-gray-400 font-medium">{message}</p>
                </div>
            </div>
        </div>
    );
});

const ErrorScreen = memo(function ErrorScreen({
    error,
    onRetry,
    retryCount,
}: {
    error: Error;
    onRetry: () => void;
    retryCount: number;
}) {
    const router = useRouter();

    return (
        <div className="flex flex-col h-dvh bg-[#0a0a0f]">
            <header className="flex items-center px-4 py-3 border-b border-white/5">
                <Link href="/" className="p-2 -ml-2 rounded-xl hover:bg-white/5 text-gray-400 transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                </Link>
            </header>

            <div className="flex-1 flex items-center justify-center p-4">
                <div className="flex flex-col items-center gap-4 max-w-md text-center">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
                        <AlertCircle className="h-8 w-8 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Failed to connect</h3>
                        <p className="text-sm text-gray-400 mt-1">{error.message || 'Please try again'}</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => router.push('/')}
                            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                        >
                            Go Home
                        </button>
                        <button
                            onClick={onRetry}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-colors"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Retry {retryCount > 0 && `(${retryCount})`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

// Display names
EnhancedVoiceRoom.displayName = 'EnhancedVoiceRoom';
RoomHeader.displayName = 'RoomHeader';
ConnectionIndicator.displayName = 'ConnectionIndicator';
LanguageTags.displayName = 'LanguageTags';
ParticipantGrid.displayName = 'ParticipantGrid';
ParticipantCard.displayName = 'ParticipantCard';
AudioLevelRing.displayName = 'AudioLevelRing';
VoiceMeter.displayName = 'VoiceMeter';
AudioControlBar.displayName = 'AudioControlBar';
EmptyState.displayName = 'EmptyState';
LoadingScreen.displayName = 'LoadingScreen';
ErrorScreen.displayName = 'ErrorScreen';
