/**
 * P2P Voice Service Module
 *
 * Browser-to-browser WebRTC voice mesh (replaces the old mediasoup client).
 * Same public export names as the old `./voice` module so every existing
 * importer keeps working:
 *
 * ```ts
 * import { getVoiceService, useVoice } from '@/lib/services/p2p';
 * ```
 */

// Main service (P2P mesh)
export { P2PVoiceService, VoiceService, getVoiceService, resetVoiceService, initialVoiceState } from './mesh';

// Supporting classes
export { MediaDevicesManager, getMediaDevicesManager } from './media-devices';
export { AudioLevelMonitor, getAudioLevel } from './audio-level-monitor';
export { EventEmitter } from './event-emitter';

// React hooks and provider
export {
    VoiceProvider,
    useVoice,
    useVoiceConnection,
    useVoiceMute,
    useRemoteParticipants,
    useRemoteParticipant,
    useAudioDevices,
    useVoiceEvent,
    useOnSpeaking,
    useLocalSpeaking,
} from './hooks';
export type { UseVoiceReturn } from './hooks';

// Types
export type {
    VoiceServiceConfig,
    VoiceServiceEvents,
    VoiceState,
    VoiceConnectionState,
    RemoteParticipant,
    SignalOutbound,
    InboundSignal,
    AudioLevelData,
    AudioDeviceOptions,
    JoinRoomOptions,
    TrackMetaPayload,
} from './types';
