/**
 * Media Devices Manager
 * 
 * Handles audio device enumeration, selection, and permission management.
 * Provides a clean interface for microphone access and device switching.
 */

import type { AudioDeviceOptions } from './types';

export interface MediaDevicesManagerConfig {
    /** Default audio constraints */
    defaultConstraints?: MediaTrackConstraints;
}

export interface GetMediaStreamOptions {
    /** Specific device ID to use */
    deviceId?: string;
    /** Additional constraints */
    constraints?: MediaTrackConstraints;
}

const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
};

export class MediaDevicesManager {
    private config: MediaDevicesManagerConfig;
    private cachedDevices: MediaDeviceInfo[] = [];
    private currentStream: MediaStream | null = null;
    private deviceChangeListeners = new Set<(devices: AudioDeviceOptions[]) => void>();

    constructor(config?: MediaDevicesManagerConfig) {
        this.config = config || {};

        // Listen for device changes
        if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
            navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
        }
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
            navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange);
        }
        this.stopCurrentStream();
        this.deviceChangeListeners.clear();
    }

    /**
     * Check if we have microphone permission
     */
    async checkMicrophonePermission(): Promise<PermissionState> {
        try {
            // First try the Permissions API
            if (navigator.permissions) {
                const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                return result.state;
            }
        } catch {
            // Permissions API not supported or 'microphone' not recognized
        }

        // Fallback: try to enumerate devices
        // If we get device labels, we likely have permission
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter((d) => d.kind === 'audioinput');
            if (audioInputs.length > 0 && audioInputs[0].label) {
                return 'granted';
            }
            return 'prompt';
        } catch {
            return 'denied';
        }
    }

    /**
     * Request microphone permission by getting a stream
     */
    async requestMicrophonePermission(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Immediately stop the stream - we just wanted permission
            stream.getTracks().forEach((track) => track.stop());
            return true;
        } catch (error) {
            console.error('Microphone permission denied:', error);
            return false;
        }
    }

    /**
     * Get available audio input devices
     */
    async getAudioInputDevices(): Promise<AudioDeviceOptions[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cachedDevices = devices;

            const audioInputs = devices
                .filter((device) => device.kind === 'audioinput')
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || `Microphone ${index + 1}`,
                    isDefault: device.deviceId === 'default' || index === 0,
                }));

            return audioInputs;
        } catch (error) {
            console.error('Failed to enumerate devices:', error);
            return [];
        }
    }

    /**
     * Get a media stream from the microphone
     */
    async getAudioStream(options?: GetMediaStreamOptions): Promise<MediaStream> {
        // Stop any existing stream
        this.stopCurrentStream();

        const constraints: MediaTrackConstraints = {
            ...DEFAULT_AUDIO_CONSTRAINTS,
            ...this.config.defaultConstraints,
            ...options?.constraints,
        };

        // Add device ID if specified
        if (options?.deviceId) {
            constraints.deviceId = { exact: options.deviceId };
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: constraints,
                video: false,
            });

            this.currentStream = stream;
            return stream;
        } catch (error) {
            if (error instanceof DOMException) {
                if (error.name === 'NotAllowedError') {
                    throw new Error('Microphone permission denied. Please allow microphone access.');
                }
                if (error.name === 'NotFoundError') {
                    throw new Error('No microphone found. Please connect a microphone.');
                }
                if (error.name === 'NotReadableError') {
                    throw new Error('Microphone is in use by another application.');
                }
            }
            throw error;
        }
    }

    /**
     * Get audio track from stream (convenience method)
     */
    async getAudioTrack(options?: GetMediaStreamOptions): Promise<MediaStreamTrack> {
        const stream = await this.getAudioStream(options);
        const track = stream.getAudioTracks()[0];
        if (!track) {
            throw new Error('No audio track available');
        }
        return track;
    }

    /**
     * Switch to a different audio input device
     */
    async switchAudioDevice(deviceId: string): Promise<MediaStreamTrack> {
        return this.getAudioTrack({ deviceId });
    }

    /**
     * Stop the current media stream
     */
    stopCurrentStream(): void {
        if (this.currentStream) {
            this.currentStream.getTracks().forEach((track) => {
                track.stop();
            });
            this.currentStream = null;
        }
    }

    /**
     * Get the current stream
     */
    getCurrentStream(): MediaStream | null {
        return this.currentStream;
    }

    /**
     * Listen for device changes
     */
    onDeviceChange(listener: (devices: AudioDeviceOptions[]) => void): () => void {
        this.deviceChangeListeners.add(listener);
        return () => this.deviceChangeListeners.delete(listener);
    }

    /**
     * Handle device change events
     */
    private handleDeviceChange = async (): Promise<void> => {
        const devices = await this.getAudioInputDevices();
        this.deviceChangeListeners.forEach((listener) => {
            try {
                listener(devices);
            } catch (error) {
                console.error('Error in device change listener:', error);
            }
        });
    };
}

// Singleton instance for convenience
let defaultManager: MediaDevicesManager | null = null;

export function getMediaDevicesManager(): MediaDevicesManager {
    if (!defaultManager) {
        defaultManager = new MediaDevicesManager();
    }
    return defaultManager;
}
