'use client';

/**
 * Activity reporters — watch for shared-media/watch-party sessions and
 * publish the local user's activity into the presence heartbeat.
 *
 * Mount WatchActivityReporter INSIDE WatchPartyProvider (it uses the
 * watch-party context). It fires {kind:'watching', label} whenever the
 * room has a live watch-party session or a shared-media session, and
 * clears it when both are gone. The owner key 'watch' is independent of
 * whiteboard/game/notes so they don't clobber each other.
 */

import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useWatchParty } from './watch-party';
import { setMyActivity, clearMyActivity } from '@/lib/activity';

const OWNER = 'watch';

export function WatchActivityReporter({ roomId }: { roomId: string }) {
  const { session } = useWatchParty();
  const shared = useQuery(
    api.sharedMedia.get,
    roomId ? { roomId: roomId as never } : 'skip'
  ) as
    | { platform: string; title?: string; ref: string }
    | null
    | undefined;

  useEffect(() => {
    if (session) {
      const label =
        session.kind === 'youtube'
          ? session.title || 'YouTube video'
          : session.fileName || 'a local file';
      setMyActivity('watching', label, OWNER);
    } else if (shared) {
      setMyActivity(
        'watching',
        shared.title || `a ${shared.platform} share`,
        OWNER
      );
    } else {
      clearMyActivity(OWNER);
    }
    // Unmount (left the room) always clears.
    return () => clearMyActivity(OWNER);
  }, [session, shared]);

  return null;
}
