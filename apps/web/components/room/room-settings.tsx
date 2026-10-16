'use client';

/**
 * RoomSettings — host-only moderation panel.
 *
 * - Privacy: lock/unlock the room (locked = invite-only), copy invite link.
 * - Reports queue: review user reports, quick kick/ban the reported device.
 * - Ban list: see active bans, lift them (unban).
 *
 * All enforcement is server-side (convex/moderation.ts); this is just UI.
 */
import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    Button,
    Avatar,
} from '@/components/ui';
import {
    Settings,
    Lock,
    Unlock,
    Copy,
    Check,
    Flag,
    MicOff,
    Shield,
    Smile,
} from '@/components/ui/icons';
import { cn } from '@/lib/design-system';

interface RoomSettingsProps {
    roomId: string;
    deviceId: string; // me (host)
    roomName: string;
    locked: boolean;
    welcomeMessage?: string;
}

export function RoomSettings({ roomId, deviceId, roomName, locked, welcomeMessage }: RoomSettingsProps) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [welcomeDraft, setWelcomeDraft] = useState<string | null>(null);

    const reports = useQuery(
        api.moderation.listReports,
        open ? { roomId: roomId as any, deviceId, limit: 30 } : 'skip'
    );
    const bans = useQuery(
        api.moderation.listBans,
        open ? { roomId: roomId as any, deviceId } : 'skip'
    );

    const setLocked = useMutation(api.moderation.setLocked);
    const kick = useMutation(api.moderation.kick);
    const ban = useMutation(api.moderation.siteBan);
    const unban = useMutation(api.moderation.unban);
    const setWelcome = useMutation(api.rooms.setWelcomeMessage);

    const run = async (key: string, fn: () => Promise<unknown>, doneMsg: string) => {
        setBusy(key);
        setNotice(null);
        try {
            await fn();
            setNotice(doneMsg);
        } catch (err) {
            setNotice(err instanceof Error ? err.message : 'Action failed.');
        } finally {
            setBusy(null);
        }
    };

    const inviteUrl =
        typeof window !== 'undefined'
            ? `${window.location.origin}/rooms/${roomId}`
            : '';

    const copyInvite = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setNotice('Could not copy — long-press the URL instead.');
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
                    title="Room settings & moderation"
                    aria-label="Room settings & moderation"
                >
                    <Settings className="h-5 w-5" />
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Room settings</DialogTitle>
                    <DialogDescription className="truncate">
                        {roomName} — host controls
                    </DialogDescription>
                </DialogHeader>

                {notice && (
                    <p className="text-xs text-text-secondary bg-surface-default rounded-lg px-3 py-2">
                        {notice}
                    </p>
                )}

                {/* Privacy */}
                <section className="space-y-3">
                    <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                        {locked ? (
                            <Lock className="h-4 w-4 text-amber-400" />
                        ) : (
                            <Unlock className="h-4 w-4 text-emerald-400" />
                        )}
                        Privacy {locked && <span className="text-amber-400">· Private</span>}
                    </h3>
                    <p className="text-xs text-text-tertiary">
                        {locked
                            ? 'Locked: only people with the invite link can join. Nobody new can wander in from the hallway.'
                            : 'Open: anyone can find and join this room from the hallway.'}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant={locked ? 'outline' : 'secondary'}
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                                run('lock', () =>
                                    setLocked({
                                        roomId: roomId as any,
                                        ownerDeviceId: deviceId,
                                        locked: !locked,
                                    }),
                                    locked ? 'Room unlocked — open to everyone.' : 'Room locked — invite only now.'
                                )
                            }
                        >
                            {locked ? (
                                <Unlock className="h-4 w-4 mr-1.5" />
                            ) : (
                                <Lock className="h-4 w-4 mr-1.5" />
                            )}
                            {locked ? 'Make public' : 'Make private'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={copyInvite}>
                            {copied ? (
                                <Check className="h-4 w-4 mr-1.5 text-emerald-400" />
                            ) : (
                                <Copy className="h-4 w-4 mr-1.5" />
                            )}
                            {copied ? 'Copied!' : 'Copy invite link'}
                        </Button>
                    </div>
                </section>

                <div className="border-t border-surface-borderSubtle" />

                {/* Welcome message */}
                <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                        <Smile className="h-4 w-4 text-primary-400" />
                        Welcome message
                    </h3>
                    <p className="text-xs text-text-tertiary">
                        Shown to everyone in warm style when they open the room.
                    </p>
                    <textarea
                        value={welcomeDraft ?? welcomeMessage ?? ''}
                        onChange={(e) => setWelcomeDraft(e.target.value)}
                        rows={3}
                        maxLength={500}
                        placeholder="Welcome to our room! Be kind, take turns, have fun…"
                        className="w-full rounded-lg bg-surface-default border border-surface-border px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <Button
                        size="sm"
                        disabled={busy === 'welcome'}
                        onClick={() =>
                            run(
                                'welcome',
                                () =>
                                    setWelcome({
                                        roomId: roomId as any,
                                        deviceId,
                                        message: (welcomeDraft ?? welcomeMessage ?? '').trim(),
                                    }).then(() => setWelcomeDraft(null)),
                                'Welcome message saved.'
                            )
                        }
                    >
                        {busy === 'welcome' ? 'Saving…' : 'Save welcome message'}
                    </Button>
                </section>

                <div className="border-t border-surface-borderSubtle" />

                {/* Reports */}
                <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                        <Flag className="h-4 w-4 text-status-error" />
                        Reports ({reports?.length ?? 0})
                    </h3>
                    {reports === undefined ? (
                        <p className="text-xs text-text-tertiary">Loading…</p>
                    ) : reports.length === 0 ? (
                        <p className="text-xs text-text-tertiary">
                            No reports. Quiet room — nice.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {reports.map((r: any) => (
                                <div
                                    key={r._id}
                                    className="rounded-lg bg-surface-default p-2.5 text-xs space-y-1.5"
                                >
                                    <p className="text-text-secondary">
                                        <span className="font-medium text-status-error">
                                            {r.reason}
                                        </span>
                                        {' — reported device '}
                                        <code className="text-text-tertiary">
                                            {String(r.targetDeviceId).slice(0, 8)}…
                                        </code>
                                    </p>
                                    <p className="text-text-tertiary">
                                        {new Date(r.createdAt).toLocaleString()}
                                    </p>
                                    <div className="flex gap-1.5">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                run(`kick-${r._id}`, () =>
                                                    kick({
                                                        roomId: roomId as any,
                                                        ownerDeviceId: deviceId,
                                                        targetDeviceId: r.targetDeviceId,
                                                    }),
                                                    'Participant removed.'
                                                )
                                            }
                                        >
                                            <MicOff className="h-3.5 w-3.5 mr-1" />
                                            Kick
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-status-error"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                run(`ban-${r._id}`, () =>
                                                    ban({
                                                        roomId: roomId as any,
                                                        ownerDeviceId: deviceId,
                                                        targetDeviceId: r.targetDeviceId,
                                                        reason: `Reported: ${r.reason}`,
                                                        days: 7,
                                                    }),
                                                    'Banned for 7 days.'
                                                )
                                            }
                                        >
                                            <Shield className="h-3.5 w-3.5 mr-1" />
                                            Ban 7d
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <div className="border-t border-surface-borderSubtle" />

                {/* Ban list */}
                <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-amber-400" />
                        Banned ({bans?.length ?? 0})
                    </h3>
                    {bans === undefined ? (
                        <p className="text-xs text-text-tertiary">Loading…</p>
                    ) : bans.length === 0 ? (
                        <p className="text-xs text-text-tertiary">Nobody banned.</p>
                    ) : (
                        <div className="space-y-2">
                            {bans.map((b: any) => (
                                <div
                                    key={b._id}
                                    className={cn(
                                        'flex items-center gap-2 rounded-lg bg-surface-default p-2.5 text-xs'
                                    )}
                                >
                                    <Avatar
                                        alt="banned user"
                                        fallback="?"
                                        size="sm"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-text-secondary truncate">
                                            <code>{String(b.deviceId).slice(0, 12)}…</code>
                                        </p>
                                        <p className="text-text-tertiary truncate">
                                            {b.reason} · until{' '}
                                            {new Date(b.expiresAt).toLocaleDateString()}
                                            {b.roomId === undefined && ' · site-wide'}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() =>
                                            run(`unban-${b._id}`, () =>
                                                unban({
                                                    roomId: roomId as any,
                                                    ownerDeviceId: deviceId,
                                                    targetDeviceId: b.deviceId,
                                                }),
                                                'Ban lifted.'
                                            )
                                        }
                                    >
                                        Unban
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </DialogContent>
        </Dialog>
    );
}
