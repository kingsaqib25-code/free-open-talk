import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Shared Media — "Share from platforms" for the In-room Apps Panel.
 *
 * Design (mirrors convex/watchparty.ts): the room OWNER picks a piece of
 * content from a platform (TikTok, Twitch, Vimeo, Dailymotion, Spotify, X,
 * Facebook, Instagram...); the pick is written to the `sharedMedia` table;
 * every viewer subscribes reactively via `get`, so the SAME embed loads on
 * all devices at the same time. Each viewer streams from their OWN device —
 * zero bandwidth cost to us ($0 infra, no API keys, keyless embeds only).
 *
 * Honest sync labels (shown in the UI):
 *   - YouTube        → handled by the existing watchparty flow (true synced playback)
 *   - Twitch/Vimeo/Dailymotion → play/pause relay, best effort (postMessage)
 *   - everything else → "plays together" (simultaneous load, no transport sync)
 *
 * Host-only: start/stop require room.ownerDeviceId (guests watch).
 */

const platformValidator = v.union(
  v.literal("tiktok"),
  v.literal("twitch"),
  v.literal("vimeo"),
  v.literal("dailymotion"),
  v.literal("spotify"),
  v.literal("x"),
  v.literal("facebook"),
  v.literal("instagram")
);

async function getSession(
  ctx: { db: any },
  roomId: any
) {
  return await ctx.db
    .query("sharedMedia")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .first();
}

async function requireHost(ctx: { db: any }, roomId: any, deviceId: string) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("Room not found.");
  if (room.ownerDeviceId !== deviceId) {
    throw new Error("Only the host can share media.");
  }
  return room;
}

/** Active shared-media session for the room (null = none). Reactive. */
export const get = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const s = await getSession(ctx, args.roomId);
    if (!s) return null;
    return {
      platform: s.platform as string,
      ref: s.ref as string,
      title: (s.title as string | undefined) ?? undefined,
      hostDeviceId: s.hostDeviceId as string,
      createdAt: s.createdAt as number,
    };
  },
});

/**
 * Host picks content → replaces any existing session so everyone loads
 * the new embed together.
 */
export const start = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    platform: platformValidator,
    ref: v.string(), // parsed embed reference (id / channel / path), max 500 chars
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.roomId, args.deviceId);
    const ref = args.ref.trim().slice(0, 500);
    if (!ref) throw new Error("Nothing to share — paste a link first.");
    const existing = await getSession(ctx, args.roomId);
    const row = {
      roomId: args.roomId,
      platform: args.platform,
      ref,
      title: args.title?.slice(0, 140),
      hostDeviceId: args.deviceId,
      createdAt: Date.now(),
    };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("sharedMedia", row);
    }
    return { ok: true as const };
  },
});

/** Host ends the shared-media session for everyone. */
export const stop = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.roomId, args.deviceId);
    const s = await getSession(ctx, args.roomId);
    if (s) await ctx.db.delete(s._id);
    return { ok: true as const };
  },
});
