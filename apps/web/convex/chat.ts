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
    replyTo: v.optional(
      v.object({
        messageId: v.id("messages"),
        nickname: v.string(),
        text: v.string(),
      })
    ),
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
      reactions: [],
      replyTo: args.replyTo
        ? {
            messageId: args.replyTo.messageId,
            nickname: args.replyTo.nickname.slice(0, 30),
            text: args.replyTo.text.slice(0, 120),
          }
        : undefined,
    });
    await ctx.db.patch(args.roomId, { lastActivityAt: Date.now() });
  },
});

/** Toggle an emoji reaction on a message (one per user per emoji). */
export const react = mutation({
  args: {
    messageId: v.id("messages"),
    deviceId: v.string(),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) throw new Error("Message not found.");
    const emoji = args.emoji.slice(0, 8);
    const reactions = msg.reactions ?? [];
    const idx = reactions.findIndex(
      (r) => r.deviceId === args.deviceId && r.emoji === emoji
    );
    if (idx >= 0) {
      reactions.splice(idx, 1);
    } else {
      reactions.push({ deviceId: args.deviceId, emoji });
    }
    await ctx.db.patch(args.messageId, { reactions });
  },
});
