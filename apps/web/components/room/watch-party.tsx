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
    const [url, setUrl] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (!startOpen) return null;

    const close = () => {
        setStartOpen(false);
        setError(null);
        setUrl('');
        setFile(null);
    };

    const handleYouTube = async () => {
        setBusy(true);
        setError(null);
        const err = await startYouTube(url);
        setBusy(false);
        if (err) setError(err);
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
                            {t === 'youtube' ? 'YouTube link' : 'My own file'}
                        </button>
                    ))}
                </div>

                {tab === 'youtube' ? (
                    <div className="space-y-3">
                        <Input
                            placeholder="Paste a YouTube link…"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleYouTube();
                            }}
                        />
                        <p className="text-xs text-text-tertiary">
                            Everyone streams it from YouTube on their own
                            device — in perfect sync, at zero cost to us.
                        </p>
                        <Button
                            onClick={handleYouTube}
                            disabled={busy || !url.trim()}
                            fullWidth
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Start watching'
                            )}
                        </Button>
                    </div>
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
