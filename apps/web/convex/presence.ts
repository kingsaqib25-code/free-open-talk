import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { HEARTBEAT_TIMEOUT_MS } from "./rooms";
import { accrueStreakHeartbeat } from "./streaks";

/** Considered "came online" if no heartbeat for this long. */
const OFFLINE_THRESHOLD_MS = 5 * 60_000;

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
      const wasOffline = now - existing.lastHeartbeat > OFFLINE_THRESHOLD_MS;
      await ctx.db.patch(existing._id, {
        nickname: args.nickname.slice(0, 30),
        lastHeartbeat: now,
      });
      // Rejoining clears the empty-room grace stamp (see leave).
      if (room.emptySince !== undefined) {
        await ctx.db.patch(args.roomId, { emptySince: undefined });
      }
      if (wasOffline) {
        await ctx.scheduler.runAfter(0, internal.follows.notifyOnline, {
          deviceId: args.deviceId,
          nickname: args.nickname.slice(0, 30),
        });
      }
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
      // Rejoining clears the empty-room grace stamp (see leave).
      emptySince: undefined,
    });
    // Brand-new presence row: notify followers only if this device wasn't
    // live anywhere else already (fresh online, not a second tab).
    const otherLive = await ctx.db
      .query("participants")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    const elsewhereLive = otherLive.some(
      (p) => p.roomId !== args.roomId && p.lastHeartbeat > now - HEARTBEAT_TIMEOUT_MS
    );
    if (!elsewhereLive) {
      await ctx.scheduler.runAfter(0, internal.follows.notifyOnline, {
        deviceId: args.deviceId,
        nickname: args.nickname.slice(0, 30),
      });
    }
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
        // Watch Party (Phase 6): true once the participant picked the
        // matching local file in "file" mode.
        watchReady: v.optional(v.boolean()),
        // Live activity presence: what the participant is doing now.
        activity: v.optional(
          v.object({
            kind: v.union(
              v.literal("idle"),
              v.literal("talking"),
              v.literal("watching"),
              v.literal("sharing"),
              v.literal("whiteboard"),
              v.literal("gaming"),
              v.literal("notes")
            ),
            label: v.optional(v.string()),
            updatedAt: v.number(),
          })
        ),
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
    const now = Date.now();
    // Came-online detection for follower notifications: no heartbeat for a
    // while means the user was offline; this beat is their return.
    const wasOffline = now - p.lastHeartbeat > OFFLINE_THRESHOLD_MS;
    const patch: any = { lastHeartbeat: now };
    if (args.state) Object.assign(patch, args.state);
    await ctx.db.patch(p._id, patch);
    if (wasOffline) {
      await ctx.scheduler.runAfter(0, internal.follows.notifyOnline, {
        deviceId: args.deviceId,
        nickname: p.nickname,
      });
    }
    // Phase 8 (engagement): cheap streak accounting — accrues today's
    // minutes from heartbeat gaps; writes the streaks row only when the
    // minute bucket changes (guarded inside accrueStreakHeartbeat).
    await accrueStreakHeartbeat(ctx, args.deviceId, p.nickname, now);
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
      const liveCount = (
        await ctx.db
          .query("participants")
          .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
          .collect()
      ).filter((x) => Date.now() - x.lastHeartbeat < HEARTBEAT_TIMEOUT_MS)
        .length;
      const patch: any = {
        participantCount: Math.max(0, room.participantCount - 1),
        lastActivityAt: Date.now(),
      };
      // Room hygiene: nobody left inside → stamp emptySince. The cron
      // deletes the room only after the 15-minute grace period; anyone
      // rejoining clears the stamp (see join). Never delete instantly —
      // the owner may step out briefly and come back.
      if (liveCount === 0) patch.emptySince = Date.now();
      await ctx.db.patch(args.roomId, patch);
    }
  },
});

/** Max simultaneous publishers in a stage room (owner counts as one). */
export const MAX_STAGE_PUBLISHERS = 4;

/**
 * Stage mode: the host promotes/demotes listeners to publisher.
 * The 4-publisher cap is enforced here, server-side — the UI also shows
 * the count but never decides it.
 */
export const setRole = mutation({
  args: {
    roomId: v.id("rooms"),
    actorDeviceId: v.string(),
    targetDeviceId: v.string(),
    role: v.union(v.literal("publisher"), v.literal("listener")),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found.");
    if (room.mode !== "stage") {
      throw new Error("Roles can only be changed in stage rooms.");
    }

    // Only the host may change roles.
    const actor = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.actorDeviceId)
      )
      .first();
    const isOwner =
      actor?.isOwner === true || room.ownerDeviceId === args.actorDeviceId;
    if (!isOwner) throw new Error("Only the host can change roles.");

    const target = await ctx.db
      .query("participants")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", args.roomId).eq("deviceId", args.targetDeviceId)
      )
      .first();
    if (!target) throw new Error("Participant is not in this room.");
    if (target.deviceId === room.ownerDeviceId || target.isOwner) {
      throw new Error("The host's role cannot be changed.");
    }
    if (target.role === args.role) return { ok: true as const };

    if (args.role === "publisher") {
      const now = Date.now();
      const live = await ctx.db
        .query("participants")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      const publishers = live.filter(
        (p) =>
          p.lastHeartbeat > now - HEARTBEAT_TIMEOUT_MS && p.role === "publisher"
      ).length;
      if (publishers >= MAX_STAGE_PUBLISHERS) {
        throw new Error(
          `Stage is full — max ${MAX_STAGE_PUBLISHERS} publishers at a time.`
        );
      }
    }

    await ctx.db.patch(target._id, {
      role: args.role,
      lastHeartbeat: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Cron: drop participants whose heartbeat went stale. */export const cleanupStale = internalMutation({
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
