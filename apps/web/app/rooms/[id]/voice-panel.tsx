'use client';

/**
 * VoicePanel — Phase 3 room media UI.
 *
 * Wires the Phase 2 P2P mesh into the room page:
 *  - Join/leave, mute, camera, screen share controls
 *  - Video tiles for publishers (camera + screen share), audience row for listeners
 *  - Stage mode: host promotes/demotes publishers (max 4, enforced server-side)
 *
 * Must be rendered inside <VoiceProvider>.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import { Button, Avatar, Card } from '@/components/ui';
import {
    Mic,
    MicOff,
    Video,
    VideoOff,
    PhoneOff,
    UserPlus,
    UserMinus,
    Loader2,
    AlertCircle,
    Hand,
} from '@/components/ui/icons';
import { useVoice, type RemoteParticipant } from '@/lib/services/p2p';
import type { RoomMediaState } from '@/lib/hooks/use-convex-room';
import { ParticipantMenu } from '@/components/room/participant-menu';
import TierBadge from '@/components/engagement/TierBadge';
import { useStreak } from '@/components/engagement/useStreak';
import {
    useCameraFilter,
    cameraFilterCss,
    CAMERA_FILTERS,
} from '@/components/room/magic-camera';
import {
    ScreenShareShareButton,
    ScreenShareHostControls,
    RemoteScreenPiPButton,
    useRemoteScreenPaused,
} from '@/components/room/watch-party';

export interface PresenceParticipant {
    deviceId: string;
    nickname: string;
    isOwner: boolean;
    role: 'publisher' | 'listener';
    muted: boolean;
    handRaised: boolean;
    videoOn: boolean;
    sharingScreen: boolean;
}

interface VoicePanelProps {
    roomId: string;
    roomMode: 'voice' | 'stage' | 'private';
    participants: PresenceParticipant[];
    deviceId: string;
    onMediaStateChange: (s: RoomMediaState) => void;
}

/** Renders a MediaStream into a <video> element. `filter` is a CSS filter
 *  string applied to the video element only (used for local camera preview). */
function VideoTile({
    stream,
    muted,
    label,
    className,
    filter,
}: {
    stream: MediaStream;
    muted?: boolean;
    label?: string;
    className?: string;
    filter?: string;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el && el.srcObject !== stream) {
            el.srcObject = stream;
        }
    }, [stream]);
    return (
        <div className={cn('relative rounded-xl overflow-hidden bg-surface-default', className)}>
            <video
                ref={ref}
                autoPlay
                playsInline
                muted={muted}
                className="w-full h-full object-cover"
                style={filter ? { filter } : undefined}
            />
            {label && (
                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[11px] text-white truncate max-w-[90%]">
                    {label}
                </div>
            )}
        </div>
    );
}

/** Role badge overlay for tiles: "⭐ Owner" for the host, "Guest" + tier for everyone else. */
function RoleBadge({ isOwner, streak }: { isOwner: boolean; streak: number }) {
    return (
        <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 pointer-events-none">
            {isOwner ? (
                <span className="rounded-full bg-amber-500/95 px-2 py-0.5 text-[11px] font-semibold text-black shadow">
                    ⭐ Owner
                </span>
            ) : (
                <>
                    <span className="rounded-full border border-amber-500/30 bg-black/60 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                        Guest
                    </span>
                    <TierBadge streak={streak} size="sm" />
                </>
            )}
        </span>
    );
}

function useTrackStream(track: MediaStreamTrack | null): MediaStream | null {
    return useMemo(() => (track ? new MediaStream([track]) : null), [track]);
}

/** Remote participant tile: video / screen-share / avatar, memoized streams.
 *  `fill` renders it edge-to-edge inside a relative hero container (1-on-1). */
function RemoteTile({
    participant,
    mesh,
    roomMode,
    roomId,
    myDeviceId,
    iAmOwner,
    showAdmin,
    acting,
    onRoleChange,
    onAction,
    fill,
}: {
    participant: PresenceParticipant;
    mesh: RemoteParticipant | undefined;
    roomMode: 'voice' | 'stage' | 'private';
    roomId: string;
    myDeviceId: string;
    iAmOwner: boolean;
    showAdmin: boolean;
    acting: boolean;
    onRoleChange: (deviceId: string, role: 'publisher' | 'listener') => void;
    onAction: (msg: string) => void;
    fill?: boolean;
}) {
    const videoStream = useTrackStream(mesh?.videoTrack ?? null);
    const screenStream = useTrackStream(mesh?.screenTrack ?? null);
    const speaking = mesh?.isSpeaking ?? false;
    const screenPaused = useRemoteScreenPaused(participant.deviceId);
    const { streak } = useStreak(participant.deviceId);
    const label = (extra?: string) =>
        extra ? `${participant.nickname} · ${extra}` : participant.nickname;

    const tileClass = fill ? 'w-full h-full' : 'aspect-video min-h-[220px] md:min-h-[280px]';
    const visual = screenStream ? (
        <VideoTile
            stream={screenStream}
            label={label('sharing screen')}
            className={tileClass}
        />
    ) : videoStream ? (
        <VideoTile
            stream={videoStream}
            label={label(speaking ? 'speaking' : undefined)}
            className={tileClass}
        />
    ) : (
        <div className={cn(tileClass, 'rounded-xl bg-surface-default flex flex-col items-center justify-center gap-1.5 relative cursor-pointer hover:ring-1 hover:ring-surface-border transition-shadow')}>
            <Avatar alt={participant.nickname} fallback={participant.nickname} size={fill ? '3xl' : 'md'} />
            <span className={cn('text-text-secondary max-w-[90%] truncate', fill ? 'text-base' : 'text-xs')}>
                {participant.nickname}
                {participant.isOwner && ' · host'}
                {participant.role === 'publisher' && roomMode === 'stage' && ' · on stage'}
            </span>
            {speaking && (
                <span className="absolute inset-0 rounded-xl ring-2 ring-voice-speaking shadow-glow pointer-events-none" />
            )}
        </div>
    );

    return (
        <div className={cn(fill ? 'absolute inset-0' : 'relative', !fill && screenStream && 'col-span-full')}>
            <ParticipantMenu
                roomId={roomId}
                deviceId={myDeviceId}
                targetDeviceId={participant.deviceId}
                targetNickname={participant.nickname}
                targetHandRaised={participant.handRaised}
                iAmOwner={iAmOwner}
                onAction={onAction}
            >
                <div className={fill ? 'w-full h-full' : undefined}>{visual}</div>
            </ParticipantMenu>
            {/* Role badge: ⭐ Owner for host, Guest + tier for everyone else */}
            <RoleBadge isOwner={participant.isOwner} streak={streak} />
            {/* Raised-hand badge */}
            {participant.handRaised && (
                <span
                    className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-black shadow pointer-events-none"
                    title={`${participant.nickname} raised their hand`}
                >
                    <Hand className="h-4 w-4" />
                </span>
            )}
            {/* Screen-share: paused badge + viewer PiP */}
            {screenStream && (
                <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
                    {screenPaused && (
                        <span className="px-2 py-0.5 rounded-full bg-black/70 text-amber-300 text-[11px] font-medium border border-amber-500/40">
                            Paused
                        </span>
                    )}
                    <RemoteScreenPiPButton stream={screenStream} />
                </div>
            )}
            {showAdmin && !fill && (
                <div className="mt-1.5 flex justify-center">
                    {participant.role === 'listener' ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={acting}
                            onClick={() => onRoleChange(participant.deviceId, 'publisher')}
                        >
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            On stage
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={acting}
                            onClick={() => onRoleChange(participant.deviceId, 'listener')}
                        >
                            <UserMinus className="h-3.5 w-3.5 mr-1" />
                            Audience
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

export function VoicePanel({ roomId, roomMode, participants, deviceId, onMediaStateChange }: VoicePanelProps) {
    const voice = useVoice();
    const {
        isInitialized,
        isConnecting,
        isConnected,
        isMuted,
        isSpeaking,
        isVideoOn,
        isSharingScreen,
        isSharingScreenAudio,
        isPublishing,
        localVideoTrack,
        localScreenTrack,
        remoteParticipants,
        error,
        joinRoom,
        leaveRoom,
        toggleMute,
        setVideoEnabled,
        setPublishing,
    } = voice;

    const [joinError, setJoinError] = useState<string | null>(null);
    const [acting, setActing] = useState(false);
    const [handRaised, setHandRaised] = useState(false);
    const setRole = useMutation(api.presence.setRole);

    const me = useMemo(
        () => participants.find((p) => p.deviceId === deviceId),
        [participants, deviceId]
    );
    const iAmOwner = me?.isOwner === true;
    const myRole = me?.role ?? 'publisher';
    const { streak: myStreak } = useStreak(deviceId);
    // Magic Camera: local-only preview filter for the self tile.
    const { filter: cameraFilter } = useCameraFilter();
    const selfFilterCss = cameraFilterCss(cameraFilter);

    const remoteById = useMemo(() => {
        const m = new Map<string, RemoteParticipant>();
        for (const r of remoteParticipants) m.set(r.id, r);
        return m;
    }, [remoteParticipants]);

    const publishers = useMemo(
        () => participants.filter((p) => p.role === 'publisher'),
        [participants]
    );
    const listeners = useMemo(
        () => participants.filter((p) => p.role === 'listener'),
        [participants]
    );

    const localVideoStream = useTrackStream(localVideoTrack);
    const localScreenStream = useTrackStream(localScreenTrack);

    // Ref mirror for the role-sync effect (avoids stale closure on isVideoOn).
    const isVideoOnRef = useRef(isVideoOn);
    isVideoOnRef.current = isVideoOn;

    // Report live media state up for the presence heartbeat.
    useEffect(() => {
        onMediaStateChange({
            muted: isConnected ? isMuted : true,
            handRaised,
            videoOn: isVideoOn,
            sharingScreen: isSharingScreen,
        });
    }, [isConnected, isMuted, handRaised, isVideoOn, isSharingScreen, onMediaStateChange]);

    // Stage mode: follow Convex role changes (promote/demote by the host).
    useEffect(() => {
        if (!isConnected || !me) return;
        const wantPublish = me.role === 'publisher';
        const wantVideo = roomMode !== 'voice' && wantPublish;
        let cancelled = false;
        (async () => {
            try {
                await setPublishing(wantPublish);
                if (!cancelled && wantPublish && wantVideo && !isVideoOnRef.current) {
                    await setVideoEnabled(true).catch(() => {});
                }
            } catch {
                /* mic errors surface via voice.error */
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me?.role, isConnected, roomMode]);

    const handleJoin = async () => {
        setJoinError(null);
        try {
            const publish = myRole === 'publisher';
            await joinRoom(roomId, {
                publish,
                video: roomMode !== 'voice' && publish,
            });
        } catch (err) {
            setJoinError(err instanceof Error ? err.message : 'Could not join voice.');
        }
    };

    const handleRoleChange = async (targetDeviceId: string, role: 'publisher' | 'listener') => {
        setActing(true);
        try {
            await setRole({
                roomId: roomId as any,
                actorDeviceId: deviceId,
                targetDeviceId,
                role,
            });
        } catch (err) {
            setJoinError(err instanceof Error ? err.message : 'Role change failed.');
        } finally {
            setActing(false);
        }
    };

    const tileLabel = (nickname: string, extra?: string) =>
        extra ? `${nickname} · ${extra}` : nickname;

    const others = participants.filter((p) => p.deviceId !== deviceId);
    // 1-on-1 video call: remote fills the stage, self floats as PiP.
    const isOneOnOne = roomMode === 'private' && others.length >= 1;
    const heroPeer = isOneOnOne ? others[0] : undefined;

    const selfTile = (pip: boolean) =>
        // Magic Camera filter applies to the self tile only (local preview —
        // peers see the raw feed).
        localVideoStream ? (
            <div className={cn('relative', pip ? 'w-full h-full' : undefined)}>
                <VideoTile
                    stream={localVideoStream}
                    muted
                    label={tileLabel('You', isSpeaking ? 'speaking' : isMuted ? 'muted' : undefined)}
                    className={pip ? 'w-full h-full' : 'aspect-video min-h-[220px] md:min-h-[280px]'}
                    filter={selfFilterCss || undefined}
                />
                <RoleBadge isOwner={iAmOwner} streak={myStreak} />
                {selfFilterCss && (
                    <span className="absolute bottom-1.5 right-1.5 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-amber-200 border border-amber-500/30 pointer-events-none">
                        {CAMERA_FILTERS[cameraFilter].label} · preview only
                    </span>
                )}
            </div>
        ) : (
            <div className={cn(
                'rounded-xl bg-surface-default flex flex-col items-center justify-center gap-1.5 relative overflow-hidden',
                pip ? 'w-full h-full' : 'aspect-video min-h-[220px] md:min-h-[280px]'
            )}>
                <RoleBadge isOwner={iAmOwner} streak={myStreak} />
                <Avatar alt="You" fallback="You" size={pip ? 'lg' : 'md'} />
                <span className={cn('text-text-secondary', pip ? 'text-[11px]' : 'text-xs')}>
                    You {isSpeaking ? '· speaking' : isMuted ? '· muted' : ''}
                </span>
                {isSpeaking && (
                    <span className="absolute inset-0 rounded-xl ring-2 ring-voice-speaking shadow-glow pointer-events-none" />
                )}
            </div>
        );

    return (
        <Card variant="gradient">
            {!isConnected ? (
                <div className="flex flex-col items-center text-center py-8 px-4">
                    <div className="w-14 h-14 rounded-full bg-primary-500/15 flex items-center justify-center mb-4">
                        <Mic className="h-7 w-7 text-primary-400" />
                    </div>
                    <h2 className="text-base font-semibold text-text-primary mb-1">
                        {roomMode === 'private'
                            ? 'Private video call'
                            : roomMode === 'stage'
                              ? 'Live on stage'
                              : 'Voice chat'}
                    </h2>
                    <p className="text-sm text-text-secondary max-w-sm mb-5">
                        {roomMode === 'stage' && myRole === 'listener'
                            ? 'You are in the audience. The host can bring you on stage.'
                            : 'Talk, listen, and practice together right in your browser — no downloads, no sign-up.'}
                    </p>
                    {(joinError || error) && (
                        <p className="flex items-center gap-1.5 text-sm text-status-error mb-3">
                            <AlertCircle className="h-4 w-4" />
                            {joinError ?? error?.message}
                        </p>
                    )}
                    <Button onClick={handleJoin} disabled={!isInitialized || isConnecting} size="lg">
                        {isConnecting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Joining…
                            </>
                        ) : (
                            <>
                                <Mic className="h-4 w-4 mr-2" /> Join {roomMode === 'voice' ? 'voice' : 'call'}
                            </>
                        )}
                    </Button>
                </div>
            ) : (
                <div className="p-4">
                    {/* Tiles — 1-on-1 hero for private video calls */}
                    {isOneOnOne && heroPeer ? (
                        <div className="relative min-h-[55vh] md:min-h-[68vh] rounded-2xl overflow-hidden bg-surface-default mb-4 ring-1 ring-surface-border">
                            <RemoteTile
                                key={heroPeer.deviceId}
                                participant={heroPeer}
                                mesh={remoteById.get(heroPeer.deviceId)}
                                roomMode={roomMode}
                                roomId={roomId}
                                myDeviceId={deviceId}
                                iAmOwner={iAmOwner}
                                showAdmin={false}
                                acting={acting}
                                onRoleChange={handleRoleChange}
                                onAction={(msg) => setJoinError(msg)}
                                fill
                            />
                            {/* Self PiP */}
                            <div className="absolute bottom-3 right-3 z-10 w-28 md:w-44 aspect-video rounded-xl overflow-hidden ring-1 ring-surface-border shadow-xl bg-surface-default">
                                {selfTile(true)}
                            </div>
                        </div>
                    ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 auto-rows-fr">
                        {/* Self tile */}
                        <div>
                            {selfTile(false)}
                        </div>

                        {/* Remote tiles */}
                        {others
                            .map((p) => (
                                <RemoteTile
                                    key={p.deviceId}
                                    participant={p}
                                    mesh={remoteById.get(p.deviceId)}
                                    roomMode={roomMode}
                                    roomId={roomId}
                                    myDeviceId={deviceId}
                                    iAmOwner={iAmOwner}
                                    showAdmin={roomMode === 'stage' && iAmOwner && !p.isOwner}
                                    acting={acting}
                                    onRoleChange={handleRoleChange}
                                    onAction={(msg) => setJoinError(msg)}
                                />
                            ))}
                    </div>
                    )}

                    {/* Screen share preview (self) */}
                    {localScreenStream && (
                        <div className="mb-4">
                            <VideoTile
                                stream={localScreenStream}
                                muted
                                label={isSharingScreenAudio ? 'Your screen · with audio' : 'Your screen'}
                                className="aspect-video"
                            />
                            {!isSharingScreenAudio && (
                                <p className="text-xs text-text-tertiary text-center mt-1.5">
                                    Tip: share a browser tab and tick “Share tab audio” to include sound.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Stage status */}
                    {roomMode === 'stage' && (
                        <p className="text-xs text-text-tertiary text-center mb-3">
                            On stage: {publishers.length}/4 · {listeners.length} in audience
                        </p>
                    )}
                    {!isPublishing && roomMode === 'stage' && (
                        <p className="text-xs text-text-tertiary text-center mb-3">
                            You are in the audience — listen only.
                        </p>
                    )}

                    {/* Controls */}
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                        {isPublishing && (
                            <>
                                <Button
                                    size="icon"
                                    variant={isMuted ? "danger" : "secondary"}
                                    onClick={() => toggleMute().catch(() => {})}
                                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                                >
                                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                                </Button>
                                <Button
                                    size="icon"
                                    variant={handRaised ? 'secondary' : 'outline'}
                                    onClick={() => setHandRaised((v) => !v)}
                                    aria-label={handRaised ? 'Lower hand' : 'Raise hand'}
                                    title={handRaised ? 'Lower hand' : 'Raise hand'}
                                >
                                    <Hand className="h-5 w-5" />
                                </Button>
                                {roomMode !== 'voice' && (
                                    <Button
                                        size="icon"
                                        variant={isVideoOn ? 'secondary' : 'outline'}
                                        onClick={() => setVideoEnabled(!isVideoOn).catch(() => {})}
                                        aria-label={isVideoOn ? 'Turn camera off' : 'Turn camera on'}
                                    >
                                        {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                                    </Button>
                                )}
                                <ScreenShareShareButton />
                                <ScreenShareHostControls />
                            </>
                        )}
                        <Button size="icon" variant="danger" onClick={() => leaveRoom().catch(() => {})} aria-label="Leave">
                            <PhoneOff className="h-5 w-5" />
                        </Button>
                    </div>
                    {error && (
                        <p className="flex items-center justify-center gap-1.5 text-xs text-status-error mt-3">
                            <AlertCircle className="h-3.5 w-3.5" /> {error.message}
                        </p>
                    )}
                </div>
            )}
        </Card>
    );
}
