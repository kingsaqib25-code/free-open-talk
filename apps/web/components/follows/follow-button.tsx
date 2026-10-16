'use client';

/**
 * Follow / unfollow primitives for the guest follow system
 * (convex/follows.ts — identity = deviceId, no accounts).
 */

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getDeviceId } from '@/lib/guest';
import { cn } from '@/lib/design-system';
import { Heart } from '@/components/ui/icons';

function myNickname(): string {
  if (typeof window === 'undefined') return 'Guest';
  return localStorage.getItem('talkfree_nickname') || 'Guest';
}

export function useFollow(targetDeviceId: string, targetNickname: string) {
  const deviceId = getDeviceId();
  const isSelf = deviceId === targetDeviceId;
  const following = useQuery(
    api.follows.isFollowing,
    isSelf ? 'skip' : { followerDeviceId: deviceId, followingDeviceId: targetDeviceId }
  );
  const followMut = useMutation(api.follows.follow);
  const unfollowMut = useMutation(api.follows.unfollow);
  const [busy, setBusy] = useState(false);

  const toggle = async (): Promise<boolean> => {
    if (isSelf || busy) return following === true;
    setBusy(true);
    try {
      if (following) {
        await unfollowMut({
          followerDeviceId: deviceId,
          followingDeviceId: targetDeviceId,
        });
      } else {
        await followMut({
          followerDeviceId: deviceId,
          followingDeviceId: targetDeviceId,
          followerNickname: myNickname(),
          followingNickname: targetNickname.slice(0, 30),
        });
      }
    } catch {
      /* optimistic UI stays; error surfaces via notice elsewhere */
    } finally {
      setBusy(false);
    }
    return !following;
  };

  return {
    isSelf,
    following: following === true,
    busy,
    toggle,
  };
}

/**
 * Warm-styled Follow / Following pill button. Hidden for own row.
 */
export function FollowButton({
  targetDeviceId,
  targetNickname,
  size = 'sm',
  className,
}: {
  targetDeviceId: string;
  targetNickname: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { isSelf, following, busy, toggle } = useFollow(
    targetDeviceId,
    targetNickname
  );
  if (isSelf) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold transition-all active:scale-95 disabled:opacity-60',
        size === 'md' ? 'px-5 py-2 text-sm' : 'px-3.5 py-1.5 text-xs',
        following
          ? 'border border-primary-500/40 bg-primary-500/15 text-primary-300'
          : 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/25 hover:shadow-lg',
        className
      )}
      aria-pressed={following}
    >
      <Heart
        className={cn(
          size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5',
          following && 'fill-current'
        )}
      />
      {busy ? '…' : following ? 'Following' : 'Follow'}
    </button>
  );
}
