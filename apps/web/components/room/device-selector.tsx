/**
 * Device Selector Modal Component
 * 
 * Allows users to select their audio input device.
 * Shows real-time audio level preview.
 */

'use client';

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/design-system';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
// import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Mic, Check, Loader2 } from '@/components/ui/icons';
import { useAudioDevices } from '@/lib/services/p2p';
import { AudioLevelMonitor } from '@/lib/services/p2p/audio-level-monitor';
import { MediaDevicesManager } from '@/lib/services/p2p/media-devices';

export interface DeviceSelectorProps {
    /** Whether the dialog is open */
    open: boolean;
    /** Callback when dialog should close */
    onClose: () => void;
}

/**
 * Device selector modal
 */
export const DeviceSelector = memo(function DeviceSelector({
    open,
    onClose,
}: DeviceSelectorProps) {
    const { devices, selectedDeviceId, refreshDevices, switchDevice, isLoading } = useAudioDevices();
    const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const monitorRef = useRef<AudioLevelMonitor | null>(null);
    const mediaManagerRef = useRef<MediaDevicesManager | null>(null);

    // Refresh devices when modal opens
    useEffect(() => {
        if (open) {
            refreshDevices();
        }
    }, [open, refreshDevices]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            monitorRef.current?.stop();
            mediaManagerRef.current?.stopCurrentStream();
        };
    }, []);

    // Test a specific device
    const handleTestDevice = useCallback(async (deviceId: string) => {
        // Stop previous test
        monitorRef.current?.stop();
        mediaManagerRef.current?.stopCurrentStream();
        setAudioLevel(0);

        if (testingDeviceId === deviceId) {
            setTestingDeviceId(null);
            return;
        }

        setTestingDeviceId(deviceId);

        try {
            // Create new manager and get stream
            if (!mediaManagerRef.current) {
                mediaManagerRef.current = new MediaDevicesManager();
            }

            const track = await mediaManagerRef.current.getAudioTrack({ deviceId });

            // Create monitor
            monitorRef.current = new AudioLevelMonitor(
                { speakingThreshold: 0.01 },
                { onVolumeChange: setAudioLevel }
            );

            await monitorRef.current.start(track);
        } catch (error) {
            console.error('Failed to test device:', error);
            setTestingDeviceId(null);
        }
    }, [testingDeviceId]);

    // Select a device
    const handleSelectDevice = useCallback(async (deviceId: string) => {
        // Stop any testing
        monitorRef.current?.stop();
        mediaManagerRef.current?.stopCurrentStream();
        setTestingDeviceId(null);
        setAudioLevel(0);

        try {
            await switchDevice(deviceId);
            onClose();
        } catch (error) {
            console.error('Failed to switch device:', error);
        }
    }, [switchDevice, onClose]);

    // Handle dialog close
    const handleClose = useCallback(() => {
        // Stop any testing
        monitorRef.current?.stop();
        mediaManagerRef.current?.stopCurrentStream();
        setTestingDeviceId(null);
        setAudioLevel(0);
        onClose();
    }, [onClose]);

    return (
        <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select Microphone</DialogTitle>
                </DialogHeader>

                <div className="space-y-3 py-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
                        </div>
                    ) : devices.length === 0 ? (
                        <div className="text-center py-8 text-text-secondary">
                            No microphones found. Please connect a microphone and try again.
                        </div>
                    ) : (
                        devices.map((device) => (
                            <DeviceItem
                                key={device.deviceId}
                                device={device}
                                isSelected={device.deviceId === selectedDeviceId}
                                isTesting={device.deviceId === testingDeviceId}
                                audioLevel={device.deviceId === testingDeviceId ? audioLevel : 0}
                                onTest={() => handleTestDevice(device.deviceId)}
                                onSelect={() => handleSelectDevice(device.deviceId)}
                            />
                        ))
                    )}
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={handleClose}>
                        Cancel
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
});

/**
 * Individual device item
 */
const DeviceItem = memo(function DeviceItem({
    device,
    isSelected,
    isTesting,
    audioLevel,
    onTest,
    onSelect,
}: {
    device: { deviceId: string; label: string; isDefault: boolean };
    isSelected: boolean;
    isTesting: boolean;
    audioLevel: number;
    onTest: () => void;
    onSelect: () => void;
}) {
    return (
        <div
            className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-all',
                isSelected
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-border hover:border-surface-borderHover hover:bg-surface-hover'
            )}
        >
            {/* Icon */}
            <div className={cn(
                'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
                isSelected ? 'bg-primary-500/20' : 'bg-surface-default'
            )}>
                <Mic className={cn('h-5 w-5', isSelected ? 'text-primary-500' : 'text-text-secondary')} />
            </div>

            {/* Label */}
            <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary truncate">{device.label}</p>
                {device.isDefault && (
                    <p className="text-xs text-text-secondary">System Default</p>
                )}

                {/* Audio Level Bar */}
                {isTesting && (
                    <div className="mt-2 h-1.5 bg-surface-default rounded-full overflow-hidden">
                        <div
                            className="h-full bg-status-success transition-all duration-75"
                            style={{ width: `${Math.min(audioLevel * 100 * 5, 100)}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                    variant={isTesting ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={onTest}
                >
                    {isTesting ? 'Stop' : 'Test'}
                </Button>

                {isSelected ? (
                    <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center">
                        <Check className="h-4 w-4 text-white" />
                    </div>
                ) : (
                    <Button variant="primary" size="sm" onClick={onSelect}>
                        Use
                    </Button>
                )}
            </div>
        </div>
    );
});

DeviceSelector.displayName = 'DeviceSelector';
DeviceItem.displayName = 'DeviceItem';
