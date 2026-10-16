/**
 * Voice Room Layout Component
 * 
 * Redesigned room layout inspired by free4talk.com:
 * - Top: Floating control bar (mic, screen share, signal, leave)
 * - Center: Large empty canvas area (for future content: whiteboard, documents)
 * - Bottom: Participant dock with profile tiles
 * 
 * Fully responsive for mobile and desktop.
 */

'use client';

import { memo, useCallback, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/design-system';
import {
    ChevronLeft,
    Users,
    MoreVertical,
    Crown,
    LogOut,
    Trash2,
    Copy,
    Check,
    Share2,
    Settings,
    Maximize2,
    Grid3X3,
} from '@/components/ui/icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/primitives';
import { RoomControlBar } from './room-control-bar';
import { ParticipantDock } from './participant-dock';
import { DeviceSelector } from './device-selector';
import type { RoomData, RoomParticipant } from './types';

export interface VoiceRoomLayoutProps {
    room: RoomData;
    participants: RoomParticipant[];
    participantCount: number;
    currentUserId: string;
    isOwner: boolean;
    connectionState: string;
    // Control states
    isMuted: boolean;
    isDeafened: boolean;
    isLeaving: boolean;
    isDisconnected: boolean;
    copied: boolean;
    // Callbacks
    onMuteToggle: () => void;
    onDeafenToggle: () => void;
    onLeave: () => void;
    onSettings: () => void;
    onCloseRoom: () => void;
    onCopyLink: () => void;
    onKickUser: (userId: string) => void;
    onTransferOwnership: (userId: string) => void;
}

/**
 * Main voice room layout component
 */
export const VoiceRoomLayout = memo(function VoiceRoomLayout({
    room,
    participants,
    participantCount,
    currentUserId,
    isOwner,
    connectionState,
    isMuted,
    isDeafened,
    isLeaving,
    isDisconnected,
    copied,
    onMuteToggle,
    onDeafenToggle,
    onLeave,
    onSettings,
    onCloseRoom,
    onCopyLink,
    onKickUser,
    onTransferOwnership,
}: VoiceRoomLayoutProps) {
    const [deviceSelectorOpen, setDeviceSelectorOpen] = useState(false);

    const handleSettingsClick = useCallback(() => {
        setDeviceSelectorOpen(true);
        onSettings?.();
    }, [onSettings]);

    // Determine connection quality from state
    const connectionQuality = connectionState === 'connected'
        ? 'excellent'
        : connectionState === 'connecting' || connectionState === 'reconnecting'
            ? 'fair'
            : 'disconnected';

    return (
        <div className="flex flex-col h-dvh bg-background-primary overflow-hidden">
            {/* Top Section: Header + Controls */}
            <div className="shrink-0 relative z-20">
                {/* Compact Header */}
                <CompactHeader
                    room={room}
                    participantCount={participantCount}
                    isOwner={isOwner}
                    connectionState={connectionState}
                    copied={copied}
                    onCloseRoom={onCloseRoom}
                    onCopyLink={onCopyLink}
                />

                {/* Floating Control Bar */}
                <div className="absolute left-1/2 -translate-x-1/2 top-14 sm:top-16 z-30">
                    <RoomControlBar
                        isMuted={isMuted}
                        isDeafened={isDeafened}
                        isLeaving={isLeaving}
                        isDisconnected={isDisconnected}
                        connectionQuality={connectionQuality as any}
                        onMuteToggle={onMuteToggle}
                        onDeafenToggle={onDeafenToggle}
                        onLeave={onLeave}
                        onSettings={handleSettingsClick}
                    />
                </div>
            </div>

            {/* Main Content Area - Large empty canvas */}
            <main className="flex-1 relative overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-linear-to-b from-background-primary via-background-secondary to-background-primary" />

                {/* Future content area placeholder */}
                <div className="relative h-full flex items-center justify-center">
                    <ContentPlaceholder
                        participantCount={participantCount}
                        onCopyLink={onCopyLink}
                    />
                </div>

                {/* Subtle grid pattern overlay */}
                <div
                    className="absolute inset-0 opacity-[0.02] pointer-events-none"
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
                        `,
                        backgroundSize: '40px 40px',
                    }}
                />
            </main>

            {/* Bottom Section: Participant Dock */}
            <div className="shrink-0 relative z-20 bg-linear-to-t from-black/40 via-black/20 to-transparent">
                <ParticipantDock
                    participants={participants}
                    currentUserId={currentUserId}
                    isViewerOwner={isOwner}
                    onKick={onKickUser}
                    onTransferOwnership={onTransferOwnership}
                />
            </div>

            {/* Device Selector Modal */}
            <DeviceSelector
                open={deviceSelectorOpen}
                onClose={() => setDeviceSelectorOpen(false)}
            />
        </div>
    );
});

/**
 * Compact header for room info
 */
const CompactHeader = memo(function CompactHeader({
    room,
    participantCount,
    isOwner,
    connectionState,
    copied,
    onCloseRoom,
    onCopyLink,
}: {
    room: RoomData;
    participantCount: number;
    isOwner: boolean;
    connectionState: string;
    copied: boolean;
    onCloseRoom: () => void;
    onCopyLink: () => void;
}) {
    return (
        <header className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 bg-black/20 backdrop-blur-sm">
            {/* Left: Back button + Room info */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <Link
                    href="/"
                    className="p-2 -ml-1 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                >
                    <ChevronLeft className="h-5 w-5" />
                </Link>

                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="font-semibold text-white text-sm sm:text-base truncate max-w-30 sm:max-w-50">
                            {room.name}
                        </h1>
                        <ConnectionDot state={connectionState} />
                    </div>
                    {room.languages.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                            {room.languages.slice(0, 2).map(lang => (
                                <span
                                    key={lang}
                                    className="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium rounded bg-white/10 text-white/60"
                                >
                                    {lang}
                                </span>
                            ))}
                            {room.languages.length > 2 && (
                                <span className="text-[9px] text-white/40">+{room.languages.length - 2}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Participant count */}
                <div className="flex items-center gap-1 px-2 py-1 bg-white/10 rounded-lg text-xs text-white/70">
                    <Users className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{participantCount}/{room.maxParticipants}</span>
                </div>

                {/* Share button */}
                <button
                    onClick={onCopyLink}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-white/10 hover:bg-white/15 rounded-lg transition-colors"
                >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                    <span>{copied ? 'Copied!' : 'Share'}</span>
                </button>

                {/* Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="p-2 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors">
                            <MoreVertical className="h-5 w-5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-surface-default border-surface-border">
                        <DropdownMenuItem onClick={onCopyLink} className="text-gray-300 hover:text-white sm:hidden">
                            <Share2 className="mr-2 h-4 w-4" />
                            {copied ? 'Copied!' : 'Share Link'}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/" className="flex items-center text-gray-300 hover:text-white">
                                <LogOut className="mr-2 h-4 w-4" />
                                Leave Room
                            </Link>
                        </DropdownMenuItem>

                        {isOwner && (
                            <>
                                <DropdownMenuSeparator className="bg-white/10" />
                                <DropdownMenuItem
                                    onClick={onCloseRoom}
                                    className="text-red-400 hover:text-red-300 focus:text-red-300"
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Close Room
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
});

/**
 * Connection status indicator dot
 */
const ConnectionDot = memo(function ConnectionDot({ state }: { state: string }) {
    const config = {
        connected: { color: 'bg-green-500', pulse: false },
        connecting: { color: 'bg-amber-500', pulse: true },
        reconnecting: { color: 'bg-amber-500', pulse: true },
        disconnected: { color: 'bg-red-500', pulse: false },
        failed: { color: 'bg-red-500', pulse: false },
    }[state] || { color: 'bg-gray-500', pulse: false };

    return (
        <span
            className={cn(
                'w-2 h-2 rounded-full',
                config.color,
                config.pulse && 'animate-pulse'
            )}
            title={state}
        />
    );
});

/**
 * Content placeholder for the main canvas area
 */
const ContentPlaceholder = memo(function ContentPlaceholder({
    participantCount,
    onCopyLink,
}: {
    participantCount: number;
    onCopyLink: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center text-center px-6 max-w-md">
            {participantCount <= 1 ? (
                // Empty state when alone
                <>
                    <div className="w-20 h-20 rounded-2xl bg-primary-500/10 flex items-center justify-center mb-6">
                        <Users className="h-10 w-10 text-primary-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                        Waiting for others
                    </h3>
                    <p className="text-sm text-white/50 mb-6 leading-relaxed">
                        Share the room link to invite people to join the conversation
                    </p>
                    <button
                        onClick={onCopyLink}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-xl transition-colors shadow-lg shadow-primary-600/25"
                    >
                        <Copy className="h-4 w-4" />
                        Copy Invite Link
                    </button>
                </>
            ) : (
                // Content area hint when participants are present
                <>
                    <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                        <Grid3X3 className="h-8 w-8 text-white/20" />
                    </div>
                    <p className="text-sm text-white/30">
                        Content area for future features
                    </p>
                    <p className="text-xs text-white/20 mt-1">
                        Whiteboard, documents, and more coming soon
                    </p>
                </>
            )}
        </div>
    );
});

VoiceRoomLayout.displayName = 'VoiceRoomLayout';
CompactHeader.displayName = 'CompactHeader';
ConnectionDot.displayName = 'ConnectionDot';
ContentPlaceholder.displayName = 'ContentPlaceholder';
