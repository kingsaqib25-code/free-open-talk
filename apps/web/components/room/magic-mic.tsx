'use client';

/**
 * Magic Mic — fun voice changer built on the Web Audio API.
 *
 * Pipeline: live mic track → AudioContext → MediaStreamAudioSourceNode →
 * effect chain → MediaStreamAudioDestinationNode → new audio track →
 * mesh.replaceLocalAudioTrack(newTrack) (swaps the track on every peer
 * connection; no renegotiation needed). "Off" tears the graph down and
 * re-acquires the raw mic via getUserMedia.
 *
 * The effect is LIVE — everyone in the room hears the changed voice.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Mic, Loader2 } from '@/components/ui/icons';
import { cn } from '@/lib/design-system';
import { getVoiceService } from '@/lib/services/p2p';

export type MagicMicPreset = 'off' | 'chipmunk' | 'deep' | 'robot';

export const MAGIC_MIC_PRESETS: {
    id: MagicMicPreset;
    label: string;
    hint: string;
}[] = [
    { id: 'off', label: 'Off', hint: 'Your normal voice' },
    { id: 'chipmunk', label: 'Chipmunk', hint: 'High & squeaky' },
    { id: 'deep', label: 'Deep', hint: 'Low & boomy' },
    { id: 'robot', label: 'Robot', hint: 'Metallic echo' },
];

// ---------------------------------------------------------------------------
// Effect graph builders
// ---------------------------------------------------------------------------

/**
 * Cheap live pitch shifter: a sawtooth-modulated delay line.
 * Rising ramp compresses time (pitch up), falling ramp stretches (pitch down).
 * Fun-grade quality — slight warble/clicks are part of the charm.
 */
function buildPitchShifter(
    ctx: BaseAudioContext,
    semitones: number
): { input: AudioNode; output: AudioNode; stop: () => void } {
    const factor = Math.pow(2, semitones / 12);
    const D = 0.03; // max delay (s)
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = D / 2;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const depth = ctx.createGain();
    if (factor > 1) {
        // rising ramp → pitch up
        const f = Math.min((1 - 1 / factor) / D, 60);
        osc.frequency.value = Math.max(f, 1);
        depth.gain.value = D / 2;
    } else {
        // falling ramp → pitch down
        const f = Math.min((1 / factor - 1) / D, 60);
        osc.frequency.value = Math.max(f, 1);
        depth.gain.value = -D / 2;
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    input.connect(delay);
    osc.connect(depth);
    depth.connect(delay.delayTime as AudioParam);
    delay.connect(lp);
    lp.connect(output);
    osc.start();
    return {
        input,
        output,
        stop: () => {
            try {
                osc.stop();
            } catch {
                /* already stopped */
            }
            input.disconnect();
            delay.disconnect();
            lp.disconnect();
            output.disconnect();
            depth.disconnect();
        },
    };
}

/** Robot: hard quantization waveshaper + short metallic slapback delay. */
function buildRobot(
    ctx: BaseAudioContext
): { input: AudioNode; output: AudioNode; stop: () => void } {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    const steps = 8;
    for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
    }
    shaper.curve = curve;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.045;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    input.connect(shaper);
    shaper.connect(output); // dry
    shaper.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(output);
    return {
        input,
        output,
        stop: () => {
            input.disconnect();
            shaper.disconnect();
            delay.disconnect();
            fb.disconnect();
            wet.disconnect();
            output.disconnect();
        },
    };
}

// ---------------------------------------------------------------------------
// Engine (module-level so the effect survives the panel closing)
// ---------------------------------------------------------------------------

interface EngineGraph {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    effect: { input: AudioNode; output: AudioNode; stop: () => void } | null;
    dest: MediaStreamAudioDestinationNode;
    effectTrack: MediaStreamTrack;
    origTrack: MediaStreamTrack;
}

let graph: EngineGraph | null = null;
let activePreset: MagicMicPreset = 'off';
let engineBusy = false;
let engineError: string | null = null;
const engineListeners = new Set<() => void>();

function emitEngine() {
    for (const l of engineListeners) l();
}

function engineSubscribe(l: () => void): () => void {
    engineListeners.add(l);
    return () => {
        engineListeners.delete(l);
    };
}

function engineSnapshot() {
    return { preset: activePreset, busy: engineBusy, error: engineError };
}

function teardownGraph() {
    if (!graph) return;
    const g = graph;
    graph = null;
    try {
        g.effect?.stop();
    } catch {
        /* ignore */
    }
    try {
        g.source.disconnect();
    } catch {
        /* ignore */
    }
    try {
        g.dest.disconnect();
    } catch {
        /* ignore */
    }
    g.effectTrack.stop();
    void g.ctx.close().catch(() => {});
}

async function setMagicMicPreset(preset: MagicMicPreset): Promise<void> {
    if (engineBusy || activePreset === preset) return;
    engineBusy = true;
    engineError = null;
    emitEngine();
    const mesh = getVoiceService();
    try {
        // Tear down any running effect first.
        const previousOrig = graph?.origTrack ?? null;
        teardownGraph();

        if (preset === 'off') {
            // Restore the raw mic: stop the pre-effect track, re-acquire fresh.
            previousOrig?.stop();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
            });
            const fresh = stream.getAudioTracks()[0];
            if (!fresh) throw new Error('Could not re-acquire the microphone.');
            fresh.enabled = !mesh.getState().isMuted;
            await mesh.replaceLocalAudioTrack(fresh);
            activePreset = 'off';
            return;
        }

        const origTrack = mesh.getState().localAudioTrack;
        if (!origTrack || origTrack.readyState === 'ended') {
            throw new Error('Join the room with your mic on first, then pick an effect.');
        }

        const ctx = new AudioContext({ latencyHint: 'interactive' });
        await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(new MediaStream([origTrack]));
        const effect =
            preset === 'robot' ? buildRobot(ctx) : buildPitchShifter(ctx, preset === 'chipmunk' ? 7 : -7);
        const dest = ctx.createMediaStreamDestination();
        source.connect(effect.input);
        effect.output.connect(dest);
        const effectTrack = dest.stream.getAudioTracks()[0];
        if (!effectTrack) throw new Error('Effect output failed to start.');
        effectTrack.enabled = origTrack.enabled;
        await mesh.replaceLocalAudioTrack(effectTrack);
        graph = { ctx, source, effect, dest, effectTrack, origTrack };
        activePreset = preset;
    } catch (err) {
        teardownGraph();
        engineError = err instanceof Error ? err.message : 'Magic Mic failed to start.';
        activePreset = 'off';
    } finally {
        engineBusy = false;
        emitEngine();
    }
}

/** Reactive view of the Magic Mic engine. */
export function useMagicMic() {
    const snap = useSyncExternalStore(
        engineSubscribe,
        engineSnapshot,
        engineSnapshot
    );
    const setPreset = useCallback((p: MagicMicPreset) => {
        void setMagicMicPreset(p);
    }, []);
    return { ...snap, setPreset };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function MagicMicPanel() {
    const { preset, busy, error, setPreset } = useMagicMic();

    // If the component unmounts while an effect runs we keep it live —
    // the user chose a live voice effect, not a preview. Nothing to clean up.
    useEffect(() => () => {}, []);

    return (
        <div>
            <div className="grid grid-cols-2 gap-2">
                {MAGIC_MIC_PRESETS.map((p) => {
                    const active = preset === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            disabled={busy}
                            onClick={() => setPreset(p.id)}
                            aria-pressed={active}
                            className={cn(
                                'rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60',
                                active
                                    ? 'border-primary-500 bg-primary-500/15 ring-1 ring-primary-500/50'
                                    : 'border-surface-border bg-surface-default hover:bg-surface-hover'
                            )}
                        >
                            <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                                {busy && active ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-primary-400" />
                                ) : (
                                    <Mic
                                        className={cn(
                                            'h-4 w-4',
                                            active ? 'text-primary-400' : 'text-text-tertiary'
                                        )}
                                    />
                                )}
                                {p.label}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-text-tertiary">
                                {p.hint}
                            </span>
                        </button>
                    );
                })}
            </div>
            {error && (
                <p className="mt-3 rounded-lg bg-status-error/10 px-3 py-2 text-xs text-status-error">
                    {error}
                </p>
            )}
            <p className="mt-3 text-xs text-text-tertiary leading-relaxed">
                Live effect — everyone in the room hears your changed voice
                until you switch it Off. No audio ever leaves your device
                except through the normal encrypted call.
            </p>
        </div>
    );
}
