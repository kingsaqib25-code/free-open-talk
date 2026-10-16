import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { HEARTBEAT_TIMEOUT_MS } from "./rooms";

/**
 * Presence: join / heartbeat / leave.
 * Identity = deviceId (random per browser), no login wall for MVP.
 */

export const listForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    return all.filter((p) => p.lastHeartbeat > cutoff);
  },
});

export const join = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    nickname: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found.");

    const bans = await ctx.db
      .query("bans")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    const now = Date.now();
    const banned = bans.some(
      (b) =>
        b.expiresAt > now &&
        (b.roomId === undefined || b.roomId === args.roomId)
    );
    if (banned) throw new Error("You are banned from this room.");

    const existing = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.deviceId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        nickname: args.nickname.slice(0, 30),
        lastHeartbeat: now,
      });
      return { alreadyIn: true, participantId: existing._id };
    }

    if (room.locked && room.ownerDeviceId !== args.deviceId) {
      throw new Error("Room is locked.");
    }
    const live = (
      await ctx.db
        .query("participants")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect()
    ).filter((p) => p.lastHeartbeat > now - HEARTBEAT_TIMEOUT_MS);
    if (live.length >= room.maxParticipants) {
      throw new Error("Room is full.");
    }

    const participantId = await ctx.db.insert("participants", {
      roomId: args.roomId,
      deviceId: args.deviceId,
      nickname: args.nickname.slice(0, 30),
      isOwner: false,
      role: room.mode === "stage" ? "listener" : "publisher",
      muted: false,
      handRaised: false,
      videoOn: false,
      sharingScreen: false,
      lastHeartbeat: now,
      joinedAt: now,
    });
    await ctx.db.patch(args.roomId, {
      participantCount: live.length + 1,
      lastActivityAt: now,
    });
    // Return the peers already here so the newcomer knows who to expect
    // offers from (existing peers initiate — avoids SDP glare).
    return {
      alreadyIn: false,
      participantId,
      existingPeers: live.map((p) => ({
        deviceId: p.deviceId,
        nickname: p.nickname,
        role: p.role,
      })),
    };
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    state: v.optional(
      v.object({
        muted: v.boolean(),
        handRaised: v.boolean(),
        videoOn: v.boolean(),
        sharingScreen: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.deviceId)
      )
      .first();
    if (!p) return;
    const patch: any = { lastHeartbeat: Date.now() };
    if (args.state) Object.assign(patch, args.state);
    await ctx.db.patch(p._id, patch);
  },
});

export const leave = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.deviceId)
      )
      .first();
    if (!p) return;
    await ctx.db.delete(p._id);
    // Drop any undelivered signals involving this device
    const stale = await ctx.db
      .query("signals")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const s of stale) {
      if (s.fromDeviceId === args.deviceId || s.toDeviceId === args.deviceId) {
        await ctx.db.delete(s._id);
      }
    }
    const room = await ctx.db.get(args.roomId);
    if (room) {
      await ctx.db.patch(args.roomId, {
        participantCount: Math.max(0, room.participantCount - 1),
        lastActivityAt: Date.now(),
      });
    }
  },
});

/** Cron: drop participants whose heartbeat went stale. */
export const cleanupStale = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    // Scan is bounded: rooms are small in MVP. Revisit with pagination at scale.
    const rooms = await ctx.db.query("rooms").collect();
    let removed = 0;
    for (const room of rooms) {
      const stale = (
        await ctx.db
          .query("participants")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect()
      ).filter((p) => p.lastHeartbeat <= cutoff);
      for (const p of stale) {
        await ctx.db.delete(p._id);
        removed++;
      }
      if (stale.length > 0) {
        const live = (
          await ctx.db
            .query("participants")
            .withIndex("by_room", (q) => q.eq("roomId", room._id))
            .collect()
        ).filter((p) => p.lastHeartbeat > cutoff);
        await ctx.db.patch(room._id, {
          participantCount: live.length,
          lastActivityAt: Date.now(),
        });
      }
    }
    return removed;
  },
});
