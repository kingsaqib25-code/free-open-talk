'use client';

import { useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Row of emoji reaction buttons. Client-side rate cap: max 1 reaction per
 * 2 seconds per user (extra taps are silently dropped — no nag UI).
 */
export default function ReactionBar({
  onReact,
}: {
  onReact: (emoji: string) => void;
}) {
  const lastSentRef = useRef(0);

  const handle = (emoji: string) => {
    const now = Date.now();
    if (now - lastSentRef.current < 2000) return; // rate cap: 1 per 2s
    lastSentRef.current = now;
    onReact(emoji);
  };

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-default/90 px-2 py-1.5 shadow-lg backdrop-blur"
      role="toolbar"
      aria-label="Send a reaction"
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handle(emoji)}
          className="rounded-full p-1.5 text-xl leading-none transition-transform hover:scale-125 active:scale-95"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export const REACTION_EMOJIS = ["❤️", "👏", "😂", "🎉", "🔥"] as const;

/**
 * Broadcasts a reaction to every other participant via the existing
 * `signals` table (type "reaction", payload JSON { emoji }). Peers poll
 * their signals and feed the emoji into ReactionOverlay.
 *
 * Usage:
 *   const sendReaction = useReactionSender(roomId, deviceId);
 *   <ReactionBar onReact={(emoji) => sendReaction(emoji, peerDeviceIds)} />
 */
export function useReactionSender(
  roomId: Id<"rooms"> | undefined,
  deviceId: string
) {
  const push = useMutation(api.signals.push);
  return useCallback(
    async (emoji: string, peerDeviceIds: string[]) => {
      if (!roomId) return;
      const payload = JSON.stringify({ emoji });
      const targets = peerDeviceIds.filter((d) => d && d !== deviceId);
      // Fire-and-forget fan-out; one tiny row per peer, consumed on read.
      await Promise.all(
        targets.map((toDeviceId) =>
          push({
            roomId,
            fromDeviceId: deviceId,
            toDeviceId,
            type: "reaction",
            payload,
          }).catch(() => {})
        )
      );
    },
    [push, roomId, deviceId]
  );
}
