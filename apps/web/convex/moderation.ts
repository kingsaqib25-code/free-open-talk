import { mutation } from "./_generated/server";
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
