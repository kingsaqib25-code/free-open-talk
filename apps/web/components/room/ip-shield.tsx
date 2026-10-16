'use client';

/**
 * IP Shield — honest connection-security panel.
 *
 * Says exactly what is true: voice/video is peer-to-peer WebRTC encrypted
 * with DTLS-SRTP; our server only does signaling (introducing phones) and
 * never hears audio. It does NOT claim VPN / proxy / IP-hiding powers.
 *
 * Shows live per-peer connection states from the mesh (RTCPeerConnection
 * connectionState + iceConnectionState), refreshed every 2s.
 */
import { useEffect, useReducer } from 'react';
import { Shield } from '@/components/ui/icons';
import { cn } from '@/lib/design-system';
import { useRemoteParticipants } from '@/lib/services/p2p';

function stateDot(state: string): string {
    switch (state) {
        case 'connected':
        case 'completed':
            return 'bg-status-success';
        case 'connecting':
        case 'checking':
        case 'disconnected':
            return 'bg-status-warning';
        case 'failed':
        case 'closed':
            return 'bg-status-error';
        default:
            return 'bg-text-tertiary';
    }
}

export function IPShieldPanel() {
    const remotes = useRemoteParticipants();
    // Re-render periodically so ICE states stay live.
    const [, tick] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        const t = setInterval(tick, 2000);
        return () => clearInterval(t);
    }, []);

    const rows = remotes.map((p) => {
        const pc = p.peerConnection;
        return {
            id: p.id,
            connectionState: pc?.connectionState ?? 'unknown',
            iceState: pc?.iceConnectionState ?? 'unknown',
        };
    });
    const connected = rows.filter((r) => r.connectionState === 'connected').length;
    const connecting = rows.filter(
        (r) => r.connectionState === 'connecting' || r.connectionState === 'new'
    ).length;

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-primary-500/30 bg-primary-500/10 p-3">
                <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary-400" />
                <div className="text-xs leading-relaxed text-text-secondary">
                    <p className="font-medium text-text-primary">
                        Your voice &amp; video are peer-to-peer, encrypted with
                        DTLS-SRTP.
                    </p>
                    <p className="mt-1">
                        Our server only helps phones find each other
                        (signaling) — it never hears your audio and never sees
                        your video.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-surface-border bg-surface-default p-3 text-center">
                    <p className="text-2xl font-bold text-status-success">{connected}</p>
                    <p className="text-[11px] text-text-tertiary">peer links encrypted</p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-default p-3 text-center">
                    <p className="text-2xl font-bold text-status-warning">{connecting}</p>
                    <p className="text-[11px] text-text-tertiary">still connecting</p>
                </div>
            </div>

            <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                    Live peer connections
                </h4>
                {rows.length === 0 ? (
                    <p className="text-xs text-text-tertiary">
                        No peer links yet — join the room to see them here.
                    </p>
                ) : (
                    <ul className="space-y-1.5">
                        {rows.map((r) => (
                            <li
                                key={r.id}
                                className="flex items-center gap-2 rounded-lg bg-surface-default px-3 py-2 text-xs"
                            >
                                <span className={cn('h-2 w-2 rounded-full', stateDot(r.connectionState))} />
                                <code className="text-text-secondary">
                                    {r.id.slice(0, 8)}…
                                </code>
                                <span className="ml-auto text-text-tertiary">
                                    {r.connectionState} · ICE {r.iceState}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-[11px] leading-relaxed text-text-tertiary">
                Honest note: this is not a VPN. In any direct call your IP
                address is visible to the people you talk to — that&apos;s how
                the internet connects two phones. What&apos;s protected is the
                content: nobody in the middle can listen in.
            </p>
        </div>
    );
}
