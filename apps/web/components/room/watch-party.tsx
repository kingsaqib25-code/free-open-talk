'use client';

/**
 * Watch Party — movie + live voice chat together (Phase 6).
 *
 * The P2P voice mesh keeps running underneath untouched: people talk
 * while watching, like sitting in one room. Each viewer streams from
 * their OWN device (YouTube directly, or their own copy of the file),
 * so this costs us $0 in bandwidth and puts no echo into the voice chat.
 *
 * Sync protocol: the host writes { status, positionSec, updatedAt } to
 * the Convex `watchParty` table on play/pause/seek; every viewer
 * subscribes reactively and reconciles their local player (seek if
 * drift > 2.5s, match play/pause). Late joiners snap to the current
 * timestamp automatically. Only the host broadcasts — viewers never
 * write, so there is no echo loop by construction.
 *
 * Zero own restrictions: we never block or filter what users share.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import { Button, Input, Card } from '@/components/ui';
import { getVoiceService, type VoiceState, type P2PVoiceService } from '@/lib/services/p2p';
import {
    Clapperboard,
    Play,
    Pause,
    X,
    Minimize2,
    Loader2,
    AlertCircle,
    Users,
    Check,
    Clock,
    Search,
    Monitor,
    MonitorOff,
} from '@/components/ui/icons';

/* ------------------------------------------------------------------ */
/* Types + YouTube helpers                                             */
/* ------------------------------------------------------------------ */

export interface WatchSession {
    kind: 'youtube' | 'file';
    videoId: string;
    title?: string;
    fileName?: string;
    fileSize?: number;
    status: 'playing' | 'paused';
    positionSec: number;
    updatedAt: number;
    hostDeviceId: string;
}

/** Minimal YouTube IFrame Player surface we actually use. */
interface YTPlayerLike {
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    getVideoData(): { title?: string };
    destroy(): void;
}

declare global {
    interface Window {
        YT?: {
            Player: new (
                el: HTMLElement,
                opts: Record<string, unknown>
            ) => YTPlayerLike;
        };
        onYouTubeIframeAPIReady?: () => void;
    }
}

const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

/** Singleton loader for the YouTube IFrame API. */
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.YT?.Player) return Promise.resolve();
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise<void>((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            try {
                prev?.();
            } catch {
                /* ignore */
            }
            resolve();
        };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            s.onerror = () => {
                ytApiPromise = null;
                reject(new Error('Could not load YouTube player.'));
            };
            document.head.appendChild(s);
        }
        // Safety: don't hang forever.
        setTimeout(() => reject(new Error('YouTube player timed out.')), 15000);
    });
    return ytApiPromise;
}

/** Extract the 11-char video ID from the common YouTube URL shapes. */
export function parseYouTubeId(url: string): string | null {
    const m = url
        .trim()
        .match(
            /(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
    return m?.[1] ?? null;
}

export function formatTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

/** Where the viewer should be right now, compensating for elapsed time. */
function targetPosition(s: WatchSession): number {
    const elapsed = s.status === 'playing' ? (Date.now() - s.updatedAt) / 1000 : 0;
    return Math.max(0, s.positionSec + elapsed);
}

function formatBytes(n?: number): string {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface WatchPartyContextValue {
    session: WatchSession | null | undefined;
    iAmController: boolean;
    /** Can this client start a session (owner, or owner gone). */
    canStart: boolean;
    expanded: boolean;
    setExpanded: (b: boolean) => void;
    startOpen: boolean;
    setStartOpen: (b: boolean) => void;
    startYouTube: (url: string) => Promise<string | null>;
    startFile: (file: File) => Promise<string | null>;
    stopSession: () => void;
    doControl: (status: 'playing' | 'paused', positionSec: number, title?: string) => void;
    // Local file (file mode)
    localFile: File | null;
    localFileUrl: string | null;
    fileMatches: boolean;
    pickLocalFile: (f: File | null) => void;
    deviceId: string;
    roomId: string;
}

const WatchPartyContext = createContext<WatchPartyContextValue | null>(null);

export function useWatchParty(): WatchPartyContextValue {
    const ctx = useContext(WatchPartyContext);
    if (!ctx) throw new Error('useWatchParty must be used inside WatchPartyProvider');
    return ctx;
}

interface ProviderProps {
    roomId: string;
    deviceId: string;
    iAmOwner: boolean;
    ownerIsLive: boolean;
    onWatchReadyChange: (ready: boolean) => void;
    children: React.ReactNode;
}

export function WatchPartyProvider({
    roomId,
    deviceId,
    iAmOwner,
    ownerIsLive,
    onWatchReadyChange,
    children,
}: ProviderProps) {
    const session = useQuery(
        api.watchparty.get,
        roomId ? { roomId: roomId as never } : 'skip'
    ) as WatchSession | null | undefined;
    const startMut = useMutation(api.watchparty.start);
    const controlMut = useMutation(api.watchparty.control);
    const stopMut = useMutation(api.watchparty.stop);

    const [expanded, setExpanded] = useState(false);
    const [startOpen, setStartOpen] = useState(false);
    const [localFile, setLocalFile] = useState<File | null>(null);
    const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);

    const sessionRef = useRef(session);
    sessionRef.current = session;

    // Who may drive playback: the owner, or (owner gone) whoever takes over.
    const iAmController = useMemo(() => {
        if (!session) return iAmOwner || !ownerIsLive;
        return (
            iAmOwner ||
            session.hostDeviceId === deviceId ||
            !ownerIsLive
        );
    }, [session, iAmOwner, ownerIsLive, deviceId]);

    const canStart = iAmOwner || !ownerIsLive;

    const fileMatches = useMemo(() => {
        if (!session || session.kind !== 'file' || !localFile) return false;
        return (
            localFile.name === session.fileName &&
            localFile.size === session.fileSize
        );
    }, [session, localFile]);

    // Report file readiness through the presence heartbeat.
    useEffect(() => {
        onWatchReadyChange(session?.kind === 'file' ? fileMatches : false);
    }, [session?.kind, fileMatches, onWatchReadyChange]);
    // Clear readiness when the session ends or the provider unmounts.
    useEffect(() => {
        if (session === null) {
            setLocalFile(null);
            onWatchReadyChange(false);
        }
    }, [session, onWatchReadyChange]);
    useEffect(() => {
        return () => onWatchReadyChange(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Revoke object URLs when replaced.
    const pickLocalFile = useCallback(
        (f: File | null) => {
            setLocalFileUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return f ? URL.createObjectURL(f) : null;
            });
            setLocalFile(f);
        },
        []
    );

    const doControl = useCallback(
        (status: 'playing' | 'paused', positionSec: number, title?: string) => {
            controlMut({
                roomId: roomId as never,
                deviceId,
                status,
                positionSec: Math.max(0, positionSec),
                title: title?.slice(0, 120),
            }).catch((e) => console.error('[watchparty] control failed', e));
        },
        [controlMut, roomId, deviceId]
    );

    const startYouTube = useCallback(
        async (url: string): Promise<string | null> => {
            const videoId = parseYouTubeId(url);
            if (!videoId) return 'That doesn\u2019t look like a YouTube link.';
            try {
                await startMut({
                    roomId: roomId as never,
                    deviceId,
                    kind: 'youtube',
                    videoId,
                });
            } catch (e) {
                return e instanceof Error ? e.message : 'Could not start.';
            }
            pickLocalFile(null);
            setStartOpen(false);
            setExpanded(true);
            return null;
        },
        [startMut, roomId, deviceId, pickLocalFile]
    );

    const startFile = useCallback(
        async (file: File): Promise<string | null> => {
            try {
                await startMut({
                    roomId: roomId as never,
                    deviceId,
                    kind: 'file',
                    videoId: '',
                    title: file.name,
                    fileName: file.name,
                    fileSize: file.size,
                });
            } catch (e) {
                return e instanceof Error ? e.message : 'Could not start.';
            }
            pickLocalFile(file);
            setStartOpen(false);
            setExpanded(true);
            return null;
        },
        [startMut, roomId, deviceId, pickLocalFile]
    );

    const stopSession = useCallback(() => {
        stopMut({ roomId: roomId as never, deviceId }).catch((e) =>
            console.error('[watchparty] stop failed', e)
        );
    }, [stopMut, roomId, deviceId]);

    const value: WatchPartyContextValue = {
        session,
        iAmController,
        canStart,
        expanded,
        setExpanded,
        startOpen,
        setStartOpen,
        startYouTube,
        startFile,
        stopSession,
        doControl,
        localFile,
        localFileUrl,
        fileMatches,
        pickLocalFile,
        deviceId,
        roomId,
    };

    return (
        <WatchPartyContext.Provider value={value}>
            {children}
        </WatchPartyContext.Provider>
    );
}

/* ------------------------------------------------------------------ */
/* Header button                                                       */
/* ------------------------------------------------------------------ */

export function WatchPartyHeaderButton() {
    const { session, canStart, setExpanded, setStartOpen, expanded } =
        useWatchParty();
    if (session) {
        return (
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                title="Watch party is live — open the player"
                className="text-amber-300"
            >
                <Clapperboard className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Watching</span>
                <span className="ml-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            </Button>
        );
    }
    if (!canStart) return null;
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => setStartOpen(true)}
            title="Watch a video together"
        >
            <Clapperboard className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Watch Together</span>
        </Button>
    );
}

/* ------------------------------------------------------------------ */
/* Start modal (host picks YouTube URL or a local file)                */
/* ------------------------------------------------------------------ */

export function WatchPartyStartModal() {
    const { startOpen, setStartOpen, startYouTube, startFile } = useWatchParty();
    const [tab, setTab] = useState<'youtube' | 'file'>('youtube');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (!startOpen) return null;

    const close = () => {
        setStartOpen(false);
        setError(null);
        setFile(null);
    };

    const handleFile = async () => {
        if (!file) {
            setError('Pick a video file first.');
            return;
        }
        setBusy(true);
        setError(null);
        const err = await startFile(file);
        setBusy(false);
        if (err) setError(err);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={close}
        >
            <Card
                className="w-full max-w-md p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <Clapperboard className="h-5 w-5 text-amber-300" />
                        Watch Together
                    </h2>
                    <button
                        type="button"
                        onClick={close}
                        className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex gap-2 mb-4">
                    {(['youtube', 'file'] as const).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => {
                                setTab(t);
                                setError(null);
                            }}
                            className={cn(
                                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
                                tab === t
                                    ? 'bg-primary-500/20 text-primary-300'
                                    : 'text-text-tertiary hover:bg-surface-hover'
                            )}
                        >
                            {t === 'youtube' ? 'YouTube' : 'My own file'}
                        </button>
                    ))}
                </div>

                {tab === 'youtube' ? (
                    <YouTubePickTab
                        onPickUrl={async (watchUrl) => {
                            setBusy(true);
                            setError(null);
                            const err = await startYouTube(watchUrl);
                            setBusy(false);
                            if (err) setError(err);
                        }}
                        busy={busy}
                    />
                ) : (
                    <div className="space-y-3">
                        <label className="block">
                            <span className="sr-only">Pick a video file</span>
                            <input
                                type="file"
                                accept="video/*"
                                className="block w-full text-sm text-text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-500/20 file:text-primary-300 hover:file:bg-primary-500/30 file:cursor-pointer"
                                onChange={(e) =>
                                    setFile(e.target.files?.[0] ?? null)
                                }
                            />
                        </label>
                        {file && (
                            <p className="text-xs text-text-secondary">
                                {file.name} · {formatBytes(file.size)}
                            </p>
                        )}
                        <p className="text-xs text-text-tertiary">
                            Everyone picks the <em>same file</em> on their own
                            device — nothing is uploaded. Play, pause and seek
                            stay in sync.
                        </p>
                        <Button
                            onClick={handleFile}
                            disabled={busy || !file}
                            fullWidth
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Start watching'
                            )}
                        </Button>
                    </div>
                )}

                {error && (
                    <p className="mt-3 text-sm text-status-error flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {error}
                    </p>
                )}

                <p className="mt-4 text-xs text-text-tertiary flex items-center gap-1.5">
                    🎧 <span>Headphones recommended — movie audio plays on
                    each device, voice chat stays live.</span>
                </p>
            </Card>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Overlay: minimized pill + expanded player                           */
/* ------------------------------------------------------------------ */

export function WatchPartyOverlay() {
    const { session, expanded, setExpanded } = useWatchParty();
    if (!session) return null;

    if (!expanded) {
        const label =
            session.kind === 'youtube'
                ? session.title || 'YouTube video'
                : session.fileName || 'Local file';
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="fixed bottom-20 right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500/90 hover:bg-amber-500 text-black text-sm font-medium shadow-lg transition-colors max-w-[240px]"
                title="Open watch party"
            >
                <Clapperboard className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
                <span className="h-2 w-2 rounded-full bg-red-700 animate-pulse shrink-0" />
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6">
            <Card className="w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden p-0">
                <SyncPlayer key={`${session.kind}:${session.videoId}:${session.fileName ?? ''}`} />
            </Card>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* SyncPlayer: the synced playback engine                             */
/* ------------------------------------------------------------------ */

function SyncPlayer() {
    const {
        session,
        iAmController,
        deviceId,
        roomId,
        doControl,
        stopSession,
        setExpanded,
        localFileUrl,
        fileMatches,
        pickLocalFile,
    } = useWatchParty();

    const [ready, setReady] = useState(false);
    const [duration, setDuration] = useState(0);
    const [pos, setPos] = useState(0);
    const [ytError, setYtError] = useState<string | null>(null);
    const [joined, setJoined] = useState(false); // viewer tapped "start watching"
    const [filePickError, setFilePickError] = useState<string | null>(null);

    const playerRef = useRef<YTPlayerLike | null>(null);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const lastSentRef = useRef<{ status: string; pos: number }>({ status: '', pos: 0 });
    const sessionRef = useRef(session);
    sessionRef.current = session;
    const iAmControllerRef = useRef(iAmController);
    iAmControllerRef.current = iAmController;

    const isYouTube = session?.kind === 'youtube';
    const title =
        session?.title ||
        (isYouTube ? 'YouTube video' : session?.fileName || 'Local file');

    const broadcast = useCallback(
        (status: 'playing' | 'paused', positionSec: number, titleOverride?: string) => {
            lastSentRef.current = { status, pos: positionSec };
            doControl(status, positionSec, titleOverride);
        },
        [doControl]
    );

    /* ---- YouTube player lifecycle ---- */
    useEffect(() => {
        if (!isYouTube || !session) return;
        let cancelled = false;
        let player: YTPlayerLike | null = null;

        loadYouTubeApi()
            .then(() => {
                if (cancelled || !mountRef.current || !window.YT) return;
                player = new window.YT.Player(mountRef.current, {
                    videoId: session.videoId,
                    playerVars: {
                        enablejsapi: 1,
                        rel: 0,
                        modestbranding: 1,
                        controls: 0, // we render our own synced controls
                        playsinline: 1,
                    },
                    events: {
                        onReady: (e: { target: YTPlayerLike }) => {
                            if (cancelled) return;
                            setReady(true);
                            const d = e.target.getDuration();
                            if (isFinite(d)) setDuration(d);
                            // Snap to the live position on load (late joiner / fresh start).
                            const s = sessionRef.current;
                            if (s) {
                                const t = targetPosition(s);
                                if (t > 1) e.target.seekTo(t, true);
                                if (s.status === 'playing' && iAmControllerRef.current) {
                                    e.target.playVideo();
                                }
                            }
                            if (iAmControllerRef.current) {
                                try {
                                    const t = e.target.getVideoData()?.title;
                                    if (t) {
                                        const cur = sessionRef.current;
                                        if (cur && cur.title !== t) {
                                            broadcast(cur.status, cur.positionSec, t);
                                        }
                                    }
                                } catch {
                                    /* ignore */
                                }
                            }
                        },
                        onStateChange: (e: { data: number; target: YTPlayerLike }) => {
                            // Only the controller broadcasts — viewers never write.
                            if (!iAmControllerRef.current) return;
                            const t = e.target.getCurrentTime();
                            if (e.data === YT_STATE.PLAYING) {
                                broadcast('playing', t);
                            } else if (e.data === YT_STATE.PAUSED) {
                                broadcast('paused', t);
                            } else if (e.data === YT_STATE.ENDED) {
                                stopRef.current();
                            }
                        },
                        onError: (e: { data: number }) => {
                            // 101 / 150 = embedding disabled by the uploader.
                            if (e.data === 101 || e.data === 150) {
                                setYtError(
                                    'This video can\u2019t be embedded here (the uploader disabled it). Try another link — or share your screen instead.'
                                );
                            } else {
                                setYtError(
                                    'YouTube couldn\u2019t play this video. Try another link.'
                                );
                            }
                        },
                    },
                });
                playerRef.current = player;
            })
            .catch(() => {
                if (!cancelled) setYtError('Could not load the YouTube player.');
            });

        return () => {
            cancelled = true;
            try {
                player?.destroy();
            } catch {
                /* ignore */
            }
            playerRef.current = null;
            setReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isYouTube, session?.videoId]);

    const stopRef = useRef(stopSession);
    stopRef.current = stopSession;

    /* ---- File <video> lifecycle ---- */
    useEffect(() => {
        const v = videoRef.current;
        if (!v || isYouTube) return;
        const onPlay = () => {
            if (iAmControllerRef.current) broadcast('playing', v.currentTime);
        };
        const onPause = () => {
            if (iAmControllerRef.current) broadcast('paused', v.currentTime);
        };
        const onSeeked = () => {
            if (iAmControllerRef.current) {
                const s = sessionRef.current;
                broadcast(s?.status ?? 'paused', v.currentTime);
            }
        };
        const onLoaded = () => {
            setReady(true);
            if (isFinite(v.duration)) setDuration(v.duration);
            const s = sessionRef.current;
            if (s) {
                const t = targetPosition(s);
                if (t > 1 && Math.abs(v.currentTime - t) > 1) v.currentTime = t;
            }
        };
        const onEnded = () => stopRef.current();
        v.addEventListener('play', onPlay);
        v.addEventListener('pause', onPause);
        v.addEventListener('seeked', onSeeked);
        v.addEventListener('loadedmetadata', onLoaded);
        v.addEventListener('ended', onEnded);
        return () => {
            v.removeEventListener('play', onPlay);
            v.removeEventListener('pause', onPause);
            v.removeEventListener('seeked', onSeeked);
            v.removeEventListener('loadedmetadata', onLoaded);
            v.removeEventListener('ended', onEnded);
            setReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isYouTube, localFileUrl]);

    /* ---- Controller drift broadcast (catches seeks the events miss) ---- */
    useEffect(() => {
        if (!iAmController) return;
        const timer = setInterval(() => {
            const s = sessionRef.current;
            if (!s || !ready) return;
            let p: number | null = null;
            if (isYouTube) {
                const pl = playerRef.current;
                if (!pl) return;
                p = pl.getCurrentTime();
            } else {
                const v = videoRef.current;
                if (!v) return;
                p = v.currentTime;
            }
            if (p == null || !isFinite(p)) return;
            if (Math.abs(p - lastSentRef.current.pos) > 3) {
                broadcast(s.status, p);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [iAmController, ready, isYouTube, broadcast]);

    /* ---- Viewer reconcile loop: snap to the host's timeline ---- */
    useEffect(() => {
        if (iAmController || !joined) return;
        const timer = setInterval(() => {
            const s = sessionRef.current;
            if (!s || !ready) return;
            const target = targetPosition(s);
            if (isYouTube) {
                const pl = playerRef.current;
                if (!pl) return;
                try {
                    const ps = pl.getPlayerState();
                    const cur = pl.getCurrentTime();
                    if (s.status === 'playing') {
                        if (ps !== YT_STATE.PLAYING && ps !== YT_STATE.BUFFERING) {
                            pl.playVideo();
                        }
                        if (Math.abs(cur - target) > 2.5) pl.seekTo(Math.max(0, target), true);
                    } else {
                        if (ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING) {
                            pl.pauseVideo();
                        }
                        if (Math.abs(cur - target) > 2.5) pl.seekTo(Math.max(0, target), true);
                    }
                } catch {
                    /* player mid-teardown */
                }
            } else {
                const v = videoRef.current;
                if (!v || !v.src) return;
                try {
                    if (s.status === 'playing') {
                        if (v.paused) void v.play().catch(() => {});
                        if (Math.abs(v.currentTime - target) > 2.5) v.currentTime = target;
                    } else {
                        if (!v.paused) v.pause();
                        if (Math.abs(v.currentTime - target) > 2.5) v.currentTime = target;
                    }
                } catch {
                    /* ignore */
                }
            }
        }, 500);
        return () => clearInterval(timer);
    }, [iAmController, joined, ready, isYouTube]);

    /* ---- Position ticker for the seek slider ---- */
    useEffect(() => {
        const timer = setInterval(() => {
            if (isYouTube) {
                const pl = playerRef.current;
                if (pl) {
                    try {
                        const c = pl.getCurrentTime();
                        if (isFinite(c)) setPos(c);
                        const d = pl.getDuration();
                        if (isFinite(d) && d > 0) setDuration(d);
                    } catch {
                        /* ignore */
                    }
                }
            } else {
                const v = videoRef.current;
                if (v && isFinite(v.currentTime)) setPos(v.currentTime);
            }
        }, 250);
        return () => clearInterval(timer);
    }, [isYouTube]);

    if (!session) return null;

    const playing = session.status === 'playing';

    const handlePlayPause = () => {
        if (!iAmController) return;
        if (isYouTube) {
            const pl = playerRef.current;
            if (!pl) return;
            if (playing) pl.pauseVideo();
            else pl.playVideo();
            // The onStateChange event broadcasts the change.
        } else {
            const v = videoRef.current;
            if (!v) return;
            if (playing) v.pause();
            else void v.play().catch(() => {});
        }
    };

    const handleSeek = (sec: number) => {
        if (!iAmController) return;
        setPos(sec);
        if (isYouTube) {
            playerRef.current?.seekTo(sec, true);
            // PLAYING-after-seek (or the drift poll) broadcasts it.
        } else {
            const v = videoRef.current;
            if (v) v.currentTime = sec;
            // 'seeked' event broadcasts it.
        }
    };

    const handleViewerJoin = () => {
        // Browsers require a user gesture for playback with sound.
        setJoined(true);
        if (isYouTube) {
            try {
                playerRef.current?.playVideo();
            } catch {
                /* reconcile loop will retry */
            }
        } else {
            const v = videoRef.current;
            if (v) void v.play().catch(() => {});
        }
    };

    const handleFilePick = (f: File | null) => {
        setFilePickError(null);
        if (!f || !session) {
            pickLocalFile(null);
            return;
        }
        if (f.name !== session.fileName || f.size !== session.fileSize) {
            setFilePickError(
                `That file doesn\u2019t match \u201c${session.fileName}\u201d (${formatBytes(session.fileSize)}). Pick the same file the host chose.`
            );
            return;
        }
        pickLocalFile(f);
    };

    const showFileGate = !isYouTube && !localFileUrl;

    return (
        <div className="flex flex-col min-h-0">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border">
                <Clapperboard className="h-5 w-5 text-amber-300 shrink-0" />
                <h2 className="font-semibold text-text-primary truncate flex-1">
                    {title}
                </h2>
                <span
                    className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
                        playing
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-surface-default text-text-tertiary'
                    )}
                >
                    {playing ? '● LIVE SYNC' : 'Paused'}
                </span>
                <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary"
                    title="Minimize (keeps playing)"
                    aria-label="Minimize player"
                >
                    <Minimize2 className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary"
                    aria-label="Close player"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Player area */}
            <div className="relative bg-black aspect-video w-full shrink-0">
                {isYouTube ? (
                    <>
                        <div ref={mountRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />
                        {ytError && (
                            <EmbedFallback
                                message={ytError}
                                videoId={session.videoId}
                            />
                        )}
                    </>
                ) : showFileGate ? (
                    <FileGate
                        session={session}
                        onPick={handleFilePick}
                        error={filePickError}
                    />
                ) : (
                    <video
                        ref={videoRef}
                        src={localFileUrl ?? undefined}
                        className="absolute inset-0 w-full h-full"
                        playsInline
                        preload="metadata"
                    />
                )}

                {/* Viewer tap-to-join (browser autoplay policy) */}
                {!iAmController && !ytError && !showFileGate && !joined && ready && (
                    <button
                        type="button"
                        onClick={handleViewerJoin}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
                    >
                        <span className="w-16 h-16 rounded-full bg-primary-500 flex items-center justify-center">
                            <Play className="h-7 w-7 ml-1" />
                        </span>
                        <span className="text-sm font-medium">
                            Tap to start watching in sync
                        </span>
                    </button>
                )}

                {!ready && !ytError && !showFileGate && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
                    </div>
                )}
            </div>

            {/* Synced controls */}
            <div className="px-4 py-3 border-t border-surface-border space-y-2.5">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handlePlayPause}
                        disabled={!iAmController || !ready || !!ytError || showFileGate}
                        className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors',
                            iAmController && ready
                                ? 'bg-primary-500 hover:bg-primary-400 text-white'
                                : 'bg-surface-default text-text-tertiary cursor-not-allowed'
                        )}
                        title={
                            iAmController
                                ? playing
                                    ? 'Pause for everyone'
                                    : 'Play for everyone'
                                : 'The host controls playback'
                        }
                        aria-label={playing ? 'Pause' : 'Play'}
                    >
                        {playing ? (
                            <Pause className="h-5 w-5" />
                        ) : (
                            <Play className="h-5 w-5 ml-0.5" />
                        )}
                    </button>
                    <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                        {formatTime(pos)}
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={Math.max(1, duration)}
                        step={0.5}
                        value={Math.min(pos, Math.max(1, duration))}
                        onChange={(e) => handleSeek(Number(e.target.value))}
                        disabled={!iAmController || !ready}
                        className="flex-1 accent-primary-500 disabled:opacity-50"
                        aria-label="Seek"
                    />
                    <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                        {formatTime(duration)}
                    </span>
                    {iAmController && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={stopSession}
                            title="Stop watch party for everyone"
                            className="text-status-error shrink-0"
                        >
                            Stop
                        </Button>
                    )}
                </div>
                {!iAmController && (
                    <p className="text-xs text-text-tertiary flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        The host controls playback — your screen follows
                        automatically. Voice chat stays live.
                    </p>
                )}
                {iAmController && (
                    <WatchReadinessList roomId={roomId} kind={session.kind} />
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* File gate: viewer picks the matching local file                     */
/* ------------------------------------------------------------------ */

function FileGate({
    session,
    onPick,
    error,
}: {
    session: WatchSession;
    onPick: (f: File | null) => void;
    error: string | null;
}) {
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background-secondary">
            <Clapperboard className="h-10 w-10 text-amber-300" />
            <p className="text-sm text-text-primary font-medium">
                The host is watching
            </p>
            <p className="text-sm text-text-secondary break-all">
                {session.fileName}{' '}
                <span className="text-text-tertiary">
                    ({formatBytes(session.fileSize)})
                </span>
            </p>
            <p className="text-xs text-text-tertiary max-w-sm">
                Pick the <em>same file</em> on your device to join in sync —
                nothing is uploaded, it never leaves your phone.
            </p>
            <label className="cursor-pointer">
                <span className="sr-only">Pick the matching video file</span>
                <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />
                <span className="inline-block px-5 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium transition-colors">
                    Choose the file
                </span>
            </label>
            {error && (
                <p className="text-xs text-status-error flex items-center gap-1.5 max-w-sm">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {error}
                </p>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Embed-disabled fallback                                             */
/* ------------------------------------------------------------------ */

function EmbedFallback({
    message,
    videoId,
}: {
    message: string;
    videoId: string;
}) {
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background-secondary">
            <AlertCircle className="h-10 w-10 text-amber-400" />
            <p className="text-sm text-text-secondary max-w-md">{message}</p>
            <a
                href={`https://www.youtube.com/watch?v=${videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 rounded-lg bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 text-sm font-medium transition-colors"
            >
                Open on YouTube
            </a>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Readiness list (file mode): who picked the file                     */
/* ------------------------------------------------------------------ */

function WatchReadinessList({
    roomId,
    kind,
}: {
    roomId: string;
    kind: 'youtube' | 'file';
}) {
    const participants = useQuery(
        api.presence.listForRoom,
        roomId ? { roomId: roomId as never } : 'skip'
    ) as Array<{ deviceId: string; nickname: string; watchReady?: boolean }> | undefined;

    if (kind !== 'file' || !participants || participants.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-1.5 pt-1">
            {participants.map((p) => (
                <span
                    key={p.deviceId}
                    className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border',
                        p.watchReady
                            ? 'border-emerald-500/40 text-emerald-300'
                            : 'border-surface-border text-text-tertiary'
                    )}
                    title={p.watchReady ? 'Has the file' : 'Waiting for the file'}
                >
                    {p.watchReady ? (
                        <Check className="h-3 w-3" />
                    ) : (
                        <Clock className="h-3 w-3" />
                    )}
                    <span className="max-w-[100px] truncate">{p.nickname}</span>
                </span>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* In-app YouTube browser (YouTube Data API v3)                         */
/*                                                                     */
/* Zero-cost: the browser calls Google's API directly, no server hop.  */
/* Tapping a result reuses the existing startYouTube() path, so the    */
/* synced-playback engine, late-joiner snap and embed fallback are     */
/* completely untouched.                                               */
/*                                                                     */
/* The key is NEVER in the code — it comes from                        */
/* NEXT_PUBLIC_YOUTUBE_API_KEY (set in Vercel env). No key → the old    */
/* link-paste UI stays, with a hint.                                   */
/* ------------------------------------------------------------------ */

/** Public browser key — safe to expose, restricted to the site in GCP. */
const YOUTUBE_API_KEY =
    typeof process !== 'undefined'
        ? (process.env.NEXT_PUBLIC_YOUTUBE_API_KEY ?? '').trim()
        : '';

interface YouTubeSearchResult {
    videoId: string;
    title: string;
    channel: string;
    thumbnail: string;
    duration: string;
}

/** "PT1H2M3S" -> "1:02:03", "PT4M20S" -> "4:20". */
function parseISODuration(iso?: string): string {
    if (!iso) return '';
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!m) return '';
    const h = Number(m[1] ?? 0);
    const min = Number(m[2] ?? 0);
    const s = Math.floor(Number(m[3] ?? 0));
    const mm = h > 0 ? String(min).padStart(2, '0') : String(min);
    return h > 0
        ? `${h}:${mm}:${String(s).padStart(2, '0')}`
        : `${mm}:${String(s).padStart(2, '0')}`;
}

/** YouTube titles arrive HTML-escaped ("&amp;"). Decode without innerHTML. */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

async function searchYouTubeVideos(
    q: string,
    signal: AbortSignal
): Promise<YouTubeSearchResult[]> {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '12');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);
    const res = await fetch(searchUrl.toString(), { signal });
    if (!res.ok) {
        if (res.status === 403)
            throw new Error(
                'YouTube blocked this search (API key issue or quota). Paste a link instead.'
            );
        throw new Error(`YouTube search failed (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const items: any[] = data.items ?? [];
    const ids = items
        .map((i) => i?.id?.videoId)
        .filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return [];

    // One videos.list call for all durations (contentDetails).
    const durations: Record<string, string> = {};
    try {
        const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        detailsUrl.searchParams.set('part', 'contentDetails');
        detailsUrl.searchParams.set('id', ids.join(','));
        detailsUrl.searchParams.set('key', YOUTUBE_API_KEY);
        const dres = await fetch(detailsUrl.toString(), { signal });
        if (dres.ok) {
            const ddata = await dres.json();
            for (const item of ddata.items ?? []) {
                durations[item.id] = parseISODuration(item.contentDetails?.duration);
            }
        }
    } catch {
        /* durations stay blank — thumbnails/titles still render */
    }

    return items.map((i) => ({
        videoId: i.id.videoId as string,
        title: decodeHtmlEntities(i.snippet?.title ?? 'Untitled'),
        channel: decodeHtmlEntities(i.snippet?.channelTitle ?? ''),
        thumbnail:
            i.snippet?.thumbnails?.medium?.url ??
            i.snippet?.thumbnails?.default?.url ??
            '',
        duration: durations[i.id.videoId] ?? '',
    }));
}

/** Fallback when no API key: the original link-paste UI, plus a hint. */
function YouTubeLinkFallback({
    onPickUrl,
    busy,
}: {
    onPickUrl: (watchUrl: string) => Promise<void>;
    busy: boolean;
}) {
    const [url, setUrl] = useState('');
    const [localBusy, setLocalBusy] = useState(false);

    const go = async () => {
        setLocalBusy(true);
        await onPickUrl(url);
        setLocalBusy(false);
    };

    return (
        <div className="space-y-3">
            <Input
                placeholder="Paste a YouTube link…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') void go();
                }}
            />
            <p className="text-xs text-text-tertiary">
                Everyone streams it from YouTube on their own device — in
                perfect sync, at zero cost to us.
            </p>
            <p className="text-xs text-amber-300/90">
                Tip: in-app search unlocks once NEXT_PUBLIC_YOUTUBE_API_KEY is
                set in the hosting env.
            </p>
            <Button
                onClick={() => void go()}
                disabled={busy || localBusy || !url.trim()}
                fullWidth
            >
                {busy || localBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    'Start watching'
                )}
            </Button>
        </div>
    );
}

export function YouTubePickTab({
    onPickUrl,
    busy,
}: {
    onPickUrl: (watchUrl: string) => Promise<void>;
    busy: boolean;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<YouTubeSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchedOnce, setSearchedOnce] = useState(false);
    const [linkMode, setLinkMode] = useState(false);

    // Debounced live search (~400ms). Aborts the in-flight request on each keystroke.
    useEffect(() => {
        const q = query.trim();
        if (!YOUTUBE_API_KEY || linkMode) return;
        if (q.length < 2) {
            setResults([]);
            setSearchedOnce(false);
            setSearchError(null);
            return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            setSearching(true);
            setSearchError(null);
            try {
                const items = await searchYouTubeVideos(q, ctrl.signal);
                setResults(items);
                setSearchedOnce(true);
            } catch (e) {
                if ((e as Error)?.name === 'AbortError') return;
                setSearchError(
                    e instanceof Error ? e.message : 'Search failed.'
                );
                setSearchedOnce(true);
            } finally {
                setSearching(false);
            }
        }, 400);
        return () => {
            clearTimeout(timer);
            ctrl.abort();
        };
    }, [query, linkMode]);

    // Graceful fallback: no key, or user chose link mode after an error.
    if (!YOUTUBE_API_KEY || linkMode) {
        return (
            <div className="space-y-3">
                {linkMode && YOUTUBE_API_KEY && (
                    <button
                        type="button"
                        onClick={() => {
                            setLinkMode(false);
                            setSearchError(null);
                        }}
                        className="text-xs text-primary-300 hover:underline"
                    >
                        ← Back to search
                    </button>
                )}
                <YouTubeLinkFallback onPickUrl={onPickUrl} busy={busy} />
            </div>
        );
    }

    const pick = (r: YouTubeSearchResult) => {
        void onPickUrl(`https://www.youtube.com/watch?v=${r.videoId}`);
    };

    return (
        <div className="space-y-3">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
                <Input
                    placeholder="Search YouTube…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                    autoFocus
                />
            </div>

            {searchError && (
                <div className="rounded-lg bg-status-error/10 border border-status-error/30 p-3">
                    <p className="text-xs text-status-error flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {searchError}
                    </p>
                    <button
                        type="button"
                        onClick={() => setLinkMode(true)}
                        className="mt-1.5 text-xs text-primary-300 hover:underline"
                    >
                        Paste a link instead →
                    </button>
                </div>
            )}

            <div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-0.5">
                {searching && (
                    <div className="flex items-center justify-center gap-2 py-8 text-text-tertiary">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Searching…</span>
                    </div>
                )}
                {!searching && searchedOnce && results.length === 0 && !searchError && (
                    <p className="text-sm text-text-tertiary text-center py-8">
                        No videos found — try different words.
                    </p>
                )}
                {!searching && !searchedOnce && (
                    <p className="text-sm text-text-tertiary text-center py-8">
                        Type to search YouTube — tap a result and everyone
                        starts watching in sync.
                    </p>
                )}
                {results.map((r) => (
                    <button
                        key={r.videoId}
                        type="button"
                        onClick={() => pick(r)}
                        disabled={busy}
                        className="w-full flex gap-3 p-2 rounded-xl hover:bg-surface-hover transition-colors text-left disabled:opacity-60"
                    >
                        <span className="relative shrink-0 w-[120px] aspect-video rounded-lg overflow-hidden bg-surface-default">
                            {r.thumbnail ? (
                                <img
                                    src={r.thumbnail}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <span className="w-full h-full flex items-center justify-center">
                                    <Clapperboard className="h-5 w-5 text-text-tertiary" />
                                </span>
                            )}
                            {r.duration && (
                                <span className="absolute bottom-1 right-1 text-[10px] font-medium bg-black/80 text-white px-1 py-0.5 rounded">
                                    {r.duration}
                                </span>
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-text-primary line-clamp-2 leading-snug">
                                {r.title}
                            </span>
                            {r.channel && (
                                <span className="block text-xs text-text-tertiary mt-1 truncate">
                                    {r.channel}
                                </span>
                            )}
                        </span>
                    </button>
                ))}
            </div>

            <p className="text-xs text-text-tertiary">
                Everyone streams from YouTube on their own device — in perfect
                sync, at zero cost to us.
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Screen share ADVANCED (beyond free4talk)                              */
/*                                                                     */
/* Three upgrades over the plain picker:                               */
/*  (a) Preview-before-live: capture first, show "what everyone will   */
/*      see" in a modal, publish to peers only after Go Live.           */
/*  (b) Viewers pop the shared screen into Picture-in-Picture.          */
/*  (c) The host pauses the share without stopping it (track.enabled   */
/*      toggle); viewers are notified and see a paused banner.          */
/*                                                                     */
/* Mesh side lives in lib/services/p2p/mesh.ts (screen-share functions */
/* only): beginScreenSharePreview / publishScreenSharePreview /         */
/* cancelScreenSharePreview / setScreenSharePaused, with               */
/* 'screen-share-preview' and 'screen-share-paused' events. The paused  */
/* flag rides on the existing track-meta signal — zero extra cost.     */
/*                                                                     */
/* Mounting (parent wires these into the room UI):                     */
/*   - <ScreenSharePreviewModal />  → anywhere inside the room layout   */
/*     (next to <WatchPartyStartModal />). It appears on its own when   */
/*     a preview is captured.                                          */
/*   - <ScreenShareShareButton />   → drop-in REPLACEMENT for the raw   */
/*     share button in voice-panel (captures preview first).            */
/*   - <ScreenShareHostControls /> → next to the share button: pause /  */
/*     resume + stop while a share is live.                            */
/*   - <RemoteScreenPiPButton stream /> → on each remote screen tile    */
/*     (voice-panel RemoteTile): viewer PiP with fallback message.     */
/* ------------------------------------------------------------------ */

function getShareService(): P2PVoiceService | null {
    try {
        return getVoiceService();
    } catch {
        return null;
    }
}

/** Live mirror of the mesh VoiceState, without needing VoiceProvider. */
function useVoiceServiceState(): VoiceState | null {
    const [state, setState] = useState<VoiceState | null>(null);
    useEffect(() => {
        const svc = getShareService();
        if (!svc) return;
        const off = svc.on('state-changed', (s: VoiceState) => setState(s));
        return () => {
            off();
        };
    }, []);
    return state;
}

/* ---------------- (a) Preview-before-live ---------------- */

/**
 * Drop-in share button: opens the OS picker, then shows the preview
 * modal (Go Live / Cancel). Nothing reaches peers until Go Live.
 * Replaces the raw startScreenShare() button in voice-panel.
 */
export function ScreenShareShareButton({ className }: { className?: string }) {
    const vs = useVoiceServiceState();
    const [picking, setPicking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sharing = vs?.isSharingScreen ?? false;
    const canShare = (vs?.isConnected ?? false) && (vs?.isPublishing ?? true);

    const handle = async () => {
        const svc = getShareService();
        if (!svc) return;
        setError(null);
        try {
            if (sharing) {
                await svc.stopScreenShare();
                return;
            }
            setPicking(true);
            // Modal appears via the 'screen-share-preview' event; null =
            // the user cancelled the picker (nothing to show).
            await svc.beginScreenSharePreview();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not share screen.');
        } finally {
            setPicking(false);
        }
    };

    return (
        <span className={cn('inline-flex flex-col items-center', className)}>
            <Button
                size="icon"
                variant={sharing ? 'secondary' : 'outline'}
                onClick={() => void handle()}
                disabled={picking || !canShare}
                aria-label={sharing ? 'Stop sharing' : 'Share screen'}
                title={sharing ? 'Stop sharing' : 'Share screen (preview first)'}
                className={cn(sharing && 'text-amber-300')}
            >
                {picking ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : sharing ? (
                    <MonitorOff className="h-5 w-5" />
                ) : (
                    <Monitor className="h-5 w-5" />
                )}
            </Button>
            {error && (
                <span className="mt-1 text-[11px] text-status-error max-w-[140px] text-center">
                    {error}
                </span>
            )}
        </span>
    );
}

/**
 * The preview modal: "this is exactly what everyone will see."
 * Go Live publishes to peers; Cancel discards the capture.
 * Renders itself whenever a preview is held — no props needed.
 */
export function ScreenSharePreviewModal() {
    const [preview, setPreview] = useState<MediaStream | null>(null);
    const [goingLive, setGoingLive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const svc = getShareService();
        if (!svc) return;
        const off = svc.on(
            'screen-share-preview',
            (stream: MediaStream | null) => {
                setPreview(stream);
                setError(null);
                setGoingLive(false);
            }
        );
        return () => {
            off();
        };
    }, []);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (preview) {
            v.srcObject = preview;
            void v.play().catch(() => {});
        } else {
            v.srcObject = null;
        }
    }, [preview]);

    if (!preview) return null;

    const goLive = async () => {
        const svc = getShareService();
        if (!svc) return;
        setGoingLive(true);
        setError(null);
        try {
            await svc.publishScreenSharePreview();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not go live.');
            setGoingLive(false);
        }
    };
    const cancel = () => getShareService()?.cancelScreenSharePreview();

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
            <Card className="w-full max-w-3xl p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
                    <h2 className="font-semibold text-text-primary flex items-center gap-2">
                        <Monitor className="h-5 w-5 text-amber-300" />
                        Preview — this is what everyone will see
                    </h2>
                    <button
                        type="button"
                        onClick={cancel}
                        className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary"
                        aria-label="Cancel screen share"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="relative bg-black aspect-video">
                    <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full"
                        muted
                        playsInline
                    />
                </div>
                {error && (
                    <p className="px-4 pt-3 text-sm text-status-error flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {error}
                    </p>
                )}
                <div className="flex gap-3 px-4 py-4">
                    <Button
                        variant="outline"
                        onClick={cancel}
                        disabled={goingLive}
                        fullWidth
                    >
                        Cancel
                    </Button>
                    <Button onClick={() => void goLive()} disabled={goingLive} fullWidth>
                        {goingLive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            'Go Live'
                        )}
                    </Button>
                </div>
                <p className="px-4 pb-4 text-xs text-text-tertiary">
                    Nothing is shared until you press Go Live. Close private
                    tabs first — the preview is your last check.
                </p>
            </Card>
        </div>
    );
}

/* ---------------- (c) Host pause / resume ---------------- */

/**
 * Compact host bar while a share is live: Pause/Resume (no reconnect
 * needed) + Stop. Mount next to the share button.
 */
export function ScreenShareHostControls({ className }: { className?: string }) {
    const vs = useVoiceServiceState();
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        const svc = getShareService();
        if (!svc) return;
        setPaused(svc.getScreenSharePaused());
        const off = svc.on(
            'screen-share-paused',
            (deviceId: string | null, p: boolean) => {
                if (deviceId == null) setPaused(p);
            }
        );
        return () => {
            off();
        };
    }, []);

    if (!vs?.isSharingScreen) return null;

    const toggle = () => getShareService()?.setScreenSharePaused(!paused);
    const stop = () => {
        void getShareService()
            ?.stopScreenShare()
            .catch(() => {});
    };

    return (
        <div
            className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30',
                className
            )}
        >
            <span className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                <span
                    className={cn(
                        'h-2 w-2 rounded-full',
                        paused ? 'bg-amber-400' : 'bg-red-500 animate-pulse'
                    )}
                />
                {paused ? 'Share paused' : 'Sharing screen'}
            </span>
            <button
                type="button"
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-200 transition-colors"
                title={paused ? 'Resume sharing' : 'Pause sharing (keeps the connection)'}
                aria-label={paused ? 'Resume screen share' : 'Pause screen share'}
            >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
                type="button"
                onClick={stop}
                className="p-1.5 rounded-lg hover:bg-status-error/20 text-status-error transition-colors"
                title="Stop sharing"
                aria-label="Stop screen share"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

/* ---------------- (b) Viewer Picture-in-Picture ---------------- */

/**
 * Pop any shared-screen MediaStream into a floating PiP window.
 * Returns an error message (shown to the viewer), or null on success.
 */
export async function popScreenIntoPiP(stream: MediaStream): Promise<string | null> {
    try {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            return 'Picture-in-picture is not available here.';
        }
        const pipEnabled = (
            document as Document & { pictureInPictureEnabled?: boolean }
        ).pictureInPictureEnabled;
        if (pipEnabled === false) {
            return 'Picture-in-picture is not supported on this browser.';
        }
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        // Kept in the DOM (invisible) so Safari-class browsers accept PiP.
        video.style.cssText =
            'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
        document.body.appendChild(video);
        try {
            await video.play();
            await video.requestPictureInPicture();
        } catch (e) {
            video.remove();
            throw e;
        }
        video.addEventListener('leavepictureinpicture', () => video.remove(), {
            once: true,
        });
        return null;
    } catch (e) {
        return e instanceof Error
            ? e.message
            : 'Could not open picture-in-picture.';
    }
}

/**
 * Viewer button for a remote shared screen: pops it into PiP.
 * Mount on each remote screen tile (voice-panel RemoteTile) with the
 * tile's screen stream. Shows a plain fallback message when PiP fails.
 */
export function RemoteScreenPiPButton({
    stream,
    className,
}: {
    stream: MediaStream | null;
    className?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!stream) return null;

    const handle = async () => {
        setBusy(true);
        setError(null);
        const err = await popScreenIntoPiP(stream);
        setBusy(false);
        if (err) setError(err);
    };

    return (
        <span className={cn('inline-flex flex-col items-center', className)}>
            <button
                type="button"
                onClick={() => void handle()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-medium transition-colors disabled:opacity-60"
                title="Pop the shared screen into a floating window"
            >
                {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Monitor className="h-3.5 w-3.5" />
                )}
                Pop out
            </button>
            {error && (
                <span className="mt-1 text-[11px] text-status-error max-w-[180px] text-center">
                    {error}
                </span>
            )}
        </span>
    );
}

/**
 * Whether a remote sharer currently has their screen paused (host used
 * pause, not stop). Pair with a "Paused" badge on the remote screen tile.
 */
export function useRemoteScreenPaused(deviceId: string): boolean {
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        const svc = getShareService();
        if (!svc) return;
        const off = svc.on(
            'screen-share-paused',
            (from: string | null, p: boolean) => {
                if (from === deviceId) setPaused(p);
            }
        );
        return () => {
            off();
        };
    }, [deviceId]);
    return paused;
}
