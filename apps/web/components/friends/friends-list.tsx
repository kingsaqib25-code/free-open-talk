'use client';

/**
 * FriendsList — everyone I follow, with reactive online dots.
 * Online friends in a room show "in a room — tap to join".
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getDeviceId } from '@/lib/guest';
import { cn } from '@/lib/design-system';
import { Avatar } from '@/components/ui';
import { Loader2, UserMinus } from '@/components/ui/icons';

function Row({
  myDeviceId,
  followingDeviceId,
  followingNickname,
  status,
}: {
  myDeviceId: string;
  followingDeviceId: string;
  followingNickname: string;
  status?: { online: boolean; nickname?: string; roomId?: string };
}) {
  const unfollow = useMutation(api.follows.unfollow);
  const [busy, setBusy] = useState(false);
  const online = status?.online === true;
  const nickname = status?.nickname || followingNickname;
  const roomId = status?.roomId;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-surface-borderSubtle bg-surface-default/60 px-4 py-3">
      <div className="relative shrink-0">
        <Avatar fallback={nickname} alt={nickname} size="md" />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background-secondary',
            online ? 'bg-status-success' : 'bg-text-tertiary/50'
          )}
          title={online ? 'Online' : 'Offline'}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{nickname}</p>
        {online && roomId ? (
          <Link
            href={`/rooms/${roomId}`}
            className="text-xs font-medium text-primary-400 hover:text-primary-300 hover:underline"
          >
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-status-success align-middle" />
            In a room — tap to join
          </Link>
        ) : (
          <p className="text-xs text-text-tertiary">
            {online ? 'Online' : 'Offline'}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          unfollow({
            followerDeviceId: myDeviceId,
            followingDeviceId,
          }).finally(() => setBusy(false));
        }}
        className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-text-tertiary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        title={`Unfollow ${nickname}`}
      >
        <UserMinus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Unfollow</span>
      </button>
    </div>
  );
}

export function FriendsList() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);

  const rows = useQuery(
    api.follows.following,
    deviceId ? { deviceId } : 'skip'
  );
  const ids = rows?.map((r) => r.followingDeviceId) ?? [];
  const status = useQuery(
    api.follows.onlineStatus,
    ids.length > 0 ? { deviceIds: ids } : 'skip'
  );

  if (rows === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading friends…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg font-semibold text-text-primary">
          No friends yet 🧡
        </p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Join a voice room, tap someone&apos;s avatar, and hit Follow — we&apos;ll
          ping you the moment they come online.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-full bg-gradient-to-r from-primary-500 to-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25"
        >
          Browse voice rooms
        </Link>
      </div>
    );
  }

  const onlineCount = ids.filter((id) => status?.[id]?.online).length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-2.5">
      <p className="px-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
        {rows.length} friend{rows.length !== 1 ? 's' : ''} · {onlineCount} online
      </p>
      {rows.map((r) => (
        <Row
          key={r.followingDeviceId}
          myDeviceId={deviceId!}
          followingDeviceId={r.followingDeviceId}
          followingNickname={r.followingNickname}
          status={status?.[r.followingDeviceId]}
        />
      ))}
    </div>
  );
}
