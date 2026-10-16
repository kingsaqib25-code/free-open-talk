import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * WebRTC signaling over Convex — the P2P mesh control plane.
 * Flow: newcomer joins presence → existing peers each create an RTCPeerConnection
 * and POST an `offer` signal → newcomer polls, answers, posts `answer` →
 * both sides trickle `ice` candidates. Consume-then-delete keeps the table tiny.
 */

const signalValidator = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("ice")
);

export const push = mutation({
  args: {
    roomId: v.id("rooms"),
    fromDeviceId: v.string(),
    toDeviceId: v.string(),
    type: signalValidator,
    payload: v.string(), // JSON of RTCSessionDescriptionInit | RTCIceCandidateInit
  },
  handler: async (ctx, args) => {
    if (args.payload.length > 8000) throw new Error("Signal payload too large.");
    await ctx.db.insert("signals", {
      roomId: args.roomId,
      fromDeviceId: args.fromDeviceId,
      toDeviceId: args.toDeviceId,
      type: args.type,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

/** Poll for signals addressed to me, then delete them (consume-then-delete). */
export const poll = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const mine = await ctx.db
      .query("signals")
      .withIndex("by_recipient", (q) =>
        q.eq("roomId", args.roomId).eq("toDeviceId", args.deviceId)
      )
      .collect();
    for (const s of mine) await ctx.db.delete(s._id);
    return mine.map((s) => ({
      fromDeviceId: s.fromDeviceId,
      type: s.type,
      payload: s.payload,
    }));
  },
});

/** Housekeeping: drop signals older than 2 minutes (cron safety net). */
export const cleanupOld = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 120_000;
    const old = await ctx.db.query("signals").collect();
    let removed = 0;
    for (const s of old) {
      if (s.createdAt < cutoff) {
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    return removed;
  },
});
