/**
 * P2P Voice Service Types
 *
 * Type definitions for the P2P WebRTC mesh voice layer.
 * Browser-to-browser RTCPeerConnection mesh, signaling over Convex,
 * STUN-only (no TURN, no media server) — this is what keeps hosting at $0.
 *
 * Public interface mirrors the old mediasoup-era voice service so existing
 * UI components (useVoice, VoiceProvider, …) keep working untouched.
 */

/**
 * Remote participant in the P2P mesh.
 * One RTCPeerConnection per peer; audio arrives as a remote MediaStreamTrack.
 */
export interface RemoteParticipant {
    /** Peer's deviceId (guest identity) */
    id: string;
    /** The peer connection carrying this participant's audio */
    peerConnection: RTCPeerConnection;
    /** Remote audio track (null until ontrack fires) */
    audioTrack: MediaStreamTrack | null;
    /** Smoothed volume 0-1 (from AudioLevelMonitor) */
    volume: number;
    /** Speaking detection flag */
    isSpeaking: boolean;
}

/**
 * Mesh connection state (aggregate over all peer connections)
 */
export type VoiceConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'failed';

/**
 * P2P voice service configuration
 */
export interface VoiceServiceConfig {
    /** This client's guest deviceId (signaling identity) */
    deviceId: string;
    /** Enable debug logging */
    debug?: boolean;
    /** Audio constraints for getUserMedia */
    audioConstraints?: MediaTrackConstraints;
    /** Auto-gain control */
    autoGainControl?: boolean;
    /** Echo cancellation */
    echoCancellation?: boolean;
    /** Noise suppression */
    noiseSuppression?: boolean;
    /** Signal poll interval in ms (default 1500) */
    signalPollIntervalMs?: number;
}

/**
 * Voice service state — same shape as the old service so hooks keep working.
 */
export interface VoiceState {
    connectionState: VoiceConnectionState;
    isConnecting: boolean;
    isConnected: boolean;
    isMuted: boolean;
    isSpeaking: boolean;
    localAudioLevel: number; // Audio level for local user (0-1)
    currentRoomId: string | null;
    localAudioTrack: MediaStreamTrack | null;
    remoteParticipants: Map<string, RemoteParticipant>;
    audioInputDevices: MediaDeviceInfo[];
    selectedAudioInputId: string | null;
    error: Error | null;
}

/**
 * Outbound signaling callback — wired by the React layer to Convex
 * api.signals.push. The mesh itself stays framework-agnostic.
 */
export type SignalOutbound = (
    toDeviceId: string,
    type: 'offer' | 'answer' | 'ice',
    payload: unknown
) => void;

/**
 * Inbound signal, as delivered by the Convex signals poll.
 */
export interface InboundSignal {
    fromDeviceId: string;
    type: 'offer' | 'answer' | 'ice';
    payload: unknown;
}

/**
 * Voice service event types (unchanged from the old interface)
 */
export interface VoiceServiceEvents {
    [key: string]: (...args: any[]) => void;
    'state-changed': (state: VoiceState) => void;
    'connection-state-changed': (state: VoiceConnectionState) => void;
    'participant-joined': (participant: RemoteParticipant) => void;
    'participant-left': (deviceId: string) => void;
    'participant-speaking': (deviceId: string, isSpeaking: boolean) => void;
    'local-speaking': (isSpeaking: boolean) => void;
    'mute-changed': (isMuted: boolean) => void;
    'error': (error: Error) => void;
    'reconnecting': () => void;
    'reconnected': () => void;
}

/**
 * Event emitter interface for voice service
 */
export interface VoiceServiceEventEmitter {
    on<K extends keyof VoiceServiceEvents>(event: K, listener: VoiceServiceEvents[K]): void;
    off<K extends keyof VoiceServiceEvents>(event: K, listener: VoiceServiceEvents[K]): void;
    emit<K extends keyof VoiceServiceEvents>(event: K, ...args: Parameters<VoiceServiceEvents[K]>): void;
}

/**
 * Audio level data for speaking detection
 */
export interface AudioLevelData {
    userId: string;
    level: number;
    isSpeaking: boolean;
}

/**
 * Device selection options
 */
export interface AudioDeviceOptions {
    deviceId: string;
    label: string;
    isDefault: boolean;
}
