import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const HEARTBEAT_TIMEOUT_MS = 30_000;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

function isBannedCheck(
  bans: Array<{ roomId?: any; expiresAt: number }>,
  roomId: any
) {
  const now = Date.now();
  return bans.some(
    (b) =>
      b.expiresAt > now && (b.roomId === undefined || b.roomId === roomId)
  );
}

/** Live room directory for the hallway. */
export const list = query({
  args: {
    language: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let rooms;
    if (args.language) {
      rooms = await ctx.db
        .query("rooms")
        .withIndex("by_language", (q) => q.eq("language", args.language!))
        .order("desc")
        .take(args.limit ?? 60);
    } else {
      rooms = await ctx.db
        .query("rooms")
        .withIndex("by_activity")
        .order("desc")
        .take(args.limit ?? 60);
    }
    return rooms;
  },
});

export const get = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.roomId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    language: v.string(),
    topic: v.optional(v.string()),
    level: v.optional(v.string()),
    mode: v.union(
      v.literal("voice"),
      v.literal("stage"),
      v.literal("private")
    ),
    deviceId: v.string(),
    nickname: v.string(),
  },
  handler: async (ctx, args) => {
    const bans = await ctx.db
      .query("bans")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    if (isBannedCheck(bans, undefined)) {
      throw new Error("You are banned from creating rooms.");
    }
    const maxParticipants =
      args.mode === "private" ? 2 : args.mode === "stage" ? 8 : 25;
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      name: args.name.slice(0, 80),
      language: args.language,
      topic: args.topic?.slice(0, 120),
      level: args.level,
      mode: args.mode,
      ownerDeviceId: args.deviceId,
      locked: false,
      maxParticipants,
      participantCount: 1,
      lastActivityAt: now,
    });
    await ctx.db.insert("participants", {
      roomId,
      deviceId: args.deviceId,
      nickname: args.nickname.slice(0, 30),
      isOwner: true,
      role: "publisher",
      muted: false,
      handRaised: false,
      videoOn: args.mode !== "voice",
      sharingScreen: false,
      lastHeartbeat: now,
      joinedAt: now,
    });
    return roomId;
  },
});

/** Remove rooms nobody is in anymore (called by cron). */
export const cleanupEmpty = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EMPTY_ROOM_TTL_MS;
    const stale = await ctx.db
      .query("rooms")
      .withIndex("by_activity", (q) => q.lt("lastActivityAt", cutoff))
      .collect();
    let removed = 0;
    for (const room of stale) {
      if (room.participantCount === 0) {
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect();
        for (const p of participants) await ctx.db.delete(p._id);
        const signals = await ctx.db
          .query("signals")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect();
        for (const s of signals) await ctx.db.delete(s._id);
        await ctx.db.delete(room._id);
        removed++;
      }
    }
    return removed;
  },
});

export { HEARTBEAT_TIMEOUT_MS };
