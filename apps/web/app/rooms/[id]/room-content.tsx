'use client';

/**
 * Room page — Convex edition.
 *
 * Loads the room via api.rooms.get, joins presence + chat through the
 * Convex hooks. No login wall: guests join with their stored nickname.
 *
 * NOTE (Phase 2): voice is not wired yet. The page shows a placeholder
 * where the P2P mesh will plug in; everything else (presence, chat)
 * already works on Convex.
 */
import { useState, useMemo, memo, useCallback } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import {
    Button,
    Avatar,
    LanguageBadge,
    Card,
    Input,
} from '@/components/ui';
import {
    Mic,
    Users,
    ChevronLeft,
    Loader2,
    AlertCircle,
    Send,
    MessageCircle,
} from '@/components/ui/icons';
import {
    useConvexRoom,
    useSendChat,
    useReactToMessage,
    type RoomMediaState,
} from '@/lib/hooks/use-convex-room';
import { VoiceProvider } from '@/lib/services/p2p';
import { VoicePanel, type PresenceParticipant } from './voice-panel';
import { ParticipantMenu } from '@/components/room/participant-menu';
import { RoomSettings } from '@/components/room/room-settings';
import {
    WatchPartyProvider,
    WatchPartyHeaderButton,
    WatchPartyStartModal,
    WatchPartyOverlay,
} from '@/components/room/watch-party';
import { getBlockedDevices } from '@/lib/blocked';
import { Hand, Smile, Reply } from '@/components/ui/icons';

interface RoomContentProps {
    roomId: string;
}

const DEFAULT_MEDIA_STATE: RoomMediaState = {
    muted: true,
    handRaised: false,
    videoOn: false,
    sharingScreen: false,
    watchReady: false,
};

export function RoomContent({ roomId }: RoomContentProps) {
    // Room data straight from Convex. `undefined` = loading, `null` = gone.
    const room = useQuery(api.rooms.get, { roomId: roomId as any });

    // Live media state (mic/camera/screen) flows up from the VoicePanel
    // into the presence heartbeat.
    const [mediaState, setMediaState] = useState<RoomMediaState>(DEFAULT_MEDIA_STATE);

    // Merge, don't replace: VoicePanel reports mic/camera/screen while the
    // Watch Party reports watchReady independently — neither may clobber
    // the other on the way to the heartbeat.
    const handleMediaStateChange = useCallback((s: RoomMediaState) => {
        setMediaState((prev) => ({ ...prev, ...s }));
    }, []);
    const handleWatchReadyChange = useCallback((ready: boolean) => {
        setMediaState((prev) =>
            prev.watchReady === ready ? prev : { ...prev, watchReady: ready }
        );
    }, []);

    // Presence + chat via Convex (joins automatically on mount).
    const { participants, messages, deviceId, joinError, wasRemoved } = useConvexRoom(roomId, mediaState);
    const sendChat = useSendChat(roomId);
    const reactToMessage = useReactToMessage(roomId);
    const [chatText, setChatText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [replyTarget, setReplyTarget] = useState<{
        messageId: string;
        nickname: string;
        text: string;
    } | null>(null);
    const [menuNotice, setMenuNotice] = useState<string | null>(null);

    const participantList = useMemo(
        () => (participants ?? []) as PresenceParticipant[],
        [participants]
    );
    const myParticipant = useMemo(
        () => participantList.find((p) => p.deviceId === deviceId),
        [participantList, deviceId]
    );
    const iAmOwner = myParticipant?.isOwner === true;
    const ownerIsLive = useMemo(
        () => participantList.some((p) => p.isOwner),
        [participantList]
    );
    // Hide chat from devices this user blocked (personal block list).
    const blockedDevices = useMemo(() => new Set(getBlockedDevices()), [messages]);
    const messageList = useMemo(
        () =>
            ((messages ?? []) as Array<{
                _id: string;
                deviceId: string;
                nickname: string;
                text: string;
                createdAt: number;
                reactions?: Array<{ deviceId: string; emoji: string }>;
                replyTo?: { messageId: string; nickname: string; text: string };
            }>).filter((m) => !blockedDevices.has(m.deviceId)),
        [messages, blockedDevices]
    );

    const handleSendChat = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = chatText.trim();
        if (!text || isSending) return;
        setIsSending(true);
        try {
            await sendChat(text, replyTarget ?? undefined);
            setChatText('');
            setReplyTarget(null);
        } catch (err) {
            console.error('[room] chat send failed', err);
        } finally {
            setIsSending(false);
        }
    };

    if (room === undefined) {
        return <LoadingState />;
    }

    if (room === null) {
        return (
            <ErrorState
                title="Room not found"
                description="This room doesn't exist or has been closed."
            />
        );
    }

    if (joinError) {
        return (
            <ErrorState
                title="Couldn't join"
                description={joinError}
            />
        );
    }

    if (wasRemoved) {
        return (
            <ErrorState
                title="Removed from room"
                description="The host removed you from this room."
            />
        );
    }

    return (
        <VoiceProvider>
        <WatchPartyProvider
            roomId={roomId}
            deviceId={deviceId}
            iAmOwner={iAmOwner}
            ownerIsLive={ownerIsLive}
            onWatchReadyChange={handleWatchReadyChange}
        >
        <div className="flex flex-col h-screen bg-background-primary">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-surface-border bg-background-secondary/50">
                <div className="flex items-center gap-3 min-w-0">
                    <Link
                        href="/"
                        className="p-2 -ml-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors shrink-0"
                        aria-label="Back to rooms"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="font-semibold text-text-primary truncate">{room.name}</h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            {room.language && (
                                <LanguageBadge language={room.language} size="sm" />
                            )}
                            <span className="flex items-center gap-1 text-xs text-text-tertiary">
                                <Users className="h-3.5 w-3.5" />
                                {room.participantCount ?? 0}/{room.maxParticipants}
                            </span>
                            {room.locked && (
                                <span className="text-xs text-amber-400 font-medium">· Private</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <WatchPartyHeaderButton />
                    {iAmOwner && (
                        <RoomSettings
                            roomId={roomId}
                            deviceId={deviceId}
                            roomName={room.name}
                            locked={room.locked === true}
                        />
                    )}
                </div>
            </header>

            {room.topic && (
                <div className="px-4 py-2 border-b border-surface-borderSubtle bg-background-secondary/30">
                    <p className="text-sm text-text-secondary truncate">{room.topic}</p>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* Left: people + voice placeholder */}
                <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                    {/* People in the room */}
                    <Card>
                        <div className="flex items-center gap-2 mb-3">
                            <Users className="h-4 w-4 text-primary-400" />
                            <h2 className="text-sm font-medium text-text-primary">
                                In this room ({participantList.length})
                            </h2>
                        </div>
                        {participantList.length === 0 ? (
                            <p className="text-sm text-text-tertiary">Joining…</p>
                        ) : (
                            <div className="flex flex-wrap gap-3">
                                {participantList.map((p) => (
                                    <ParticipantMenu
                                        key={p.deviceId}
                                        roomId={roomId}
                                        deviceId={deviceId}
                                        targetDeviceId={p.deviceId}
                                        targetNickname={p.nickname}
                                        targetHandRaised={p.handRaised}
                                        iAmOwner={iAmOwner && p.deviceId !== deviceId}
                                        onAction={(msg) => setMenuNotice(msg)}
                                    >
                                        <button
                                            type="button"
                                            className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-hover transition-colors"
                                            title="More actions"
                                        >
                                            <Avatar
                                                alt={p.nickname}
                                                fallback={p.nickname}
                                                size="sm"
                                            />
                                            <span className="text-sm text-text-secondary max-w-[120px] truncate">
                                                {p.nickname}
                                                {p.isOwner && (
                                                    <span className="text-primary-400"> · host</span>
                                                )}
                                                {p.handRaised && (
                                                    <Hand className="inline h-3.5 w-3.5 ml-1 text-amber-400" />
                                                )}
                                            </span>
                                        </button>
                                    </ParticipantMenu>
                                ))}
                            </div>
                        )}
                        {menuNotice && (
                            <p className="text-xs text-text-tertiary mt-2">{menuNotice}</p>
                        )}
                    </Card>

                    {/* Voice / video (P2P mesh) */}
                    <VoicePanel
                        roomId={roomId}
                        roomMode={(room.mode ?? 'voice') as 'voice' | 'stage' | 'private'}
                        participants={participantList}
                        deviceId={deviceId}
                        onMediaStateChange={handleMediaStateChange}
                    />
                </div>

                {/* Right: chat */}
                <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-surface-border bg-background-secondary/30 flex flex-col min-h-[280px]">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-borderSubtle">
                        <MessageCircle className="h-4 w-4 text-primary-400" />
                        <h2 className="text-sm font-medium text-text-primary">Chat</h2>
                    </div>
                    <ChatPanel
                        messages={messageList}
                        isLoading={messages === undefined}
                        myDeviceId={deviceId}
                        myNickname={myParticipant?.nickname ?? 'Guest'}
                        onReact={(messageId, emoji) =>
                            reactToMessage(messageId, emoji).catch((e) =>
                                console.error('[room] react failed', e)
                            )
                        }
                        onReply={(m) =>
                            setReplyTarget({
                                messageId: m._id,
                                nickname: m.nickname,
                                text: m.text,
                            })
                        }
                    />
                    <form onSubmit={handleSendChat} className="p-3 border-t border-surface-borderSubtle">
                        {replyTarget && (
                            <div className="flex items-center justify-between gap-2 mb-2 px-2 py-1.5 rounded-lg bg-surface-default text-xs">
                                <span className="truncate text-text-secondary">
                                    <Reply className="inline h-3 w-3 mr-1" />
                                    Replying to <span className="font-medium text-primary-400">{replyTarget.nickname}</span>
                                    : {replyTarget.text.slice(0, 60)}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setReplyTarget(null)}
                                    className="text-text-tertiary hover:text-text-primary shrink-0"
                                    aria-label="Cancel reply"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Input
                                placeholder="Say something..."
                                value={chatText}
                                onChange={(e) => setChatText(e.target.value)}
                                maxLength={500}
                                className="flex-1"
                            />
                            <Button
                                type="submit"
                                size="icon"
                                disabled={!chatText.trim() || isSending}
                                aria-label="Send message"
                            >
                                {isSending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Send className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
        <WatchPartyStartModal />
        <WatchPartyOverlay />
        </WatchPartyProvider>
        </VoiceProvider>
    );
}

type ChatMessage = {
    _id: string;
    deviceId: string;
    nickname: string;
    text: string;
    createdAt: number;
    reactions?: Array<{ deviceId: string; emoji: string }>;
    replyTo?: { messageId: string; nickname: string; text: string };
};

const REACTION_EMOJIS = ['❤️', '👍', '😂', '🎉', '👏'];

/** Highlight @mentions of me (or anyone) in message text. */
function renderWithMentions(text: string, myNickname: string) {
    const parts = text.split(/(@[\w.-]{1,30})/g);
    return parts.map((part, i) => {
        if (!part.startsWith('@')) return <span key={i}>{part}</span>;
        const mentioned = part.slice(1).toLowerCase();
        const isMe = mentioned === myNickname.toLowerCase();
        return (
            <span
                key={i}
                className={cn(
                    'font-medium rounded px-0.5',
                    isMe
                        ? 'bg-primary-500/25 text-primary-300'
                        : 'text-primary-400'
                )}
            >
                {part}
            </span>
        );
    });
}

function ChatPanel({
    messages,
    isLoading,
    myDeviceId,
    myNickname,
    onReact,
    onReply,
}: {
    messages: ChatMessage[];
    isLoading: boolean;
    myDeviceId: string;
    myNickname: string;
    onReact: (messageId: string, emoji: string) => void;
    onReply: (m: ChatMessage) => void;
}) {
    const [pickerFor, setPickerFor] = useState<string | null>(null);

    // Group reactions by emoji with counts + whether I reacted.
    const grouped = (m: ChatMessage) => {
        const map = new Map<string, { count: number; mine: boolean }>();
        for (const r of m.reactions ?? []) {
            const e = map.get(r.emoji) ?? { count: 0, mine: false };
            e.count += 1;
            if (r.deviceId === myDeviceId) e.mine = true;
            map.set(r.emoji, e);
        }
        return [...map.entries()];
    };

    return (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {isLoading ? (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
                </div>
            ) : messages.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">
                    No messages yet — be the first to say hi!
                </p>
            ) : (
                messages.map((m) => (
                    <div key={m._id} className="text-sm group/msg">
                        <div className="flex items-baseline gap-1.5">
                            <span className="font-medium text-primary-400">{m.nickname}</span>
                            <span className="ml-auto flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                <button
                                    type="button"
                                    className="p-1 rounded hover:bg-surface-hover text-text-tertiary"
                                    title="React"
                                    onClick={() =>
                                        setPickerFor(pickerFor === m._id ? null : m._id)
                                    }
                                >
                                    <Smile className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    className="p-1 rounded hover:bg-surface-hover text-text-tertiary"
                                    title="Reply"
                                    onClick={() => onReply(m)}
                                >
                                    <Reply className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        </div>
                        {m.replyTo && (
                            <div className="mt-1 pl-2 border-l-2 border-surface-border text-xs text-text-tertiary">
                                <span className="font-medium">{m.replyTo.nickname}</span>
                                : {m.replyTo.text}
                            </div>
                        )}
                        <p className="text-text-secondary break-words">
                            {renderWithMentions(m.text, myNickname)}
                        </p>
                        {pickerFor === m._id && (
                            <div className="flex gap-1 mt-1">
                                {REACTION_EMOJIS.map((emoji) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className="text-lg hover:scale-125 transition-transform"
                                        onClick={() => {
                                            onReact(m._id, emoji);
                                            setPickerFor(null);
                                        }}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}
                        {grouped(m).length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                                {grouped(m).map(([emoji, { count, mine }]) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => onReact(m._id, emoji)}
                                        className={cn(
                                            'text-xs px-1.5 py-0.5 rounded-full border',
                                            mine
                                                ? 'border-primary-400 bg-primary-500/15'
                                                : 'border-surface-border bg-surface-default'
                                        )}
                                        title={mine ? 'Remove reaction' : 'React'}
                                    >
                                        {emoji} {count}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );
}

/**
 * Loading state component
 */
const LoadingState = memo(function LoadingState() {
    return (
        <div className="flex flex-col h-screen bg-background-primary">
            <header className="flex items-center justify-between px-4 py-3 border-b border-surface-border bg-background-secondary/50">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-default animate-pulse" />
                    <div>
                        <div className="h-5 w-32 bg-surface-default rounded animate-pulse" />
                        <div className="h-4 w-20 bg-surface-default rounded mt-1 animate-pulse" />
                    </div>
                </div>
            </header>
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
                    <p className="text-text-secondary">Loading room...</p>
                </div>
            </div>
        </div>
    );
});

/**
 * Error state component
 */
const ErrorState = memo(function ErrorState({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-col h-screen bg-background-primary">
            <header className="flex items-center px-4 py-3 border-b border-surface-border bg-background-secondary/50">
                <Link
                    href="/"
                    className="p-2 -ml-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
                >
                    <ChevronLeft className="h-5 w-5" />
                </Link>
            </header>
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="flex flex-col items-center gap-4 max-w-md text-center">
                    <div className="w-16 h-16 rounded-full bg-status-error/20 flex items-center justify-center">
                        <AlertCircle className="h-8 w-8 text-status-error" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
                        <p className="text-text-secondary mt-1">{description}</p>
                    </div>
                    <Button variant="ghost" asChild>
                        <Link href="/">Back to Rooms</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
});

LoadingState.displayName = 'LoadingState';
ErrorState.displayName = 'ErrorState';
