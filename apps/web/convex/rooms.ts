import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const HEARTBEAT_TIMEOUT_MS = 30_000;
/**
 * Room hygiene: when the last participant leaves, the room is NOT deleted
 * instantly — the owner may step out briefly and come back. presence.leave
 * stamps `emptySince`; the cron deletes the room only after this grace
 * period with nobody inside. Anyone rejoining clears emptySince.
 */
const EMPTY_ROOM_GRACE_MS = 15 * 60_000;

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

/**
 * Delete every doc belonging to a room. Used by presence.leave (never —
 * leave only stamps emptySince) and by cleanupEmpty below.
 */
async function deleteRoomCascade(ctx: any, roomId: any) {
  const byRoom = async (table: string) =>
    await ctx.db
      .query(table)
      .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
      .collect();
  for (const table of [
    "participants",
    "signals",
    "messages",
    "whiteboard",
    "tictactoe",
    "sharedMedia",
    "notepad",
    "watchParty",
  ]) {
    for (const doc of await byRoom(table)) await ctx.db.delete(doc._id);
  }
  await ctx.db.delete(roomId);
}

/** Remove rooms empty past the grace period (called by cron every 2 min). */
export const cleanupEmpty = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EMPTY_ROOM_GRACE_MS;
    const stale = await ctx.db
      .query("rooms")
      .withIndex("by_activity")
      .collect();
    let removed = 0;
    for (const room of stale) {
      if (
        room.emptySince !== undefined &&
        room.emptySince < cutoff &&
        room.participantCount === 0
      ) {
        await deleteRoomCascade(ctx, room._id);
        removed++;
      }
    }
    return removed;
  },
});

export { HEARTBEAT_TIMEOUT_MS };

/** Owner sets the room's welcome message (shown warm-style on join). */
export const setWelcomeMessage = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found.");
    if (room.ownerDeviceId !== args.deviceId) {
      throw new Error("Only the host can set the welcome message.");
    }
    await ctx.db.patch(args.roomId, {
      welcomeMessage: args.message.slice(0, 500),
      lastActivityAt: Date.now(),
    });
    return { ok: true as const };
  },
});
