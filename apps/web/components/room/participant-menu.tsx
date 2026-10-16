'use client';

/**
 * ParticipantMenu — per-person actions in a room.
 *
 * Everyone: Report, Block/Unblock.
 * Host only: Kick, Ban (7 days / permanent), Lower hand, Unban.
 *
 * Rendered as a Radix dropdown anchored to the participant's tile/avatar.
 */
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui';
import {
    Flag,
    EyeOff,
    Eye,
    MicOff,
    Shield,
    Hand,
    Lock,
    Heart,
    User,
} from '@/components/ui/icons';
import { blockDevice, unblockDevice, isBlocked } from '@/lib/blocked';

/** Broadcast: open this participant's activity card (handled in room). */
export function openParticipantCard(deviceId: string) {
    window.dispatchEvent(
        new CustomEvent('fot:open-participant-card', { detail: { deviceId } })
    );
}

const REPORT_REASONS = [
    'Spam / flooding',
    'Harassment / hate speech',
    'Inappropriate content',
    'Impersonation',
    'Other',
];

interface ParticipantMenuProps {
    roomId: string;
    deviceId: string; // me
    targetDeviceId: string;
    targetNickname: string;
    targetHandRaised: boolean;
    iAmOwner: boolean;
    children: React.ReactNode; // trigger
    onAction?: (msg: string) => void;
}

export function ParticipantMenu({
    roomId,
    deviceId,
    targetDeviceId,
    targetNickname,
    targetHandRaised,
    iAmOwner,
    children,
    onAction,
}: ParticipantMenuProps) {
    const [blocked, setBlocked] = useState(() => isBlocked(targetDeviceId));
    const [busy, setBusy] = useState(false);
    const report = useMutation(api.moderation.report);
    const kick = useMutation(api.moderation.kick);
    const ban = useMutation(api.moderation.siteBan);
    const lowerHand = useMutation(api.moderation.lowerHand);

    // Follow state (hidden for own row).
    const isSelf = deviceId === targetDeviceId;
    const following = useQuery(
        api.follows.isFollowing,
        isSelf
            ? 'skip'
            : { followerDeviceId: deviceId, followingDeviceId: targetDeviceId }
    );
    const followMut = useMutation(api.follows.follow);
    const unfollowMut = useMutation(api.follows.unfollow);

    const myNickname = () =>
        typeof window === 'undefined'
            ? 'Guest'
            : localStorage.getItem('talkfree_nickname') || 'Guest';

    const handleFollow = () =>
        run(
            () =>
                following
                    ? unfollowMut({
                          followerDeviceId: deviceId,
                          followingDeviceId: targetDeviceId,
                      })
                    : followMut({
                          followerDeviceId: deviceId,
                          followingDeviceId: targetDeviceId,
                          followerNickname: myNickname(),
                          followingNickname: targetNickname.slice(0, 30),
                      }),
            following
                ? `Unfollowed ${targetNickname}.`
                : `Following ${targetNickname} — you'll be notified when they're online. 🔥`
        );

    const run = async (fn: () => Promise<unknown>, doneMsg: string) => {
        setBusy(true);
        try {
            await fn();
            onAction?.(doneMsg);
        } catch (err) {
            onAction?.(err instanceof Error ? err.message : 'Action failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleBlock = () => {
        if (blocked) {
            unblockDevice(targetDeviceId);
            setBlocked(false);
            onAction?.(`Unblocked ${targetNickname}.`);
        } else {
            blockDevice(targetDeviceId);
            setBlocked(true);
            onAction?.(`Blocked ${targetNickname} — their messages and audio are hidden for you.`);
        }
        // Tell the voice mesh to mute/unmute this peer's audio immediately.
        window.dispatchEvent(new CustomEvent('fot:blocklist-changed'));
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={busy}>
                {children}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="truncate">{targetNickname}</DropdownMenuLabel>

                <DropdownMenuItem onClick={() => openParticipantCard(targetDeviceId)}>
                    <User className="h-4 w-4 mr-2" />
                    View profile
                </DropdownMenuItem>

                {!isSelf && (
                    <DropdownMenuItem onClick={handleFollow} disabled={busy || following === undefined}>
                        <Heart
                            className={`h-4 w-4 mr-2 ${following ? 'fill-current text-primary-400' : ''}`}
                        />
                        {following ? 'Following' : 'Follow'}
                    </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                {REPORT_REASONS.map((reason) => (
                    <DropdownMenuItem
                        key={reason}
                        onClick={() =>
                            run(
                                () =>
                                    report({
                                        roomId: roomId as any,
                                        reporterDeviceId: deviceId,
                                        targetDeviceId,
                                        reason,
                                    }),
                                `Reported ${targetNickname}. Thanks — hosts review reports.`
                            )
                        }
                    >
                        <Flag className="h-4 w-4 mr-2" />
                        Report: {reason}
                    </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={handleBlock}>
                    {blocked ? (
                        <Eye className="h-4 w-4 mr-2" />
                    ) : (
                        <EyeOff className="h-4 w-4 mr-2" />
                    )}
                    {blocked ? 'Unblock' : 'Block'} (only for you)
                </DropdownMenuItem>

                {iAmOwner && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5" /> Host actions
                        </DropdownMenuLabel>
                        {targetHandRaised && (
                            <DropdownMenuItem
                                onClick={() =>
                                    run(
                                        () =>
                                            lowerHand({
                                                roomId: roomId as any,
                                                ownerDeviceId: deviceId,
                                                targetDeviceId,
                                            }),
                                        `Lowered ${targetNickname}'s hand.`
                                    )
                                }
                            >
                                <Hand className="h-4 w-4 mr-2" />
                                Lower hand
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                            onClick={() =>
                                run(
                                    () =>
                                        kick({
                                            roomId: roomId as any,
                                            ownerDeviceId: deviceId,
                                            targetDeviceId,
                                        }),
                                    `${targetNickname} was removed from the room.`
                                )
                            }
                        >
                            <MicOff className="h-4 w-4 mr-2" />
                            Kick from room
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                run(
                                    () =>
                                        ban({
                                            roomId: roomId as any,
                                            ownerDeviceId: deviceId,
                                            targetDeviceId,
                                            reason: 'Banned by host',
                                            days: 7,
                                        }),
                                    `${targetNickname} banned for 7 days.`
                                )
                            }
                        >
                            <Lock className="h-4 w-4 mr-2" />
                            Ban 7 days
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-status-error focus:text-status-error"
                            onClick={() =>
                                run(
                                    () =>
                                        ban({
                                            // no roomId = site-wide
                                            ownerDeviceId: deviceId,
                                            targetDeviceId,
                                            reason: 'Banned by host',
                                            days: 365,
                                        }),
                                    `${targetNickname} banned permanently.`
                                )
                            }
                        >
                            <Shield className="h-4 w-4 mr-2" />
                            Ban permanently
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
