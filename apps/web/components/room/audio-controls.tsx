/**
 * Audio Controls Component
 * 
 * Provides mute/unmute, deafen, leave, and settings controls.
 * Optimized with memo to prevent unnecessary re-renders.
 */

'use client';

import { memo, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/design-system';
import { Button } from '@/components/ui';
import {
    Mic,
    MicOff,
    Phone,
    Settings,
    Volume2,
    VolumeX,
    Loader2,
} from '@/components/ui/icons';
import { useVoiceMute, useVoiceConnection } from '@/lib/services/p2p';

export interface AudioControlsProps {
    /** Callback when leave is clicked */
    onLeave?: () => Promise<void>;
    /** Callback when settings is clicked */
    onSettingsClick?: () => void;
    /** Whether controls are disabled */
    disabled?: boolean;
    /** Custom class name */
    className?: string;
}

/**
 * Main audio controls bar
 */
export const AudioControls = memo(function AudioControls({
    onLeave,
    onSettingsClick,
    disabled = false,
    className,
}: AudioControlsProps) {
    const router = useRouter();
    const { isMuted, toggleMute } = useVoiceMute();
    const { connectionState, isConnected } = useVoiceConnection();

    const [isDeafened, setIsDeafened] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);

    // Handle mute toggle with loading state
    const handleMuteToggle = useCallback(async () => {
        if (disabled) return;
        try {
            await toggleMute();
        } catch (error) {
            console.error('Failed to toggle mute:', error);
        }
    }, [toggleMute, disabled]);

    // Handle deafen toggle (local only for now)
    const handleDeafenToggle = useCallback(() => {
        if (disabled) return;
        setIsDeafened((prev) => !prev);
        // TODO: Implement actual deafen by pausing all consumers
    }, [disabled]);

    // Handle leave room
    const handleLeave = useCallback(async () => {
        if (isLeaving) return;

        setIsLeaving(true);
        try {
            await onLeave?.();
            router.push('/');
        } catch (error) {
            console.error('Failed to leave room:', error);
            setIsLeaving(false);
        }
    }, [onLeave, router, isLeaving]);

    // Handle settings click
    const handleSettings = useCallback(() => {
        onSettingsClick?.();
    }, [onSettingsClick]);

    const isDisconnected = connectionState === 'disconnected' || connectionState === 'failed';

    return (
        <div className={cn(
            'border-t border-surface-border bg-background-secondary/80 backdrop-blur-xl',
            className
        )}>
            <div className="flex items-center justify-center gap-3 sm:gap-4 px-4 py-4 safe-area-bottom">
                {/* Mute Button */}
                <MuteButton
                    isMuted={isMuted}
                    onClick={handleMuteToggle}
                    disabled={disabled || isDisconnected}
                />

                {/* Deafen Button */}
                <DeafenButton
                    isDeafened={isDeafened}
                    onClick={handleDeafenToggle}
                    disabled={disabled || isDisconnected}
                />

                {/* Leave Button */}
                <LeaveButton
                    onClick={handleLeave}
                    isLoading={isLeaving}
                    disabled={disabled}
                />

                {/* Settings Button */}
                <SettingsButton
                    onClick={handleSettings}
                    disabled={disabled}
                />
            </div>
        </div>
    );
});

/**
 * Mute button component
 */
const MuteButton = memo(function MuteButton({
    isMuted,
    onClick,
    disabled,
}: {
    isMuted: boolean;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <Button
            variant={isMuted ? 'danger' : 'secondary'}
            size="icon"
            className={cn(
                'h-14 w-14 rounded-full transition-all duration-200',
                isMuted && 'bg-status-error hover:bg-status-error/90'
            )}
            onClick={onClick}
            disabled={disabled}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
            {isMuted ? (
                <MicOff className="h-6 w-6" />
            ) : (
                <Mic className="h-6 w-6" />
            )}
        </Button>
    );
});

/**
 * Deafen button component
 */
const DeafenButton = memo(function DeafenButton({
    isDeafened,
    onClick,
    disabled,
}: {
    isDeafened: boolean;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <Button
            variant={isDeafened ? 'danger' : 'ghost'}
            size="icon"
            className={cn(
                'h-12 w-12 rounded-full transition-all duration-200',
                isDeafened && 'bg-status-error hover:bg-status-error/90'
            )}
            onClick={onClick}
            disabled={disabled}
            aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
        >
            {isDeafened ? (
                <VolumeX className="h-5 w-5" />
            ) : (
                <Volume2 className="h-5 w-5" />
            )}
        </Button>
    );
});

/**
 * Leave button component
 */
const LeaveButton = memo(function LeaveButton({
    onClick,
    isLoading,
    disabled,
}: {
    onClick: () => void;
    isLoading?: boolean;
    disabled?: boolean;
}) {
    return (
        <Button
            variant="danger"
            size="icon"
            className="h-14 w-14 rounded-full bg-status-error hover:bg-status-error/90"
            onClick={onClick}
            disabled={disabled || isLoading}
            aria-label="Leave room"
        >
            {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
                <Phone className="h-6 w-6 rotate-135" />
            )}
        </Button>
    );
});

/**
 * Settings button component
 */
const SettingsButton = memo(function SettingsButton({
    onClick,
    disabled,
}: {
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={onClick}
            disabled={disabled}
            aria-label="Audio settings"
        >
            <Settings className="h-5 w-5" />
        </Button>
    );
});

AudioControls.displayName = 'AudioControls';
MuteButton.displayName = 'MuteButton';
DeafenButton.displayName = 'DeafenButton';
LeaveButton.displayName = 'LeaveButton';
SettingsButton.displayName = 'SettingsButton';
