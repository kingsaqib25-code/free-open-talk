'use client';

/**
 * ToolsPanel — in-room tools bottom sheet (mobile-first).
 *
 * free4talk-style tool grid, in our warm orange theme:
 *   Magic Mic · Magic Camera · IP Shield · Mod List · Block List · Kick List
 *
 * Also exports ToolsPanelButton — a gear button the room UI uses to open it.
 * Guest flows are safe: moderation queries simply return empty for non-owners.
 */
import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import {
    X,
    ChevronLeft,
    Settings,
    Mic,
    Video,
    Shield,
    Flag,
    EyeOff,
    LogOut,
    type LucideIcon,
} from '@/components/ui/icons';
import { MagicMicPanel } from './magic-mic';
import { CameraFilterPicker } from './magic-camera';
import { IPShieldPanel } from './ip-shield';
import { getBlockedDevices, unblockDevice } from '@/lib/blocked';

type SectionId =
    | 'magic-mic'
    | 'magic-camera'
    | 'ip-shield'
    | 'mod-list'
    | 'block-list'
    | 'kick-list';

const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
    { id: 'magic-mic', label: 'Magic Mic', hint: 'Fun voice changer', icon: Mic },
    { id: 'magic-camera', label: 'Magic Camera', hint: 'Fun camera filters', icon: Video },
    { id: 'ip-shield', label: 'IP Shield', hint: 'Call encryption status', icon: Shield },
    { id: 'mod-list', label: 'Mod List', hint: 'Reports & bans', icon: Flag },
    { id: 'block-list', label: 'Block List', hint: 'Devices you blocked', icon: EyeOff },
    { id: 'kick-list', label: 'Kick List', hint: 'Banned / kicked', icon: LogOut },
];

// ---------------------------------------------------------------------------
// Mod List — reports queue + ban list (same Convex moderation backend as
// RoomSettings, rendered inline). Non-owners see empty states.
// ---------------------------------------------------------------------------

function ModSection({ roomId, deviceId }: { roomId: string; deviceId: string }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const reports = useQuery(api.moderation.listReports, {
        roomId: roomId as any,
        deviceId,
        limit: 30,
    });
    const bans = useQuery(api.moderation.listBans, {
        roomId: roomId as any,
        deviceId,
    });
    const kick = useMutation(api.moderation.kick);
    const ban = useMutation(api.moderation.siteBan);
    const unban = useMutation(api.moderation.unban);

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

    return (
        <div className="space-y-4">
            {notice && (
                <p className="rounded-lg bg-surface-default px-3 py-2 text-xs text-text-secondary">
                    {notice}
                </p>
            )}
            <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                    <Flag className="h-4 w-4 text-status-error" />
                    Reports ({reports?.length ?? 0})
                </h4>
                {reports === undefined ? (
                    <p className="text-xs text-text-tertiary">Loading…</p>
                ) : reports.length === 0 ? (
                    <p className="text-xs text-text-tertiary">
                        No reports. (Only the room owner sees reports.)
                    </p>
                ) : (
                    <div className="space-y-2">
                        {reports.map((r: any) => (
                            <div
                                key={r._id}
                                className="space-y-1.5 rounded-lg bg-surface-default p-2.5 text-xs"
                            >
                                <p className="text-text-secondary">
                                    <span className="font-medium text-status-error">{r.reason}</span>
                                    {' — '}
                                    <code className="text-text-tertiary">
                                        {String(r.targetDeviceId).slice(0, 8)}…
                                    </code>
                                </p>
                                <div className="flex gap-1.5">
                                    <button
                                        type="button"
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
                                        className="rounded-lg border border-surface-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        Kick
                                    </button>
                                    <button
                                        type="button"
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
                                        className="rounded-lg border border-surface-border px-2.5 py-1.5 text-status-error hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        Ban 7d
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
            <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                    <Shield className="h-4 w-4 text-amber-400" />
                    Banned ({bans?.length ?? 0})
                </h4>
                {bans === undefined ? (
                    <p className="text-xs text-text-tertiary">Loading…</p>
                ) : bans.length === 0 ? (
                    <p className="text-xs text-text-tertiary">Nobody banned.</p>
                ) : (
                    <div className="space-y-2">
                        {bans.map((b: any) => (
                            <div
                                key={b._id}
                                className="flex items-center gap-2 rounded-lg bg-surface-default p-2.5 text-xs"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-text-secondary">
                                        <code>{String(b.deviceId).slice(0, 12)}…</code>
                                    </p>
                                    <p className="truncate text-text-tertiary">
                                        {b.reason} · until {new Date(b.expiresAt).toLocaleDateString()}
                                    </p>
                                </div>
                                <button
                                    type="button"
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
                                    className="rounded-lg border border-surface-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                                >
                                    Unban
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Block List — personal blocks (localStorage), with unblock buttons
// ---------------------------------------------------------------------------

function BlockSection() {
    const [blocked, setBlocked] = useState<string[]>(() => getBlockedDevices());
    const refresh = () => setBlocked(getBlockedDevices());
    return (
        <div className="space-y-2">
            <p className="text-xs leading-relaxed text-text-tertiary">
                Personal block list — blocked devices&apos; messages are hidden
                and their audio is muted, just for you. Stored on this device.
            </p>
            {blocked.length === 0 ? (
                <p className="text-xs text-text-tertiary">Nobody blocked.</p>
            ) : (
                <div className="space-y-2">
                    {blocked.map((d) => (
                        <div
                            key={d}
                            className="flex items-center gap-2 rounded-lg bg-surface-default p-2.5 text-xs"
                        >
                            <EyeOff className="h-4 w-4 shrink-0 text-text-tertiary" />
                            <code className="min-w-0 flex-1 truncate text-text-secondary">
                                {d.slice(0, 16)}…
                            </code>
                            <button
                                type="button"
                                onClick={() => {
                                    unblockDevice(d);
                                    refresh();
                                }}
                                className="rounded-lg border border-surface-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-hover"
                            >
                                Unblock
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Kick List — backend ban list, labeled "Banned / kicked"
// ---------------------------------------------------------------------------

function KickSection({ roomId, deviceId }: { roomId: string; deviceId: string }) {
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const bans = useQuery(api.moderation.listBans, {
        roomId: roomId as any,
        deviceId,
    });
    const unban = useMutation(api.moderation.unban);

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium text-text-primary">
                Banned / kicked ({bans?.length ?? 0})
            </h4>
            {notice && (
                <p className="rounded-lg bg-surface-default px-3 py-2 text-xs text-text-secondary">
                    {notice}
                </p>
            )}
            {bans === undefined ? (
                <p className="text-xs text-text-tertiary">Loading…</p>
            ) : bans.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                    Nobody banned or kicked from this room. (Only the room owner
                    can see and manage this list.)
                </p>
            ) : (
                <div className="space-y-2">
                    {bans.map((b: any) => (
                        <div
                            key={b._id}
                            className="flex items-center gap-2 rounded-lg bg-surface-default p-2.5 text-xs"
                        >
                            <LogOut className="h-4 w-4 shrink-0 text-status-error" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-text-secondary">
                                    <code>{String(b.deviceId).slice(0, 12)}…</code>
                                </p>
                                <p className="truncate text-text-tertiary">
                                    {b.reason} · until {new Date(b.expiresAt).toLocaleDateString()}
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={async () => {
                                    setBusy(true);
                                    setNotice(null);
                                    try {
                                        await unban({
                                            roomId: roomId as any,
                                            ownerDeviceId: deviceId,
                                            targetDeviceId: b.deviceId,
                                        });
                                        setNotice('Ban lifted.');
                                    } catch (err) {
                                        setNotice(
                                            err instanceof Error ? err.message : 'Action failed.'
                                        );
                                    } finally {
                                        setBusy(false);
                                    }
                                }}
                                className="rounded-lg border border-surface-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                            >
                                Unban
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Panel + trigger button
// ---------------------------------------------------------------------------

export function ToolsPanel({
    roomId,
    deviceId,
    open,
    onClose,
}: {
    roomId: string;
    deviceId: string;
    open: boolean;
    onClose: () => void;
}) {
    const [section, setSection] = useState<SectionId | null>(null);

    if (!open) return null;
    const active = SECTIONS.find((s) => s.id === section);

    return (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Room tools">
            <div
                className="absolute inset-0 bg-black/60"
                onClick={() => {
                    setSection(null);
                    onClose();
                }}
                aria-hidden
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-surface-border bg-background-secondary shadow-card">
                <div className="sticky top-0 flex items-center gap-2 border-b border-surface-borderSubtle bg-background-secondary/95 px-4 py-3 backdrop-blur">
                    {active && (
                        <button
                            type="button"
                            onClick={() => setSection(null)}
                            aria-label="Back to tools"
                            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-hover"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                    )}
                    <h3 className="flex-1 text-base font-semibold text-text-primary">
                        {active ? active.label : 'Room tools'}
                    </h3>
                    <button
                        type="button"
                        onClick={() => {
                            setSection(null);
                            onClose();
                        }}
                        aria-label="Close tools"
                        className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-hover"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-4">
                    {!active ? (
                        <div className="grid grid-cols-3 gap-2.5">
                            {SECTIONS.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setSection(s.id)}
                                    className={cn(
                                        'flex flex-col items-center gap-1.5 rounded-2xl border border-surface-border',
                                        'bg-surface-default px-2 py-4 transition-colors hover:bg-surface-hover',
                                        'active:scale-[0.97]'
                                    )}
                                >
                                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-500/15">
                                        <s.icon className="h-5 w-5 text-primary-400" />
                                    </span>
                                    <span className="text-xs font-medium text-text-primary">
                                        {s.label}
                                    </span>
                                    <span className="text-center text-[10px] leading-tight text-text-tertiary">
                                        {s.hint}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div>
                            {section === 'magic-mic' && <MagicMicPanel />}
                            {section === 'magic-camera' && <CameraFilterPicker />}
                            {section === 'ip-shield' && <IPShieldPanel />}
                            {section === 'mod-list' && (
                                <ModSection roomId={roomId} deviceId={deviceId} />
                            )}
                            {section === 'block-list' && <BlockSection />}
                            {section === 'kick-list' && (
                                <KickSection roomId={roomId} deviceId={deviceId} />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Gear button that opens the tools panel. */
export function ToolsPanelButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Open room tools"
            title="Room tools"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-surface-border bg-surface-default text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-95"
        >
            <Settings className="h-5 w-5" />
        </button>
    );
}
