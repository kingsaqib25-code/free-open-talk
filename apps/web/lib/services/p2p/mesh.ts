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
import { isBlocked } from '@/lib/blocked';
import type {
    VoiceServiceConfig,
    VoiceServiceEvents,
    VoiceState,
    VoiceConnectionState,
    RemoteParticipant,
    SignalOutbound,
    InboundSignal,
    AudioDeviceOptions,
    JoinRoomOptions,
    TrackMetaPayload,
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
    /** streamId -> 'camera' | 'screen' (screen announces itself via track-meta) */
    streamKinds: Map<string, 'camera' | 'screen'>;
    /** track.id -> streamId, for reclassification when track-meta arrives late */
    trackStreams: Map<string, string>;
}

const initialState = (): VoiceState => ({    connectionState: 'disconnected',
    isConnecting: false,
    isConnected: false,
    isMuted: false,
    isSpeaking: false,
    localAudioLevel: 0,
    currentRoomId: null,
    localAudioTrack: null,
    localVideoTrack: null,
    localScreenTrack: null,
    isVideoOn: false,
    isSharingScreen: false,
    isSharingScreenAudio: false,
    isPublishing: false,
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
    private config: Required<Omit<VoiceServiceConfig, 'deviceId' | 'audioConstraints' | 'videoConstraints'>> &
        Pick<VoiceServiceConfig, 'deviceId' | 'audioConstraints' | 'videoConstraints'>;
    private state: VoiceState = initialState();
    private peers = new Map<string, PeerSlot>();
    private localStream: MediaStream | null = null;
    /** Camera stream (separate from mic so it can toggle independently). */
    private cameraStream: MediaStream | null = null;
    /** Screen-share stream from getDisplayMedia. */
    private screenStream: MediaStream | null = null;
    /** Display stream captured by beginScreenSharePreview, not yet published. */
    private previewScreenStream: MediaStream | null = null;
    /** Host paused the shared screen video track (track.enabled = false). */
    private screenSharePaused = false;
    /** Remote deviceId -> host-paused state of their shared screen. */
    private remoteScreenPaused = new Map<string, boolean>();
    /** Whether the camera should be on whenever we are publishing. */
    private videoDesired = false;
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
            videoConstraints: config.videoConstraints,
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

    async joinRoom(roomId: string, opts?: JoinRoomOptions): Promise<{ participants?: string[] }> {
        if (this.state.isConnecting || this.state.currentRoomId === roomId) {
            return { participants: [...this.peers.keys()] };
        }
        const publish = opts?.publish ?? true;
        this.videoDesired = opts?.video ?? false;
        this.updateState({
            connectionState: 'connecting',
            isConnecting: true,
            error: null,
            currentRoomId: roomId,
        });

        try {
            let track: MediaStreamTrack | null = null;
            if (publish) {
                const stream = await this.mediaDevices.getAudioStream();
                if (this.disposed) {
                    stream.getTracks().forEach((t) => t.stop());
                    return {};
                }
                track = stream.getAudioTracks()[0] ?? null;
                this.localStream = stream;
                this.startLocalMonitor(track);
                // Camera alongside the mic when the room wants video.
                if (this.videoDesired) {
                    const videoTrack = await this.acquireCamera();
                    if (!videoTrack) this.videoDesired = false; // audio-only fallback
                }
            }

            this.updateState({
                connectionState: 'connected',
                isConnecting: false,
                isConnected: true,
                isPublishing: publish,
                isMuted: track ? !track.enabled : false,
                localAudioTrack: track,
                localVideoTrack: this.cameraStream?.getVideoTracks()[0] ?? null,
                isVideoOn: !!this.cameraStream,
                selectedAudioInputId: track?.getSettings().deviceId ?? null,
            });
            this.emit('connection-state-changed', 'connected');
            this.log('joined room', roomId, publish ? '(publishing)' : '(listen-only)');
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
        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach((t) => t.stop());
            this.cameraStream = null;
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach((t) => t.stop());
            this.screenStream = null;
        }
        this.videoDesired = false;
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
            streamKinds: new Map(),
            trackStreams: new Map(),
        };
        this.peers.set(peerId, slot);
        this.log(`PC created for ${peerId} (polite=${slot.polite})`);

        // Attach our local tracks (mic, camera, active screen share).
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) {
                pc.addTrack(track, this.localStream);
            }
        }
        if (this.cameraStream) {
            for (const track of this.cameraStream.getVideoTracks()) {
                pc.addTrack(track, this.cameraStream);
            }
        }
        if (this.screenStream) {
            for (const track of this.screenStream.getVideoTracks()) {
                pc.addTrack(track, this.screenStream);
                // Newcomer must know this stream is a screen share, not a camera.
                this.sendSignal(peerId, 'track-meta', {
                    action: 'add',
                    kind: 'screen',
                    streamId: this.screenStream.id,
                } satisfies TrackMetaPayload);
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
        this.remoteScreenPaused.delete(peerId);

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
            videoTrack: existing?.videoTrack ?? null,
            screenTrack: existing?.screenTrack ?? null,
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
            patch.videoTrack !== undefined ||
            patch.screenTrack !== undefined ||
            patch.peerConnection !== undefined;
        this.state.remoteParticipants = next;
        if (changed) this.emitState();
    }

    // ------------------------------------------------------------------
    // Signaling (inbound, from Convex poll)
    // ------------------------------------------------------------------

    async handleSignal(fromDeviceId: string, type: InboundSignal['type'], payload: unknown): Promise<void> {
        if (fromDeviceId === this.config.deviceId || this.disposed) return;
        // Track metadata doesn't need a peer connection — route it first.
        if (type === 'track-meta') {
            this.handleTrackMeta(fromDeviceId, payload);
            return;
        }
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
        if (e.track.kind === 'video') {
            this.handleRemoteVideoTrack(peerId, e);
            return;
        }
        const slot = this.peers.get(peerId);
        if (!slot) return;
        const streamId = e.streams[0]?.id ?? '';
        // Record for late track-meta reclassification (video path uses it).
        if (e.track.id) slot.trackStreams.set(e.track.id, streamId);

        // Never replace the playback stream — mix every incoming audio track
        // (mic + screen-share audio) into one persistent stream. Misclassifying
        // a screen-audio track that arrived before its track-meta is harmless:
        // it plays either way, which is the desired outcome.
        if (!slot.remoteStream) {
            slot.remoteStream = e.streams[0] ?? new MediaStream([e.track]);
        } else if (!slot.remoteStream.getTrackById(e.track.id)) {
            slot.remoteStream.addTrack(e.track);
        }
        const kind = slot.streamKinds.get(streamId);
        if (kind === 'screen') this.log(`screen audio mixed for ${peerId}`);

        const audioTrack = slot.remoteStream.getAudioTracks()[0] ?? e.track;
        this.patchParticipant(peerId, { audioTrack });

        if (!slot.audioEl) {
            const el = new Audio();
            el.autoplay = true;
            (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
            // Honor the personal block list: blocked peers are muted locally.
            el.muted = isBlocked(peerId);
            slot.audioEl = el;
        }
        slot.audioEl.srcObject = slot.remoteStream;
        this.playRemoteAudio(peerId);

        // Remove the track from the mix when the sender stops sharing it.
        e.track.onended = () => {
            slot.remoteStream?.removeTrack(e.track);
        };

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

    /**
     * Route an incoming remote video track to camera vs screen-share.
     * Screen shares announce themselves via the 'track-meta' signal; a video
     * track with no announcement is the camera (announcements can arrive
     * after ontrack, so late metadata reclassifies — see handleTrackMeta).
     */
    private handleRemoteVideoTrack(peerId: string, e: RTCTrackEvent): void {
        const slot = this.peers.get(peerId);
        if (!slot) return;
        const track = e.track;
        const streamId = e.streams[0]?.id ?? '';
        if (track.id) slot.trackStreams.set(track.id, streamId);
        const kind = streamId ? slot.streamKinds.get(streamId) : undefined;
        if (kind === 'screen') {
            this.patchParticipant(peerId, { screenTrack: track });
        } else {
            this.patchParticipant(peerId, { videoTrack: track });
        }
        track.onended = () => this.clearRemoteVideoTrack(peerId, track);
        this.log(`remote video (${kind ?? 'camera?'}) from ${peerId}`);
    }

    private clearRemoteVideoTrack(peerId: string, track: MediaStreamTrack): void {
        const cur = this.state.remoteParticipants.get(peerId);
        if (!cur) return;
        if (cur.videoTrack === track) this.patchParticipant(peerId, { videoTrack: null });
        if (cur.screenTrack === track) this.patchParticipant(peerId, { screenTrack: null });
    }

    /**
     * Handle screen-share announcements from a peer.
     * { action: 'add' } marks the streamId as a screen share (reclassifying
     * any already-received video track from that stream); { action: 'remove' }
     * clears the remote screen tile.
     */
    private handleTrackMeta(fromDeviceId: string, payload: unknown): void {
        const meta = payload as TrackMetaPayload;
        const slot = this.peers.get(fromDeviceId);
        if (!slot || !meta || typeof meta.streamId !== 'string') return;
        if (meta.action === 'add' && meta.kind === 'screen') {
            slot.streamKinds.set(meta.streamId, 'screen');
            const cur = this.state.remoteParticipants.get(fromDeviceId);
            if (cur?.videoTrack) {
                const sid = slot.trackStreams.get(cur.videoTrack.id);
                if (sid === meta.streamId) {
                    this.patchParticipant(fromDeviceId, {
                        videoTrack: null,
                        screenTrack: cur.videoTrack,
                    });
                }
            }
            // Host pause/resume of a live share rides on the same
            // announcement so viewers can show a paused banner instead of
            // a black frame. Optional runtime field — never filtered.
            const paused = (meta as { paused?: unknown }).paused;
            if (typeof paused === 'boolean') {
                this.remoteScreenPaused.set(fromDeviceId, paused);
                this.emit('screen-share-paused', fromDeviceId, paused);
            }
        } else if (meta.action === 'remove') {
            slot.streamKinds.delete(meta.streamId);
            this.remoteScreenPaused.delete(fromDeviceId);
            const cur = this.state.remoteParticipants.get(fromDeviceId);
            if (cur?.screenTrack) {
                const sid = slot.trackStreams.get(cur.screenTrack.id);
                if (!sid || sid === meta.streamId) {
                    this.patchParticipant(fromDeviceId, { screenTrack: null });
                }
            }
        }
    }

    private playRemoteAudio(peerId: string): void {
        const slot = this.peers.get(peerId);
        const el = slot?.audioEl;
        if (!el) return;
        const attempt = () => el.play().catch(() => this.queueResume(peerId));
        void attempt();
    }

    /** Re-apply the personal block list to all remote audio elements.
     *  Called when the user blocks/unblocks someone mid-call. */
    refreshBlockedAudio(): void {
        for (const [peerId, slot] of this.peers) {
            if (slot.audioEl) {
                slot.audioEl.muted = isBlocked(peerId);
            }
        }
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

    // ------------------------------------------------------------------
    // Local video, screen share, publishing (stage mode)
    // ------------------------------------------------------------------

    /** Acquire the camera. Returns the video track, or null on failure. */
    private async acquireCamera(): Promise<MediaStreamTrack | null> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user',
                    ...(this.config.videoConstraints ?? {}),
                },
                audio: false,
            });
            const track = stream.getVideoTracks()[0] ?? null;
            if (!track) {
                stream.getTracks().forEach((t) => t.stop());
                return null;
            }
            if (this.cameraStream) {
                this.cameraStream.getTracks().forEach((t) => t.stop());
            }
            this.cameraStream = stream;
            return track;
        } catch (err) {
            this.log('camera acquisition failed', err);
            return null;
        }
    }

    /** Ask every peer for fresh SDP (used after addTrack/removeTrack). */
    private renegotiate(peerId: string): void {
        const slot = this.peers.get(peerId);
        if (!slot || this.disposed) return;
        // onnegotiationneeded fires async and covers the non-stable case;
        // this explicit kick handles the common stable case immediately.
        if (slot.pc.signalingState === 'stable') {
            void this.createAndSendOffer(peerId);
        }
    }

    /**
     * Toggle camera publish. Safe to call before joining (marks intent) —
     * the track attaches on the next publish/join.
     */
    async setVideoEnabled(on: boolean): Promise<void> {
        if (on === this.state.isVideoOn || this.disposed) return;
        this.videoDesired = on;
        if (!on) {
            const track = this.state.localVideoTrack;
            for (const [peerId, slot] of this.peers) {
                const sender = slot.pc
                    .getSenders()
                    .find((s) => s.track === track);
                if (sender) {
                    try {
                        slot.pc.removeTrack(sender);
                    } catch { /* ignore */ }
                    this.renegotiate(peerId);
                }
            }
            track?.stop();
            if (this.cameraStream) {
                this.cameraStream.getTracks().forEach((t) => t.stop());
                this.cameraStream = null;
            }
            this.updateState({ localVideoTrack: null, isVideoOn: false });
            this.emit('video-changed', false);
            return;
        }
        if (!this.state.isConnected || !this.state.isPublishing) {
            // Not in a position to publish yet; intent is stored in videoDesired.
            this.log('video desired; will attach on publish');
            return;
        }
        const track = await this.acquireCamera();
        if (!track || this.disposed) return;
        for (const [peerId, slot] of this.peers) {
            try {
                slot.pc.addTrack(track, this.cameraStream!);
            } catch (err) {
                this.log(`addTrack(camera) failed for ${peerId}`, err);
                continue;
            }
            this.renegotiate(peerId);
        }
        this.updateState({ localVideoTrack: track, isVideoOn: true });
        this.emit('video-changed', true);
    }

    /**
     * Publish an already-captured display stream to every peer. Shared by
     * startScreenShare (instant) and publishScreenSharePreview (after the
     * user approves the preview) — identical wire behavior either way.
     *
     * Zero platform restrictions: we publish whatever the OS gave us, as-is.
     */
    private async publishScreenStream(stream: MediaStream): Promise<void> {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0] ?? null;
        if (!videoTrack) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error('Screen share produced no video track.');
        }
        this.screenStream = stream;
        this.screenSharePaused = false;
        const meta: TrackMetaPayload = {
            action: 'add',
            kind: 'screen',
            streamId: stream.id,
        };
        for (const [peerId, slot] of this.peers) {
            try {
                slot.pc.addTrack(videoTrack, stream);
                if (audioTrack) slot.pc.addTrack(audioTrack, stream);
            } catch (err) {
                this.log(`addTrack(screen) failed for ${peerId}`, err);
                continue;
            }
            this.sendSignal(peerId, 'track-meta', meta);
            this.renegotiate(peerId);
        }
        // Browser "Stop sharing" button → clean up like a manual stop.
        const onEnded = () => {
            void this.stopScreenShare().catch(() => {});
        };
        videoTrack.onended = onEnded;
        if (audioTrack) audioTrack.onended = onEnded;
        this.updateState({ localScreenTrack: videoTrack, isSharingScreen: true, isSharingScreenAudio: !!audioTrack });
        this.emit('screen-share-changed', true);
        this.log(`screen share started${audioTrack ? ' (with audio)' : ' (video only)'}`);
    }

    /**
     * Capture a display stream and hold it as a PREVIEW — nothing is
     * published to peers until publishScreenSharePreview() is called.
     * Lets the UI show "here is what everyone will see" with Go Live /
     * Cancel before anyone else sees a pixel.
     *
     * Must be called from a user gesture (button click) or the browser
     * may block the picker. Returns null when the user cancels the picker.
     * Zero platform restrictions: we request whatever the OS offers.
     */
    async beginScreenSharePreview(): Promise<MediaStream | null> {
        if (this.disposed) throw new Error('Screen share unavailable.');
        if (this.state.isSharingScreen || this.previewScreenStream) {
            return this.previewScreenStream;
        }
        if (!this.state.isConnected || !this.state.isPublishing) {
            throw new Error('Join as a publisher before sharing your screen.');
        }
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                // System/tab audio: the browser only includes it when the
                // user picks a tab and ticks "Share tab audio" (or the OS
                // provides loopback). Absent on some platforms — handled below.
                audio: true,
            });
        } catch (err) {
            // User cancelled the picker — not an error worth surfacing.
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                this.log('screen share picker cancelled');
                return null;
            }
            throw err;
        }
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error('Screen share produced no video track.');
        }
        // OS-level stop (browser "Stop sharing") during preview → drop it.
        const onEnded = () => {
            if (this.previewScreenStream === stream) this.cancelScreenSharePreview();
        };
        videoTrack.onended = onEnded;
        const audioTrack = stream.getAudioTracks()[0] ?? null;
        if (audioTrack) audioTrack.onended = onEnded;
        this.previewScreenStream = stream;
        this.emit('screen-share-preview', stream);
        return stream;
    }

    /**
     * Go live with the previewed stream: publish it to every peer.
     * No-op (with preview discarded) if a live share is already running.
     */
    async publishScreenSharePreview(): Promise<void> {
        const stream = this.previewScreenStream;
        if (!stream) return;
        this.previewScreenStream = null;
        this.emit('screen-share-preview', null);
        if (this.state.isSharingScreen || this.disposed) {
            stream.getTracks().forEach((t) => {
                try { t.stop(); } catch { /* ignore */ }
            });
            return;
        }
        await this.publishScreenStream(stream);
    }

    /** Discard the preview without publishing anything. */
    cancelScreenSharePreview(): void {
        const stream = this.previewScreenStream;
        if (!stream) return;
        this.previewScreenStream = null;
        stream.getTracks().forEach((t) => {
            try { t.stop(); } catch { /* ignore */ }
        });
        this.emit('screen-share-preview', null);
        this.log('screen share preview cancelled');
    }

    /**
     * Pause / resume the live share WITHOUT stopping it: the video track
     * is disabled (peers keep the connection, viewers see the last frame
     * or a paused banner) and re-enabled on resume. Audio is untouched.
     * Viewers are notified via track-meta so they can show the paused state.
     */
    setScreenSharePaused(paused: boolean): void {
        const track = this.state.localScreenTrack;
        if (!track || !this.state.isSharingScreen) return;
        if (this.screenSharePaused === paused) return;
        track.enabled = !paused;
        this.screenSharePaused = paused;
        const meta = {
            action: 'add',
            kind: 'screen',
            streamId: this.screenStream?.id ?? '',
            paused,
        } as TrackMetaPayload;
        for (const [peerId] of this.peers) {
            this.sendSignal(peerId, 'track-meta', meta);
        }
        this.emit('screen-share-paused', null, paused);
        this.log(`screen share ${paused ? 'paused' : 'resumed'}`);
    }

    /** Whether the host's live share is currently paused. */
    getScreenSharePaused(): boolean {
        return this.screenSharePaused;
    }

    /**
     * Share screen / window / tab, with system/tab audio when the OS
     * provides it. Publishes immediately (no preview) — use
     * beginScreenSharePreview + publishScreenSharePreview for the
     * preview-before-live flow.
     *
     * Must be called from a user gesture (button click)
     * or the browser may block the picker.
     *
     * Zero platform restrictions: we request whatever the OS offers and
     * share it as-is. If a source app shows a black screen due to its own
     * DRM, that is the other company's restriction, not ours.
     */
    async startScreenShare(): Promise<void> {
        if (this.state.isSharingScreen || this.disposed) return;
        if (this.previewScreenStream) {
            // A preview is waiting for the user's Go Live / Cancel decision.
            throw new Error('A screen preview is already waiting — go live or cancel it first.');
        }
        if (!this.state.isConnected || !this.state.isPublishing) {
            throw new Error('Join as a publisher before sharing your screen.');
        }
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                // System/tab audio: the browser only includes it when the
                // user picks a tab and ticks "Share tab audio" (or the OS
                // provides loopback). Absent on some platforms — handled below.
                audio: true,
            });
        } catch (err) {
            // User cancelled the picker — not an error worth surfacing.
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                this.log('screen share picker cancelled');
                return;
            }
            throw err;
        }
        await this.publishScreenStream(stream);
    }

    async stopScreenShare(): Promise<void> {
        const track = this.state.localScreenTrack;
        const stream = this.screenStream;
        if (!track && !stream) return;
        // Remove every sender carrying a screen-share track (video + audio).
        const screenTrackIds = new Set((stream?.getTracks() ?? []).map((t) => t.id));
        if (track) screenTrackIds.add(track.id);
        const meta: TrackMetaPayload = {
            action: 'remove',
            kind: 'screen',
            streamId: stream?.id ?? '',
        };
        for (const [peerId, slot] of this.peers) {
            let removed = false;
            for (const sender of slot.pc.getSenders()) {
                if (sender.track && screenTrackIds.has(sender.track.id)) {
                    try {
                        slot.pc.removeTrack(sender);
                    } catch { /* ignore */ }
                    removed = true;
                }
            }
            if (removed) {
                this.sendSignal(peerId, 'track-meta', meta);
                this.renegotiate(peerId);
            }
        }
        // Stop every track the OS gave us (video + system/tab audio).
        stream?.getTracks().forEach((t) => {
            try { t.stop(); } catch { /* ignore */ }
        });
        this.screenStream = null;
        this.screenSharePaused = false;
        // Only flip state if we were actually sharing (onended can race).
        if (this.state.isSharingScreen) {
            this.updateState({ localScreenTrack: null, isSharingScreen: false, isSharingScreenAudio: false });
            this.emit('screen-share-changed', false);
        }
        this.log('screen share stopped');
    }

    /**
     * Stage mode: flip between publisher (mic/camera live) and listener
     * (receive-only, no local capture). Idempotent — the React layer calls
     * this whenever the Convex role changes.
     */
    async setPublishing(publish: boolean): Promise<void> {
        if (this.disposed || publish === this.state.isPublishing) return;
        if (!this.state.isConnected) {
            this.updateState({ isPublishing: publish });
            this.emit('publishing-changed', publish);
            return;
        }
        if (publish) {
            try {
                const stream = await this.mediaDevices.getAudioStream();
                const audioTrack = stream.getAudioTracks()[0] ?? null;
                this.localStream = stream;
                if (audioTrack) {
                    for (const [peerId, slot] of this.peers) {
                        try {
                            slot.pc.addTrack(audioTrack, stream);
                        } catch (err) {
                            this.log(`addTrack(audio) failed for ${peerId}`, err);
                            continue;
                        }
                        this.renegotiate(peerId);
                    }
                }
                this.startLocalMonitor(audioTrack);
                this.updateState({
                    isPublishing: true,
                    isMuted: audioTrack ? !audioTrack.enabled : false,
                    localAudioTrack: audioTrack,
                    selectedAudioInputId:
                        audioTrack?.getSettings().deviceId ?? null,
                });
                if (this.videoDesired) {
                    await this.setVideoEnabled(true).catch((err) =>
                        this.log('camera re-attach failed', err)
                    );
                }
                this.emit('publishing-changed', true);
                this.log('now publishing');
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                this.updateState({ error });
                this.emit('error', error);
                throw error;
            }
            return;
        }
        // Demote to listener: stop everything we publish.
        await this.stopScreenShare().catch(() => {});
        if (this.state.isVideoOn) {
            await this.setVideoEnabled(false).catch(() => {});
        }
        for (const [peerId, slot] of this.peers) {
            let changed = false;
            for (const sender of slot.pc.getSenders()) {
                if (sender.track) {
                    try {
                        slot.pc.removeTrack(sender);
                    } catch { /* ignore */ }
                    changed = true;
                }
            }
            if (changed) this.renegotiate(peerId);
        }
        this.stopLocalMonitor();
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }
        this.updateState({
            isPublishing: false,
            localAudioTrack: null,
            localAudioLevel: 0,
            isSpeaking: false,
            isMuted: false,
        });
        this.emit('publishing-changed', false);
        this.log('now listen-only');
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
