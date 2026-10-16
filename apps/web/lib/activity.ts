/**
 * lib/activity.ts — local activity-presence reporting.
 *
 * Components that know what the user is doing (watch party, whiteboard,
 * game, notepad) call setMyActivity(kind, label?, owner) while active and
 * clearMyActivity(owner) when they stop. useConvexRoom merges the current
 * activity into every presence heartbeat (every 10s), so the room sees
 * "🎬 Watching: X" live.
 *
 * Owner-keyed: each reporter owns one slot, so a watcher closing the
 * watch party never clears an active whiteboard session.
 */

export type ActivityKind =
  | 'idle'
  | 'talking'
  | 'watching'
  | 'sharing'
  | 'whiteboard'
  | 'gaming'
  | 'notes';

export interface MyActivity {
  kind: ActivityKind;
  label?: string;
  updatedAt: number;
}

interface ExplicitActivity {
  kind: ActivityKind;
  label?: string;
  owner: string;
}

let explicit: ExplicitActivity | null = null;
/** Local mic speaking flag, mirrored from the P2P voice hook. */
let speakingFlag = false;

export function setMyActivity(
  kind: ActivityKind,
  label: string | undefined,
  owner: string
): void {
  if (
    explicit &&
    explicit.owner === owner &&
    explicit.kind === kind &&
    explicit.label === label
  ) {
    return;
  }
  explicit = { kind, label, owner };
}

export function clearMyActivity(owner: string): void {
  if (explicit?.owner === owner) explicit = null;
}

export function getMyActivity(): MyActivity | null {
  if (!explicit) return null;
  return {
    kind: explicit.kind,
    label: explicit.label,
    updatedAt: Date.now(),
  };
}

/** Mirror the local speaking state (called from the voice panel). */
export function setSpeakingFlag(speaking: boolean): void {
  speakingFlag = speaking;
}

/**
 * Resolve the heartbeat activity payload: explicit activity wins;
 * otherwise screen-share → 'sharing', unmuted + speaking → 'talking',
 * else 'idle'.
 */
export function resolveActivity(
  sharingScreen: boolean,
  muted: boolean
): MyActivity {
  const now = Date.now();
  const current = getMyActivity();
  if (current) return current;
  if (sharingScreen) return { kind: 'sharing', updatedAt: now };
  if (!muted && speakingFlag) return { kind: 'talking', updatedAt: now };
  return { kind: 'idle', updatedAt: now };
}
