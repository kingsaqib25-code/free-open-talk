import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { HEARTBEAT_TIMEOUT_MS } from "./rooms";

/**
 * Watch Party — movie + live voice chat together (Phase 6).
 *
 * Design: the host writes playback state (play/pause/seek) to the
 * `watchParty` table; every viewer subscribes reactively via the `get`
 * query, so late joiners snap to the current timestamp automatically.
 * Each viewer streams from their OWN device (YouTube directly, or their
 * own copy of the file) — zero bandwidth cost to us, and no audio echo
 * in the P2P voice mesh, which keeps running underneath untouched.
 *
 * We never block or filter what users share. If a source's DRM
 * black-screens a screen-share, that's the other company's doing.
 */

const kindValidator = v.union(v.literal("youtube"), v.literal("file"));
const statusValidator = v.union(v.literal("playing"), v.literal("paused"));

async function liveParticipants(ctx: any, roomId: any) {
  const now = Date.now();
  return (
    await ctx.db
      .query("participants")
      .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
      .collect()
  ).filter((p: any) => p.lastHeartbeat > now - HEARTBEAT_TIMEOUT_MS);
}

async function getSession(ctx: any, roomId: any) {
  return await ctx.db
    .query("watchParty")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .first();
}

/**
 * Who may drive playback? The room owner, normally. If the owner has
 * left the room (clean leave deletes their participant row), control
 * passes gracefully: the session host keeps driving if still present,
 * otherwise any live participant may take over so the movie doesn't
 * die with the host's network.
 */
async function requireController(ctx: any, roomId: any, deviceId: string) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("Room not found.");
  if (room.ownerDeviceId === deviceId) return room;
  const live = await liveParticipants(ctx, roomId);
  const me = live.find((p: any) => p.deviceId === deviceId);
  if (!me) throw new Error("You are not in this room.");
  const ownerLive = live.some((p: any) => p.deviceId === room.ownerDeviceId);
  if (ownerLive) throw new Error("Only the host can control Watch Party.");
  const session = await getSession(ctx, roomId);
  if (session) {
    const hostLive = live.some(
      (p: any) => p.deviceId === session.hostDeviceId
    );
    if (hostLive && session.hostDeviceId !== deviceId) {
      throw new Error("Only the host can control Watch Party.");
    }
  }
  return room;
}

/** Current session for the room (null = none). Reactive — late joiners snap in. */
export const get = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const s = await getSession(ctx, args.roomId);
    if (!s) return null;
    return {
      kind: s.kind,
      videoId: s.videoId,
      title: s.title,
      fileName: s.fileName,
      fileSize: s.fileSize,
      status: s.status,
      positionSec: s.positionSec,
      updatedAt: s.updatedAt,
      hostDeviceId: s.hostDeviceId,
    };
  },
});

/** Start (or replace) a watch session. Starts paused at 0 so everyone can load first. */
export const start = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    kind: kindValidator,
    videoId: v.string(), // YouTube video ID; "" in file mode
    title: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireController(ctx, args.roomId, args.deviceId);
    if (args.kind === "youtube" && !/^[A-Za-z0-9_-]{11}$/.test(args.videoId)) {
      throw new Error("That doesn't look like a valid YouTube video.");
    }
    if (args.kind === "file" && !args.fileName) {
      throw new Error("Pick a file first.");
    }
    const existing = await getSession(ctx, args.roomId);
    const row = {
      roomId: args.roomId,
      kind: args.kind,
      videoId: args.videoId,
      title: args.title,
      fileName: args.fileName,
      fileSize: args.fileSize,
      status: "paused" as const,
      positionSec: 0,
      updatedAt: Date.now(),
      hostDeviceId: args.deviceId,
    };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("watchParty", row);
    }
    return { ok: true as const };
  },
});

/** Playback control: play / pause / seek. Host-only (see requireController). */
export const control = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    status: statusValidator,
    positionSec: v.number(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireController(ctx, args.roomId, args.deviceId);
    const s = await getSession(ctx, args.roomId);
    if (!s) throw new Error("No active watch party.");
    const patch: any = {
      status: args.status,
      positionSec: Math.max(0, args.positionSec),
      updatedAt: Date.now(),
      hostDeviceId: args.deviceId,
    };
    if (args.title) patch.title = args.title.slice(0, 120);
    await ctx.db.patch(s._id, patch);
    return { ok: true as const };
  },
});

/** End the session for everyone. */
export const stop = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    await requireController(ctx, args.roomId, args.deviceId);
    const s = await getSession(ctx, args.roomId);
    if (s) await ctx.db.delete(s._id);
    return { ok: true as const };
  },
});
