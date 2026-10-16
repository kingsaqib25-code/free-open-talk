/**
 * Audio Level Monitor
 * 
 * Uses Web Audio API to detect speaking activity from a MediaStreamTrack.
 * Provides real-time volume levels and speaking detection with configurable thresholds.
 */

export interface AudioLevelMonitorConfig {
    /** Volume threshold (0-1) above which user is considered speaking */
    speakingThreshold?: number;
    /** How often to check audio levels (ms) */
    updateInterval?: number;
    /** Smoothing factor for volume (0-1, higher = smoother) */
    smoothingFactor?: number;
    /** Min time speaking before triggering (ms) */
    minSpeakingDuration?: number;
    /** Min time silent before stopping speaking (ms) */
    minSilenceDuration?: number;
}

export interface AudioLevelCallbacks {
    onVolumeChange?: (volume: number) => void;
    onSpeakingChange?: (isSpeaking: boolean) => void;
}

const DEFAULT_CONFIG: Required<AudioLevelMonitorConfig> = {
    // Industry standard: Threshold should be above typical background noise (~0.05-0.10)
    // Setting to 0.10 ensures only intentional speech triggers speaking state
    speakingThreshold: 0.10,
    updateInterval: 50,
    smoothingFactor: 0.8,
    minSpeakingDuration: 100,
    minSilenceDuration: 300,
};

export class AudioLevelMonitor {
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private dataArray: Uint8Array<ArrayBuffer> | null = null;
    private animationFrameId: number | null = null;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private config: Required<AudioLevelMonitorConfig>;
    private callbacks: AudioLevelCallbacks;

    private currentVolume = 0;
    private smoothedVolume = 0;
    private isSpeaking = false;
    private speakingStartTime: number | null = null;
    private silenceStartTime: number | null = null;
    private isRunning = false;

    constructor(config?: AudioLevelMonitorConfig, callbacks?: AudioLevelCallbacks) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.callbacks = callbacks || {};
    }

    /**
     * Start monitoring an audio track
     */
    async start(track: MediaStreamTrack): Promise<void> {
        if (this.isRunning) {
            this.stop();
        }

        try {
            // Create audio context
            this.audioContext = new AudioContext();

            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = this.config.smoothingFactor;

            // Connect track to analyser
            const stream = new MediaStream([track]);
            this.source = this.audioContext.createMediaStreamSource(stream);
            this.source.connect(this.analyser);

            // Initialize data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.isRunning = true;

            // Start monitoring loop
            this.startMonitoringLoop();
        } catch (error) {
            console.error('Failed to start audio level monitor:', error);
            this.stop();
            throw error;
        }
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        this.isRunning = false;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
        }

        this.analyser = null;
        this.dataArray = null;
        this.currentVolume = 0;
        this.smoothedVolume = 0;

        // Reset speaking state
        if (this.isSpeaking) {
            this.isSpeaking = false;
            this.callbacks.onSpeakingChange?.(false);
        }
    }

    /**
     * Update callbacks
     */
    setCallbacks(callbacks: AudioLevelCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Get current volume level (0-1)
     */
    getVolume(): number {
        return this.smoothedVolume;
    }

    /**
     * Check if currently speaking
     */
    getIsSpeaking(): boolean {
        return this.isSpeaking;
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<AudioLevelMonitorConfig>): void {
        this.config = { ...this.config, ...config };
    }

    private startMonitoringLoop(): void {
        // Use interval for consistent updates
        this.intervalId = setInterval(() => {
            if (!this.isRunning || !this.analyser || !this.dataArray) {
                return;
            }

            // Get frequency data
            this.analyser.getByteFrequencyData(this.dataArray);

            // Calculate average volume (RMS-like)
            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) {
                sum += this.dataArray[i] * this.dataArray[i];
            }
            const rms = Math.sqrt(sum / this.dataArray.length);

            // Normalize to 0-1 range
            this.currentVolume = rms / 255;

            // Apply exponential smoothing
            this.smoothedVolume =
                this.config.smoothingFactor * this.smoothedVolume +
                (1 - this.config.smoothingFactor) * this.currentVolume;

            // Notify volume change
            this.callbacks.onVolumeChange?.(this.smoothedVolume);

            // Update speaking state with hysteresis
            this.updateSpeakingState();
        }, this.config.updateInterval);
    }

    private updateSpeakingState(): void {
        const now = Date.now();
        const isAboveThreshold = this.smoothedVolume > this.config.speakingThreshold;

        if (isAboveThreshold) {
            this.silenceStartTime = null;

            if (!this.isSpeaking) {
                if (this.speakingStartTime === null) {
                    this.speakingStartTime = now;
                } else if (now - this.speakingStartTime >= this.config.minSpeakingDuration) {
                    this.isSpeaking = true;
                    this.callbacks.onSpeakingChange?.(true);
                }
            }
        } else {
            this.speakingStartTime = null;

            if (this.isSpeaking) {
                if (this.silenceStartTime === null) {
                    this.silenceStartTime = now;
                } else if (now - this.silenceStartTime >= this.config.minSilenceDuration) {
                    this.isSpeaking = false;
                    this.callbacks.onSpeakingChange?.(false);
                }
            }
        }
    }
}

/**
 * Create a simple one-off volume check for a track
 */
export async function getAudioLevel(track: MediaStreamTrack): Promise<number> {
    return new Promise((resolve, reject) => {
        try {
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;

            const stream = new MediaStream([track]);
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            // Wait a bit for audio to stabilize
            setTimeout(() => {
                analyser.getByteFrequencyData(dataArray);

                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / dataArray.length);
                const volume = rms / 255;

                source.disconnect();
                audioContext.close().catch(() => { });

                resolve(volume);
            }, 100);
        } catch (error) {
            reject(error);
        }
    });
}
