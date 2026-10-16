/**
 * P2P Voice Mesh Service
 *
 * Browser-to-browser WebRTC audio mesh. One RTCPeerConnection per peer,
 * signaling (offer/answer/ICE) travels over Convex (api.signals), media
 * travels directly between browsers. STUN-only — no TURN, no media server.
 *
 * Public API mirrors the old mediasoup-era VoiceService so the UI layer
 * (useVoice, VoiceProvider, …) works without changes.
 *
 * Join protocol (glare-safe):
 *  - Each client watches the Convex presence list and calls syncPeers().
 *  - For every new peer a PC is created and an offer is sent (small jitter
 *    avoids most simultaneous offers).
 *  - Simultaneous-offer collisions are resolved with the standard
 *    polite-peer pattern: the lexicographically smaller deviceId rolls back
 *    and accepts; the other side's offer is ignored.
 */

import { EventEmitter } from './event-emitter';
import { MediaDevicesManager } from './media-devices';
import { AudioLevelMonitor } from './audio-level-monitor';
import type {
    VoiceServiceConfig,
    VoiceServiceEvents,
    VoiceState,
    VoiceConnectionState,
    RemoteParticipant,
    SignalOutbound,
    InboundSignal,
    AudioDeviceOptions,
} from './types';

const STUN_SERVERS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** How long the answerer waits for an offer before offering itself (ms). */
const OFFER_FALLBACK_TIMEOUT_MS = 4000;

interface PeerSlot {
    pc: RTCPeerConnection;
    /** True while our offer is in flight (glare detection). */
    makingOffer: boolean;
    /** I roll back on collision (deterministic: smaller deviceId is polite). */
    polite: boolean;
    /** Fallback timer for the answerer side. */
    offerFallbackTimer: ReturnType<typeof setTimeout> | null;
    audioEl: HTMLAudioElement | null;
    monitor: AudioLevelMonitor | null;
    remoteStream: MediaStream | null;
    /** User-gesture resume queued? */
    resumeQueued: boolean;
}

const initialState = (): VoiceState => ({    connectionState: 'disconnected',
    isConnecting: false,
    isConnected: false,
    isMuted: false,
    isSpeaking: false,
    localAudioLevel: 0,
    currentRoomId: null,
    localAudioTrack: null,
    remoteParticipants: new Map<string, RemoteParticipant>(),
    audioInputDevices: [],
    selectedAudioInputId: null,
    error: null,
});

/** Fresh default state — used by the React layer before the service exists (SSR). */
export function initialVoiceState(): VoiceState {
    return initialState();
}

export class P2PVoiceService extends EventEmitter<VoiceServiceEvents> {
    private config: Required<Omit<VoiceServiceConfig, 'deviceId' | 'audioConstraints'>> &
        Pick<VoiceServiceConfig, 'deviceId' | 'audioConstraints'>;
    private state: VoiceState = initialState();
    private peers = new Map<string, PeerSlot>();
    private localStream: MediaStream | null = null;
    private localMonitor: AudioLevelMonitor | null = null;
    private mediaDevices: MediaDevicesManager;
    private signalOut: SignalOutbound | null = null;
    private disposed = false;

    constructor(config: VoiceServiceConfig) {
        super();
        this.config = {
            deviceId: config.deviceId,
            debug: config.debug ?? false,
            autoGainControl: config.autoGainControl ?? true,
            echoCancellation: config.echoCancellation ?? true,
            noiseSuppression: config.noiseSuppression ?? true,
            signalPollIntervalMs: config.signalPollIntervalMs ?? 1500,
            audioConstraints: config.audioConstraints,
        };
        this.mediaDevices = new MediaDevicesManager({
            defaultConstraints: this.buildAudioConstraints(),
        });
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    private log(...args: unknown[]) {
        if (this.config.debug) console.log('[P2PMesh]', ...args);
    }

    private buildAudioConstraints(): MediaTrackConstraints {
        return {
            echoCancellation: this.config.echoCancellation,
            noiseSuppression: this.config.noiseSuppression,
            autoGainControl: this.config.autoGainControl,
            ...(this.config.audioConstraints ?? {}),
        };
    }

    /** Verify the browser can do WebRTC at all. */
    async initialize(): Promise<void> {
        if (typeof RTCPeerConnection === 'undefined') {
            const err = new Error('WebRTC is not supported in this browser.');
            this.updateState({ error: err, connectionState: 'failed' });
            throw err;
        }
        this.log('initialized for device', this.config.deviceId);
    }

    /** Wire the outbound signaling path (Convex api.signals.push). */
    setSignalOut(cb: SignalOutbound): void {
        this.signalOut = cb;
    }

    private sendSignal(toDeviceId: string, type: InboundSignal['type'], payload: unknown) {
        if (!this.signalOut) {
            this.log('no signalOut wired; dropping', type, '→', toDeviceId);
            return;
        }
        try {
            this.signalOut(toDeviceId, type, payload);
        } catch (err) {
            this.log('signalOut threw', err);
        }
    }

    // ------------------------------------------------------------------
    // Room lifecycle
    // ------------------------------------------------------------------

    async joinRoom(roomId: string): Promise<{ participants?: string[] }> {
        if (this.state.isConnecting || this.state.currentRoomId === roomId) {
            return { participants: [...this.peers.keys()] };
        }
        this.updateState({
            connectionState: 'connecting',
            isConnecting: true,
            error: null,
            currentRoomId: roomId,
        });

        try {
            const stream = await this.mediaDevices.getAudioStream();
            if (this.disposed) {
                stream.getTracks().forEach((t) => t.stop());
                return {};
            }
            const track = stream.getAudioTracks()[0] ?? null;
            this.localStream = stream;

            this.startLocalMonitor(track);

            this.updateState({
                connectionState: 'connected',
                isConnecting: false,
                isConnected: true,
                isMuted: track ? !track.enabled : false,
                localAudioTrack: track,
                selectedAudioInputId: track?.getSettings().deviceId ?? null,
            });
            this.emit('connection-state-changed', 'connected');
            this.log('joined room', roomId);
            return { participants: [...this.peers.keys()] };
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.updateState({
                connectionState: 'failed',
                isConnecting: false,
                isConnected: false,
                error,
            });
            this.emit('error', error);
            throw error;
        }
    }

    async leaveRoom(): Promise<void> {
        for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
        this.stopLocalMonitor();
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }
        const fresh = initialState();
        this.state = { ...fresh, audioInputDevices: this.state.audioInputDevices };
        this.emitState();
        this.emit('connection-state-changed', 'disconnected');
        this.log('left room');
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.leaveRoom();
    }

    // ------------------------------------------------------------------
    // Peer management (driven by the Convex presence list)
    // ------------------------------------------------------------------

    /**
     * Reconcile peer connections with the current presence list.
     * Called by the React layer whenever the participant list changes.
     */
    syncPeers(peerDeviceIds: string[]): void {
        if (!this.state.isConnected) return;
        const wanted = new Set(peerDeviceIds.filter((id) => id !== this.config.deviceId));
        for (const id of wanted) {
            if (!this.peers.has(id)) this.ensurePeer(id);
        }
        for (const id of [...this.peers.keys()]) {
            if (!wanted.has(id)) this.removePeer(id);
        }
    }

    private ensurePeer(peerId: string): void {
        if (peerId === this.config.deviceId || this.peers.has(peerId) || this.disposed) return;
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        const slot: PeerSlot = {
            pc,
            makingOffer: false,
            polite: this.config.deviceId < peerId,
            offerFallbackTimer: null,
            audioEl: null,
            monitor: null,
            remoteStream: null,
            resumeQueued: false,
        };
        this.peers.set(peerId, slot);
        this.log(`PC created for ${peerId} (polite=${slot.polite})`);

        // Attach our mic track (if we have one yet).
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) {
                pc.addTrack(track, this.localStream);
            }
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.sendSignal(peerId, 'ice', e.candidate.toJSON());
            }
        };

        pc.ontrack = (e) => this.handleRemoteTrack(peerId, e);

        pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            this.log(`PC ${peerId} connectionState=${s}`);
            if (s === 'failed') {
                // Cheap recovery: ICE restart before giving up.
                try {
                    pc.restartIce();
                } catch { /* ignore */ }
            }
        };

        pc.onnegotiationneeded = async () => {
            // Defensive: normally we drive negotiation explicitly.
            if (pc.signalingState !== 'stable') return;
            await this.createAndSendOffer(peerId);
        };

        // Publish our presence in the mesh: create the offer with a small
        // jitter so two simultaneous joiners rarely collide (polite-peer
        // pattern resolves any remaining glare).
        const jitter = 100 + Math.random() * 400;
        slot.offerFallbackTimer = setTimeout(() => {
            slot.offerFallbackTimer = null;
            if (this.peers.has(peerId) && pc.signalingState === 'stable') {
                void this.createAndSendOffer(peerId);
            }
        }, jitter);

        this.upsertParticipant(peerId, pc);
        this.emit('participant-joined', this.state.remoteParticipants.get(peerId)!);
    }

    private removePeer(peerId: string): void {
        const slot = this.peers.get(peerId);
        if (!slot) return;
        if (slot.offerFallbackTimer) clearTimeout(slot.offerFallbackTimer);
        slot.monitor?.stop();
        if (slot.audioEl) {
            slot.audioEl.pause();
            slot.audioEl.srcObject = null;
        }
        try {
            slot.pc.close();
        } catch { /* ignore */ }
        this.peers.delete(peerId);

        const next = new Map(this.state.remoteParticipants);
        next.delete(peerId);
        this.updateState({ remoteParticipants: next });
        this.emit('participant-left', peerId);
        this.log(`PC closed for ${peerId}`);
    }

    private upsertParticipant(peerId: string, pc: RTCPeerConnection): void {
        const next = new Map(this.state.remoteParticipants);
        const existing = next.get(peerId);
        next.set(peerId, {
            id: peerId,
            peerConnection: pc,
            audioTrack: existing?.audioTrack ?? null,
            volume: existing?.volume ?? 0,
            isSpeaking: existing?.isSpeaking ?? false,
        });
        this.updateState({ remoteParticipants: next });
    }

    private patchParticipant(peerId: string, patch: Partial<RemoteParticipant>): void {
        const existing = this.state.remoteParticipants.get(peerId);
        if (!existing) return;
        const next = new Map(this.state.remoteParticipants);
        next.set(peerId, { ...existing, ...patch });
        // Avoid re-render storms: only emit when something visible changed.
        const changed =
            (patch.volume !== undefined && Math.abs((existing.volume ?? 0) - patch.volume) > 0.02) ||
            (patch.isSpeaking !== undefined && existing.isSpeaking !== patch.isSpeaking) ||
            patch.audioTrack !== undefined ||
            patch.peerConnection !== undefined;
        this.state.remoteParticipants = next;
        if (changed) this.emitState();
    }

    // ------------------------------------------------------------------
    // Signaling (inbound, from Convex poll)
    // ------------------------------------------------------------------

    async handleSignal(fromDeviceId: string, type: InboundSignal['type'], payload: unknown): Promise<void> {
        if (fromDeviceId === this.config.deviceId || this.disposed) return;
        let slot = this.peers.get(fromDeviceId);
        if (!slot) {
            // Signal from an unknown peer — create the PC so we can answer.
            this.ensurePeer(fromDeviceId);
            slot = this.peers.get(fromDeviceId);
            if (!slot) return;
        }
        // Cancel our pending offer: the other side got there first.
        if (slot.offerFallbackTimer) {
            clearTimeout(slot.offerFallbackTimer);
            slot.offerFallbackTimer = null;
        }
        const pc = slot.pc;

        try {
            if (type === 'offer') {
                const offer = payload as RTCSessionDescriptionInit;
                const collision = slot.makingOffer || pc.signalingState !== 'stable';
                if (collision && !slot.polite) {
                    this.log(`glare with ${fromDeviceId}: impolite, ignoring offer`);
                    return;
                }
                if (collision && slot.polite) {
                    this.log(`glare with ${fromDeviceId}: polite, rolling back`);
                    await pc.setLocalDescription({ type: 'rollback' });
                    slot.makingOffer = false;
                }
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal(fromDeviceId, 'answer', answer);
            } else if (type === 'answer') {
                const answer = payload as RTCSessionDescriptionInit;
                if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(answer));
                } else {
                    this.log(`stray answer from ${fromDeviceId} in state ${pc.signalingState}`);
                }
            } else {
                const candidate = payload as RTCIceCandidateInit;
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    this.log(`ICE add failed for ${fromDeviceId}`, err);
                }
            }
        } catch (err) {
            this.log(`signal handling failed (${type} from ${fromDeviceId})`, err);
        }
    }

    private async createAndSendOffer(peerId: string): Promise<void> {
        const slot = this.peers.get(peerId);
        if (!slot || this.disposed) return;
        const pc = slot.pc;
        if (pc.signalingState !== 'stable') return;
        try {
            slot.makingOffer = true;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(peerId, 'offer', offer);
        } catch (err) {
            this.log(`offer failed for ${peerId}`, err);
        } finally {
            slot.makingOffer = false;
        }
    }

    // ------------------------------------------------------------------
    // Remote audio
    // ------------------------------------------------------------------

    private handleRemoteTrack(peerId: string, e: RTCTrackEvent): void {
        const slot = this.peers.get(peerId);
        if (!slot) return;
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        slot.remoteStream = stream;
        const audioTrack = stream.getAudioTracks()[0] ?? e.track;
        this.patchParticipant(peerId, { audioTrack });

        if (!slot.audioEl) {
            const el = new Audio();
            el.autoplay = true;
            (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
            slot.audioEl = el;
        }
        slot.audioEl.srcObject = stream;
        this.playRemoteAudio(peerId);

        // Speaking detection on the remote track.
        slot.monitor?.stop();
        const monitor = new AudioLevelMonitor(
            { updateInterval: 150, speakingThreshold: 0.08 },
            {
                onVolumeChange: (volume) => this.patchParticipant(peerId, { volume }),
                onSpeakingChange: (isSpeaking) => {
                    this.patchParticipant(peerId, { isSpeaking });
                    this.emit('participant-speaking', peerId, isSpeaking);
                },
            }
        );
        slot.monitor = monitor;
        void monitor.start(audioTrack).catch((err) => this.log('remote monitor failed', err));
    }

    private playRemoteAudio(peerId: string): void {
        const slot = this.peers.get(peerId);
        const el = slot?.audioEl;
        if (!el) return;
        const attempt = () => el.play().catch(() => this.queueResume(peerId));
        void attempt();
    }

    /** Browsers block audio before user interaction — resume on first gesture. */
    private queueResume(peerId: string): void {
        const slot = this.peers.get(peerId);
        if (!slot || slot.resumeQueued) return;
        slot.resumeQueued = true;
        const resume = () => {
            slot.resumeQueued = false;
            window.removeEventListener('pointerdown', resume);
            window.removeEventListener('keydown', resume);
            for (const [id, s] of this.peers) {
                if (s.audioEl && s.remoteStream) {
                    void s.audioEl.play().catch(() => {});
                }
            }
            this.log('audio resumed on user gesture');
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown', resume);
    }

    // ------------------------------------------------------------------
    // Local audio: mute, devices, speaking detection
    // ------------------------------------------------------------------

    async setMuted(muted: boolean): Promise<void> {
        const track = this.state.localAudioTrack;
        if (track) track.enabled = !muted;
        this.updateState({ isMuted: muted });
        this.emit('mute-changed', muted);
    }

    async toggleMute(): Promise<void> {
        await this.setMuted(!this.state.isMuted);
    }

    async getAudioDevices(): Promise<import('./types').AudioDeviceOptions[]> {
        const devices = await this.mediaDevices.getAudioInputDevices();
        this.updateState({ audioInputDevices: devices as unknown as MediaDeviceInfo[] });
        return devices;
    }

    async switchAudioDevice(deviceId: string): Promise<void> {
        const newTrack = await this.mediaDevices.switchAudioDevice(deviceId);
        // Swap the track on every live peer connection (no renegotiation needed).
        for (const [, slot] of this.peers) {
            const sender = slot.pc.getSenders().find((s) => s.track?.kind === 'audio');
            if (sender) {
                try {
                    await sender.replaceTrack(newTrack);
                } catch (err) {
                    this.log('replaceTrack failed', err);
                }
            }
        }
        // Swap locally too.
        if (this.localStream) {
            const old = this.localStream.getAudioTracks()[0];
            if (old) {
                this.localStream.removeTrack(old);
                old.stop();
            }
            this.localStream.addTrack(newTrack);
        }
        this.startLocalMonitor(newTrack);
        this.updateState({ localAudioTrack: newTrack, selectedAudioInputId: deviceId });
    }

    private startLocalMonitor(track: MediaStreamTrack | null): void {
        this.stopLocalMonitor();
        if (!track) return;
        const monitor = new AudioLevelMonitor(
            { updateInterval: 150, speakingThreshold: 0.08 },
            {
                onVolumeChange: (volume) => {
                    if (Math.abs(this.state.localAudioLevel - volume) > 0.02) {
                        this.updateState({ localAudioLevel: volume });
                    }
                },
                onSpeakingChange: (isSpeaking) => {
                    this.updateState({ isSpeaking });
                    this.emit('local-speaking', isSpeaking);
                },
            }
        );
        this.localMonitor = monitor;
        void monitor.start(track).catch((err) => this.log('local monitor failed', err));
    }

    private stopLocalMonitor(): void {
        this.localMonitor?.stop();
        this.localMonitor = null;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    getState(): VoiceState {
        return this.state;
    }

    private updateState(patch: Partial<VoiceState>): void {
        this.state = { ...this.state, ...patch };
        this.emitState();
    }

    private emitState(): void {
        this.emit('state-changed', this.state);
    }

    private setConnectionState(s: VoiceConnectionState): void {
        if (this.state.connectionState === s) return;
        this.updateState({ connectionState: s });
        this.emit('connection-state-changed', s);
    }
}

// ----------------------------------------------------------------------
// Singleton (same shape as the old getVoiceService)
// ----------------------------------------------------------------------

let singleton: P2PVoiceService | null = null;

/** Lazily-created process-wide mesh service. deviceId comes from guest identity. */
export function getVoiceService(config?: VoiceServiceConfig): P2PVoiceService {
    if (!singleton) {
        if (!config) {
            throw new Error('getVoiceService() requires config on first call (deviceId).');
        }
        singleton = new P2PVoiceService(config);
    }
    return singleton;
}

/** Backwards-compatible alias (old code imported the class as VoiceService). */
export { P2PVoiceService as VoiceService };

export async function resetVoiceService(): Promise<void> {
    if (singleton) {
        await singleton.dispose();
        singleton = null;
    }
}
