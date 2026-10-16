import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Moderation: kick / ban / lock / report.
 * Owner-only actions are enforced here (deviceId === rooms.ownerDeviceId).
 */

async function requireOwner(ctx: any, roomId: any, deviceId: string) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("Room not found.");
  if (room.ownerDeviceId !== deviceId) throw new Error("Owner only.");
  return room;
}

export const kick = mutation({
  args: { roomId: v.id("rooms"), ownerDeviceId: v.string(), targetDeviceId: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.targetDeviceId)
      )
      .first();
    if (p) await ctx.db.delete(p._id);
  },
});

export const ban = mutation({
  args: {
    roomId: v.id("rooms"),
    ownerDeviceId: v.string(),
    targetDeviceId: v.string(),
    reason: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.targetDeviceId)
      )
      .first();
    if (p) await ctx.db.delete(p._id);
    await ctx.db.insert("bans", {
      roomId: args.roomId,
      deviceId: args.targetDeviceId,
      reason: args.reason.slice(0, 200),
      expiresAt: Date.now() + Math.max(1, Math.min(365, args.days)) * 86_400_000,
    });
  },
});

export const setLocked = mutation({
  args: { roomId: v.id("rooms"), ownerDeviceId: v.string(), locked: v.boolean() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    await ctx.db.patch(args.roomId, { locked: args.locked });
  },
});

/** Stage mode: owner promotes/demotes publishers (max 4 enforced here). */
export const setRole = mutation({
  args: {
    roomId: v.id("rooms"),
    ownerDeviceId: v.string(),
    targetDeviceId: v.string(),
    role: v.union(v.literal("publisher"), v.literal("listener")),
  },
  handler: async (ctx, args) => {
    const room = await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    if (room.mode !== "stage") throw new Error("Stage rooms only.");
    if (args.role === "publisher") {
      const publishers = (
        await ctx.db
          .query("participants")
          .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
          .collect()
      ).filter((p) => p.role === "publisher");
      if (publishers.length >= 4) {
        throw new Error("Max 4 publishers at a time.");
      }
    }
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.targetDeviceId)
      )
      .first();
    if (!p) throw new Error("Participant not in room.");
    await ctx.db.patch(p._id, { role: args.role });
  },
});

export const report = mutation({
  args: {
    roomId: v.id("rooms"),
    reporterDeviceId: v.string(),
    targetDeviceId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reports", {
      roomId: args.roomId,
      reporterDeviceId: args.reporterDeviceId,
      targetDeviceId: args.targetDeviceId,
      reason: args.reason.slice(0, 300),
      createdAt: Date.now(),
    });
  },
});

/** Site-wide ban (no roomId) or room ban. Owner-only. */
export const siteBan = mutation({
  args: {
    roomId: v.optional(v.id("rooms")),
    ownerDeviceId: v.string(),
    targetDeviceId: v.string(),
    reason: v.string(),
    days: v.number(), // 365 = permanent
  },
  handler: async (ctx, args) => {
    if (args.roomId) {
      await requireOwner(ctx, args.roomId, args.ownerDeviceId);
      const p = await ctx.db
        .query("participants")
        .withIndex("by_room_device", (q) =>
          q.eq("roomId", args.roomId!).eq("deviceId", args.targetDeviceId)
        )
        .first();
      if (p) await ctx.db.delete(p._id);
    }
    // Dedupe: one active ban per (device, room-scope).
    const existing = await ctx.db
      .query("bans")
      .withIndex("by_device", (q) => q.eq("deviceId", args.targetDeviceId))
      .collect();
    const now = Date.now();
    for (const b of existing) {
      const sameScope =
        (b.roomId === undefined && args.roomId === undefined) ||
        (b.roomId !== undefined &&
          args.roomId !== undefined &&
          b.roomId === args.roomId);
      if (sameScope && b.expiresAt > now) {
        await ctx.db.patch(b._id, {
          reason: args.reason.slice(0, 200),
          expiresAt: now + Math.max(1, Math.min(365, args.days)) * 86_400_000,
        });
        return;
      }
    }
    await ctx.db.insert("bans", {
      roomId: args.roomId,
      deviceId: args.targetDeviceId,
      reason: args.reason.slice(0, 200),
      expiresAt: now + Math.max(1, Math.min(365, args.days)) * 86_400_000,
    });
  },
});

/** Lift a ban. Owner-only (room bans) — site bans need any room's owner? No:
 *  site-wide bans can only be lifted by explicit unban with the banner's
 *  room context. For MVP: any room owner can unban a device. */
export const unban = mutation({
  args: {
    roomId: v.id("rooms"),
    ownerDeviceId: v.string(),
    targetDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    const bans = await ctx.db
      .query("bans")
      .withIndex("by_device", (q) => q.eq("deviceId", args.targetDeviceId))
      .collect();
    for (const b of bans) await ctx.db.delete(b._id);
  },
});

/** Reports for this room, newest first — host moderation queue. */
export const listReports = query({
  args: { roomId: v.id("rooms"), deviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || room.ownerDeviceId !== args.deviceId) return [];
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(args.limit ?? 50);
    return reports;
  },
});

/** Host lowers someone's raised hand. */
export const lowerHand = mutation({
  args: {
    roomId: v.id("rooms"),
    ownerDeviceId: v.string(),
    targetDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.roomId, args.ownerDeviceId);
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.targetDeviceId)
      )
      .first();
    if (p) await ctx.db.patch(p._id, { handRaised: false });
  },
});
