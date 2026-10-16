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
    /** Remote camera video track (null until ontrack fires) */
    videoTrack: MediaStreamTrack | null;
    /** Remote screen-share video track (announced via track-meta signal) */
    screenTrack: MediaStreamTrack | null;
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
    /** Video constraints for getUserMedia (camera) */
    videoConstraints?: MediaTrackConstraints;
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
 * Options for joinRoom. Listeners (stage audience) join with
 * publish:false — no mic/camera captured, receive-only peer connections.
 */
export interface JoinRoomOptions {
    /** Capture mic and publish audio (default true) */
    publish?: boolean;
    /** Capture camera and publish video alongside audio (default false) */
    video?: boolean;
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
    /** Local camera track (null when camera off) */
    localVideoTrack: MediaStreamTrack | null;
    /** Local screen-share track (null when not sharing) */
    localScreenTrack: MediaStreamTrack | null;
    /** Camera currently published */
    isVideoOn: boolean;
    /** Screen currently shared */
    isSharingScreen: boolean;
    /** Screen-share includes system/tab audio (false when the OS gave video only) */
    isSharingScreenAudio: boolean;
    /** Mic/camera published to the mesh (false = stage audience listener) */
    isPublishing: boolean;
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
    type: 'offer' | 'answer' | 'ice' | 'track-meta',
    payload: unknown
) => void;

/**
 * Inbound signal, as delivered by the Convex signals poll.
 */
export interface InboundSignal {
    fromDeviceId: string;
    type: 'offer' | 'answer' | 'ice' | 'track-meta';
    payload: unknown;
}

/**
 * Track metadata payload — announces a screen-share stream so receivers
 * can tell it apart from the camera track. Sent right after addTrack,
 * and again on stop.
 */
export interface TrackMetaPayload {
    action: 'add' | 'remove';
    kind: 'screen';
    streamId: string;
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
    'video-changed': (isVideoOn: boolean) => void;
    'screen-share-changed': (isSharing: boolean) => void;
    'publishing-changed': (isPublishing: boolean) => void;
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
