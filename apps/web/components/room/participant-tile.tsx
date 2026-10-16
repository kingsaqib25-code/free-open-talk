/**
 * Participant Tile Component
 * 
 * Displays a single participant in the voice room grid.
 * Highly optimized to prevent unnecessary re-renders.
 */

'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/design-system';
import { Avatar, Card } from '@/components/ui';
import { MicOff, Crown, MoreVertical } from '@/components/ui/icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/primitives';
import type { RoomParticipant } from './types';

export interface ParticipantTileProps {
    /** Participant data */
    participant: RoomParticipant;
    /** Whether this is the current user */
    isCurrentUser: boolean;
    /** Whether the current viewer is the room owner */
    isViewerOwner: boolean;
    /** Callback when kick is clicked (owner only) */
    onKick?: (userId: string) => void;
    /** Callback when transfer ownership is clicked (owner only) */
    onTransferOwnership?: (userId: string) => void;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Tile shape: square grid tile or cinematic full-bleed stage tile */
    shape?: 'square' | 'cinematic';
}

/**
 * Memoized participant tile - only re-renders when props change
 */
export const ParticipantTile = memo(function ParticipantTile({
    participant,
    isCurrentUser,
    isViewerOwner,
    onKick,
    onTransferOwnership,
    size = 'md',
    shape = 'square',
}: ParticipantTileProps) {
    const isParticipantOwner = participant.isOwner;
    const isCinematic = shape === 'cinematic';

    // Memoize display name to avoid recalculation
    const displayName = useMemo(() => {
        return participant.displayName || participant.username;
    }, [participant.displayName, participant.username]);

    // Memoize avatar status
    const avatarStatus = useMemo(() => {
        if (participant.isSpeaking) return 'speaking';
        if (participant.isMuted) return 'muted';
        return 'online';
    }, [participant.isSpeaking, participant.isMuted]);

    // Memoize size classes — avatars are deliberately large (voice rooms
    // lead with presence, not thumbnails).
    const sizeClasses = useMemo(() => {
        switch (size) {
            case 'sm':
                return {
                    card: 'p-2',
                    avatar: 'lg' as const,
                    text: 'text-xs',
                    icon: 'h-3 w-3',
                };
            case 'lg':
                return {
                    card: 'p-6',
                    avatar: '3xl' as const,
                    text: 'text-lg',
                    icon: 'h-5 w-5',
                };
            default:
                return {
                    card: 'p-4',
                    avatar: '2xl' as const,
                    text: 'text-base',
                    icon: 'h-4 w-4',
                };
        }
    }, [size]);

    // Show owner controls only if current viewer is owner and this is not the owner
    const showOwnerControls = isViewerOwner && !isParticipantOwner && !isCurrentUser;

    // Show participant options (mute/kick) - can be shown by owner for any participant except self
    const showParticipantOptions = isViewerOwner && !isCurrentUser;

    return (
        <Card
            variant="interactive"
            padding="none"
            className={cn(
                'flex flex-col items-center justify-center gap-2 relative transition-all duration-200',
                isCinematic
                    ? 'h-full min-h-[300px] md:min-h-[400px]'
                    : 'aspect-square',
                sizeClasses.card,
                participant.isSpeaking &&
                    'ring-2 ring-voice-speaking ring-offset-2 ring-offset-background-primary shadow-glow'
            )}
        >
            {/* Owner Crown Badge */}
            {isParticipantOwner && (
                <div className="absolute top-2 left-2 p-1 rounded-full bg-status-warning/20">
                    <Crown className={cn(sizeClasses.icon, 'text-status-warning')} />
                </div>
            )}

            {/* "You" Badge */}
            {isCurrentUser && (
                <span className="absolute top-2 right-2 text-[10px] text-primary-400 font-medium bg-primary-500/10 px-1.5 py-0.5 rounded">
                    You
                </span>
            )}

            {/* Owner Controls Menu - Fixed visibility bug with modal and event handling */}
            {showParticipantOptions && (
                <div className="absolute top-2 right-2 z-50" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu modal={true}>
                        <DropdownMenuTrigger asChild>
                            <button
                                className="p-1 rounded-full hover:bg-surface-hover active:scale-95 transition-all"
                                aria-label="Participant options"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                }}
                            >
                                <MoreVertical className="h-4 w-4 text-text-secondary" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 z-[100]" onClick={(e) => e.stopPropagation()}>
                            {!isParticipantOwner && (
                                <>
                                    <DropdownMenuItem
                                        onClick={() => onTransferOwnership?.(participant.id)}
                                    >
                                        <Crown className="mr-2 h-4 w-4" />
                                        Make Owner
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                </>
                            )}
                            <DropdownMenuItem
                                onClick={() => onKick?.(participant.id)}
                                className="text-danger-500 focus:text-danger-500"
                            >
                                Remove from Room
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}

            {/* Avatar with warm speaking glow */}
            <div
                style={
                    participant.isSpeaking
                        ? { animation: 'speaking 1.6s ease-in-out infinite' }
                        : undefined
                }
                className="rounded-full"
            >
                <Avatar
                    fallback={displayName}
                    src={participant.avatarUrl ?? undefined}
                    size={sizeClasses.avatar}
                    status={avatarStatus}
                    showStatus
                />
            </div>

            {/* Name */}
            <p className={cn(
                'font-medium text-text-primary truncate max-w-full px-2',
                sizeClasses.text
            )}>
                {displayName}
            </p>

            {/* Mute indicator */}
            {participant.isMuted && (
                <div className="absolute bottom-2 right-2 p-1.5 rounded-full bg-surface-default shadow-sm">
                    <MicOff className={cn(sizeClasses.icon, 'text-voice-muted')} />
                </div>
            )}
        </Card>
    );
});

/**
 * Empty slot placeholder
 */
export const EmptySlot = memo(function EmptySlot({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
    const iconSize = size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';

    return (
        <div className="aspect-square rounded-2xl border-2 border-dashed border-surface-border flex items-center justify-center bg-surface-default/30">
            <div className={cn(iconSize, 'rounded-full bg-surface-default/50')} />
        </div>
    );
});

ParticipantTile.displayName = 'ParticipantTile';
EmptySlot.displayName = 'EmptySlot';
