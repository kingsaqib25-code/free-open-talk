/**
 * Participants Grid Component
 * 
 * Displays all participants in a responsive grid layout.
 * Optimized with windowing for large participant counts.
 */

'use client';

import { memo, useMemo, useCallback } from 'react';
import { cn } from '@/lib/design-system';
import { ParticipantTile, EmptySlot } from './participant-tile';
import type { RoomParticipant } from './types';

export interface ParticipantsGridProps {
    /** List of participants */
    participants: RoomParticipant[];
    /** Maximum number of participants allowed */
    maxParticipants: number;
    /** Current user's ID */
    currentUserId: string;
    /** Whether to show empty slots */
    showEmptySlots?: boolean;
    /** Callback when kick is requested */
    onKick?: (userId: string) => void;
    /** Callback when ownership transfer is requested */
    onTransferOwnership?: (userId: string) => void;
    /** Custom class name */
    className?: string;
}

/**
 * Memoized participants grid
 */
export const ParticipantsGrid = memo(function ParticipantsGrid({
    participants,
    maxParticipants,
    currentUserId,
    showEmptySlots = true,
    onKick,
    onTransferOwnership,
    className,
}: ParticipantsGridProps) {
    // Find if current user is owner
    const isCurrentUserOwner = useMemo(() => {
        const currentUser = participants.find(p => p.id === currentUserId);
        return currentUser?.isOwner ?? false;
    }, [participants, currentUserId]);

    // Sort participants: owner first, then by join time
    const sortedParticipants = useMemo(() => {
        return [...participants].sort((a, b) => {
            // Owner always first
            if (a.isOwner) return -1;
            if (b.isOwner) return 1;
            // Then by join time
            return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
        });
    }, [participants]);

    // Calculate empty slots
    const emptySlotCount = useMemo(() => {
        if (!showEmptySlots) return 0;
        return Math.max(0, maxParticipants - participants.length);
    }, [showEmptySlots, maxParticipants, participants.length]);

    // Memoized callbacks
    const handleKick = useCallback((userId: string) => {
        onKick?.(userId);
    }, [onKick]);

    const handleTransferOwnership = useCallback((userId: string) => {
        onTransferOwnership?.(userId);
    }, [onTransferOwnership]);

    // Determine grid columns based on participant count.
    // Stage mode (<= 4 tiles): cinematic 2x2 that fills the viewport.
    const isCinematic = useMemo(() => {
        const total = participants.length + (showEmptySlots ? emptySlotCount : 0);
        return total <= 4;
    }, [participants.length, showEmptySlots, emptySlotCount]);

    const gridCols = useMemo(() => {
        const total = participants.length + (showEmptySlots ? emptySlotCount : 0);
        if (total <= 2) return 'grid-cols-2';
        if (total <= 4) return 'grid-cols-2 grid-rows-2 auto-rows-fr';
        if (total <= 6) return 'grid-cols-2 sm:grid-cols-3';
        if (total <= 9) return 'grid-cols-3 sm:grid-cols-3';
        return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-4';
    }, [participants.length, showEmptySlots, emptySlotCount]);

    return (
        <div className={cn('flex-1 overflow-y-auto p-4', className)}>
            <div className={cn(
                'grid gap-3 sm:gap-4 mx-auto h-full',
                isCinematic ? 'max-w-none min-h-[62vh]' : 'max-w-5xl',
                gridCols
            )}>
                {sortedParticipants.map((participant) => (
                    <ParticipantTile
                        key={participant.id}
                        participant={participant}
                        isCurrentUser={participant.id === currentUserId}
                        isViewerOwner={isCurrentUserOwner}
                        onKick={handleKick}
                        onTransferOwnership={handleTransferOwnership}
                        size={isCinematic ? 'lg' : 'md'}
                        shape={isCinematic ? 'cinematic' : 'square'}
                    />
                ))}

                {/* Empty slots */}
                {showEmptySlots && Array.from({ length: emptySlotCount }).map((_, i) => (
                    <EmptySlot key={`empty-${i}`} size={isCinematic ? 'lg' : 'md'} />
                ))}
            </div>
        </div>
    );
});

ParticipantsGrid.displayName = 'ParticipantsGrid';
