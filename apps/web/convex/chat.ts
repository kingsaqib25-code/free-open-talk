import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Room text chat. */

export const list = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(args.limit ?? 100);
    return msgs.reverse();
  },
});

export const send = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    nickname: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const text = args.text.trim().slice(0, 500);
    if (!text) throw new Error("Empty message.");
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.deviceId)
      )
      .first();
    if (!p) throw new Error("Join the room first.");
    await ctx.db.insert("messages", {
      roomId: args.roomId,
      deviceId: args.deviceId,
      nickname: args.nickname.slice(0, 30),
      text,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.roomId, { lastActivityAt: Date.now() });
  },
});
