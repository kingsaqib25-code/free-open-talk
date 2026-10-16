/**
 * Room Control Bar Component
 * 
 * Top-centered control bar for voice rooms.
 */

'use client';

import { memo, useCallback, useState, useEffect } from 'react';
import { cn } from '@/lib/design-system';
import {
    Mic,
    MicOff,
    MonitorOff,
    Monitor,
    Phone,
    Settings,
    Volume2,
    VolumeX,
    Loader2,
    Signal,
    SignalHigh,
    SignalMedium,
    SignalLow,
    SignalZero,
    Wifi,
    WifiOff,
} from '@/components/ui/icons';

export interface RoomControlBarProps {
    isMuted: boolean;
    isDeafened: boolean;
    isScreenSharing?: boolean;
    isLeaving: boolean;
    isDisconnected: boolean;
    connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
    onMuteToggle: () => void;
    onDeafenToggle: () => void;
    onScreenShareToggle?: () => void;
    onLeave: () => void;
    onSettings?: () => void;
}

/**
 * Get signal strength icon and color based on connection quality
 */
function getSignalConfig(quality: string) {
    switch (quality) {
        case 'excellent':
            return { bars: 4, color: 'text-green-500', label: 'Excellent' };
        case 'good':
            return { bars: 3, color: 'text-green-500', label: 'Good' };
        case 'fair':
            return { bars: 2, color: 'text-yellow-500', label: 'Fair' };
        case 'poor':
            return { bars: 1, color: 'text-red-500', label: 'Poor' };
        default:
            return { bars: 0, color: 'text-gray-500', label: 'Disconnected' };
    }
}

/**
 * Custom Signal Bars Component
 */
const SignalBars = memo(function SignalBars({
    quality
}: {
    quality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected'
}) {
    const config = getSignalConfig(quality);

    return (
        <div className="flex items-end gap-[2px] h-4" title={config.label}>
            {[1, 2, 3, 4].map((bar) => (
                <div
                    key={bar}
                    className={cn(
                        'w-[3px] rounded-sm transition-colors',
                        bar <= config.bars ? config.color.replace('text-', 'bg-') : 'bg-gray-600'
                    )}
                    style={{ height: `${bar * 25}%` }}
                />
            ))}
        </div>
    );
});

/**
 * Main control bar component
 */
export const RoomControlBar = memo(function RoomControlBar({
    isMuted,
    isDeafened,
    isScreenSharing = false,
    isLeaving,
    isDisconnected,
    connectionQuality = 'good',
    onMuteToggle,
    onDeafenToggle,
    onScreenShareToggle,
    onLeave,
    onSettings,
}: RoomControlBarProps) {
    return (
        <div className="flex items-center justify-center">
            <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-3xl bg-gradient-to-r from-black/50 to-black/30 backdrop-blur-xl border border-white/10 shadow-2xl hover:shadow-3xl transition-shadow">
                {/* Microphone Toggle */}
                <ControlButton
                    onClick={onMuteToggle}
                    disabled={isDisconnected}
                    active={isMuted}
                    activeColor="bg-red-600/20 ring-1 ring-red-500"
                    tooltip={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                    {isMuted ? (
                        <MicOff className="h-4 w-4 text-red-500" />
                    ) : (
                        <Mic className="h-4 w-4 text-green-500" />
                    )}
                </ControlButton>

                {/* Divider */}
                <div className="w-px h-5 bg-white/10" />

                {/* Connection Quality Indicator - with label */}
                <div className="flex items-center gap-1.5 px-1.5 hidden sm:flex">
                    <SignalBars quality={isDisconnected ? 'disconnected' : connectionQuality} />
                    <span className="text-xs text-white/70 whitespace-nowrap">
                        {isDisconnected ? 'Offline' : connectionQuality}
                    </span>
                </div>

                {/* Divider */}
                <div className="w-px h-5 bg-white/10 hidden sm:block" />

                {/* Leave Call Button - Prominent */}
                <ControlButton
                    onClick={onLeave}
                    disabled={isLeaving}
                    variant="danger"
                    tooltip="Leave room"
                >
                    {isLeaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Phone className="h-4 w-4 rotate-[135deg]" />
                    )}
                </ControlButton>
            </div>
        </div>
    );
});

interface ControlButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    activeColor?: string;
    variant?: 'default' | 'danger';
    tooltip?: string;
}

/**
 * Individual control button with enhanced styling
 */
const ControlButton = memo(function ControlButton({
    children,
    onClick,
    disabled = false,
    active = false,
    activeColor = 'bg-primary-600/20 ring-1 ring-primary-500',
    variant = 'default',
    tooltip,
}: ControlButtonProps) {
    const baseClasses = 'relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';

    const variantClasses = {
        default: active
            ? `${activeColor} text-white`
            : 'bg-white/5 hover:bg-white/10 text-white/80 hover:text-white',
        danger: 'bg-red-600/80 hover:bg-red-600 text-white ring-1 ring-red-400/50 hover:ring-red-400',
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(baseClasses, variantClasses[variant])}
            title={tooltip}
            aria-label={tooltip}
        >
            {children}
        </button>
    );
});

/**
 * Alternative floating control bar for bottom placement
 * Keeping the existing control functionality but with updated styling
 */
export const BottomControlBar = memo(function BottomControlBar({
    isMuted,
    isDeafened,
    isLeaving,
    isDisconnected,
    connectionQuality = 'good',
    onMuteToggle,
    onDeafenToggle,
    onLeave,
    onSettings,
}: Omit<RoomControlBarProps, 'isScreenSharing' | 'onScreenShareToggle'>) {
    return (
        <div className="shrink-0 safe-area-bottom">
            <div className="flex items-center justify-center gap-4 px-4 py-4">
                {/* Mute button */}
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

                {/* Deafen button */}
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

                {/* Leave button */}
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

                {/* Settings button */}
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

RoomControlBar.displayName = 'RoomControlBar';
BottomControlBar.displayName = 'BottomControlBar';
ControlButton.displayName = 'ControlButton';
SignalBars.displayName = 'SignalBars';
