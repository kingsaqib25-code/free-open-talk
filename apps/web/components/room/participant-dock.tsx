/**
 * Participant Dock Component
 * 
 * Displays participants in a horizontal dock at the bottom of the room.
 */

'use client';

import { memo, useMemo, useState } from 'react';
import { cn } from '@/lib/design-system';
import { Avatar } from '@/components/ui';
import {
    MicOff,
    Crown,
    MoreVertical,
    UserMinus,
    Settings,
    Shield,
    ChevronLeft,
    ChevronRight,
} from '@/components/ui/icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/primitives';
import type { RoomParticipant } from './types';

export interface ParticipantDockProps {
    participants: RoomParticipant[];
    currentUserId: string;
    isViewerOwner: boolean;
    onKick?: (userId: string) => void;
    onTransferOwnership?: (userId: string) => void;
}

// Role badge colors mapping
const ROLE_COLORS = {
    owner: {
        bg: 'bg-green-600',
        text: 'text-white',
        label: 'Owner',
    },
    coOwner: {
        bg: 'bg-orange-600',
        text: 'text-white',
        label: 'Co-Owner',
    },
    moderator: {
        bg: 'bg-amber-600',
        text: 'text-white',
        label: 'Mod',
    },
    participant: {
        bg: 'bg-transparent',
        text: 'text-transparent',
        label: '',
    },
};

// Avatar background colors for initials — warm theme palette
const AVATAR_COLORS = [
    'bg-orange-600',
    'bg-amber-600',
    'bg-yellow-600',
    'bg-orange-700',
    'bg-amber-500',
    'bg-yellow-700',
    'bg-orange-500',
    'bg-amber-700',
    'bg-stone-500',
    'bg-amber-800',
];

/**
 * Get consistent color for a user based on their ID
 */
function getAvatarColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Main participant dock component
 */
export const ParticipantDock = memo(function ParticipantDock({
    participants,
    currentUserId,
    isViewerOwner,
    onKick,
    onTransferOwnership,
}: ParticipantDockProps) {
    const [scrollIndex, setScrollIndex] = useState(0);

    // Sort participants: owner first, then co-owners, then rest
    const sortedParticipants = useMemo(() => {
        return [...participants].sort((a, b) => {
            if (a.isOwner && !b.isOwner) return -1;
            if (!a.isOwner && b.isOwner) return 1;
            return 0;
        });
    }, [participants]);

    // Calculate visible participants for mobile scrolling
    const visibleCount = 6; // Max visible on mobile
    const canScrollLeft = scrollIndex > 0;
    const canScrollRight = scrollIndex + visibleCount < sortedParticipants.length;

    const handleScrollLeft = () => {
        setScrollIndex(Math.max(0, scrollIndex - 1));
    };

    const handleScrollRight = () => {
        setScrollIndex(Math.min(sortedParticipants.length - visibleCount, scrollIndex + 1));
    };

    return (
        <div className="relative w-full">
            {/* Scroll buttons for mobile */}
            {canScrollLeft && (
                <button
                    onClick={handleScrollLeft}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70 transition-all md:hidden"
                >
                    <ChevronLeft className="h-5 w-5" />
                </button>
            )}

            {canScrollRight && (
                <button
                    onClick={handleScrollRight}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70 transition-all md:hidden"
                >
                    <ChevronRight className="h-5 w-5" />
                </button>
            )}

            {/* Participants container */}
            <div className="flex items-end justify-center gap-2 sm:gap-3 px-2 py-3 overflow-x-auto scrollbar-hide">
                {sortedParticipants.map((participant) => (
                    <ParticipantTile
                        key={participant.id}
                        participant={participant}
                        isCurrentUser={participant.id === currentUserId}
                        isViewerOwner={isViewerOwner}
                        avatarColor={getAvatarColor(participant.id)}
                        onKick={onKick}
                        onTransferOwnership={onTransferOwnership}
                    />
                ))}
            </div>
        </div>
    );
});

interface ParticipantTileProps {
    participant: RoomParticipant;
    isCurrentUser: boolean;
    isViewerOwner: boolean;
    avatarColor: string;
    onKick?: (userId: string) => void;
    onTransferOwnership?: (userId: string) => void;
}

/**
 * Individual participant tile in the dock
 */
const ParticipantTile = memo(function ParticipantTile({
    participant,
    isCurrentUser,
    isViewerOwner,
    avatarColor,
    onKick,
    onTransferOwnership,
}: ParticipantTileProps) {
    const [isHovered, setIsHovered] = useState(false);
    const displayName = participant.displayName || participant.username;
    const initials = displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const showOwnerControls = isViewerOwner && !participant.isOwner && !isCurrentUser;

    // Determine role for badge
    const role = participant.isOwner ? 'owner' : 'participant';
    const roleConfig = ROLE_COLORS[role];

    return (
        <div
            className={cn(
                'relative flex flex-col items-center group transition-all duration-200',
                'min-w-[88px] sm:min-w-[96px]',
                participant.isSpeaking && 'scale-105'
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Settings icon - top right, visible on hover */}
            {(isHovered || isCurrentUser) && (
                <div className="absolute -top-1 -right-1 z-20">
                    {showOwnerControls ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="p-1 rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors">
                                    <Settings className="h-3.5 w-3.5 text-white/80" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-[#1a1a2e] border-white/10">
                                <DropdownMenuItem
                                    onClick={() => onTransferOwnership?.(participant.id)}
                                    className="text-gray-300"
                                >
                                    <Crown className="mr-2 h-4 w-4 text-amber-400" />
                                    Make Owner
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-white/10" />
                                <DropdownMenuItem
                                    onClick={() => onKick?.(participant.id)}
                                    className="text-red-400 hover:text-red-300"
                                >
                                    <UserMinus className="mr-2 h-4 w-4" />
                                    Remove
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : isCurrentUser ? (
                        <button className="p-1 rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors">
                            <Settings className="h-3.5 w-3.5 text-white/80" />
                        </button>
                    ) : null}
                </div>
            )}

            {/* Avatar container */}
            <div
                className={cn(
                    'relative w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden transition-all duration-200',
                    participant.isSpeaking &&
                        'ring-2 ring-voice-speaking ring-offset-2 ring-offset-background-primary shadow-glow'
                )}
                style={
                    participant.isSpeaking
                        ? { animation: 'speaking 1.6s ease-in-out infinite' }
                        : undefined
                }
            >
                {/* Avatar with image or initials */}
                {participant.avatarUrl ? (
                    <img
                        src={participant.avatarUrl}
                        alt={displayName}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div
                        className={cn(
                            'w-full h-full flex items-center justify-center text-white font-bold text-2xl sm:text-3xl',
                            avatarColor
                        )}
                    >
                        {initials}
                    </div>
                )}

                {/* Role badge - bottom left */}
                {roleConfig.label && (
                    <div
                        className={cn(
                            'absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[9px] sm:text-[10px] font-semibold text-center uppercase tracking-wide',
                            roleConfig.bg,
                            roleConfig.text
                        )}
                    >
                        {roleConfig.label}
                    </div>
                )}

                {/* Verified badge - bottom left corner above role
                <div className="absolute bottom-5 left-0.5 flex items-center gap-0.5">
                    <span className="px-1 py-0.5 text-[8px] font-medium rounded bg-blue-600/90 text-white uppercase">
                        Unverified
                    </span>
                </div> */}

                {/* Mute indicator - bottom right */}
                {participant.isMuted && (
                    <div className="absolute bottom-1 right-1 p-1 rounded-full bg-black/70 backdrop-blur-sm">
                        <MicOff className="h-3 w-3 text-red-500" />
                    </div>
                )}

                {/* Speaking indicator bar - right side */}
                {participant.isSpeaking && !participant.isMuted && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 flex flex-col justify-center gap-0.5 pr-0.5">
                        <SpeakingBars level={participant.audioLevel || 0.5} />
                    </div>
                )}
            </div>
        </div>
    );
});

/**
 * Speaking indicator bars
 */
const SpeakingBars = memo(function SpeakingBars({ level }: { level: number }) {
    const bars = [0.3, 0.5, 0.8, 0.6, 0.4]; // Base heights

    return (
        <div className="flex items-end gap-[1px] h-6">
            {bars.map((baseHeight, i) => {
                const height = Math.max(0.2, baseHeight * (0.5 + level * 0.5));
                return (
                    <div
                        key={i}
                        className="w-[2px] bg-voice-speaking rounded-full transition-all duration-75"
                        style={{ height: `${height * 100}%` }}
                    />
                );
            })}
        </div>
    );
});

ParticipantDock.displayName = 'ParticipantDock';
ParticipantTile.displayName = 'ParticipantTile';
SpeakingBars.displayName = 'SpeakingBars';
