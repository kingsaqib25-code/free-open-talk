import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { HEARTBEAT_TIMEOUT_MS } from "./rooms";
import { resolveIdentity } from "./auth";

/**
 * Friend / follow system. Guest-friendly: identity = deviceId, no accounts.
 * When Google is linked, identity resolves to the stable googleSub so the
 * social graph survives across devices (see convex/auth.ts).
 * A follows B => A gets a Web Push ("🔥 {nickname} is online now") when B
 * comes online — rate-limited to 1 per 30 min per pair, skipped silently
 * when A has no push subscription. $0 infra (self-hosted Web Push).
 */

const NOTIF_RATE_LIMIT_MS = 30 * 60_000;

export const follow = mutation({
  args: {
    followerDeviceId: v.string(),
    followingDeviceId: v.string(),
    followerNickname: v.string(),
    followingNickname: v.string(),
  },
  handler: async (ctx, args) => {
    // Resolve to stable identities (googleSub when linked).
    const follower = await resolveIdentity(ctx, args.followerDeviceId);
    const following = await resolveIdentity(ctx, args.followingDeviceId);
    if (follower === following) {
      throw new Error("You can't follow yourself.");
    }
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerDeviceId", follower))
      .collect();
    if (existing.some((f) => f.followingDeviceId === following)) {
      return { alreadyFollowing: true as const };
    }
    await ctx.db.insert("follows", {
      followerDeviceId: follower,
      followingDeviceId: following,
      followerNickname: args.followerNickname.slice(0, 30),
      followingNickname: args.followingNickname.slice(0, 30),
      createdAt: Date.now(),
    });
    return { alreadyFollowing: false as const };
  },
});

export const unfollow = mutation({
  args: {
    followerDeviceId: v.string(),
    followingDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const follower = await resolveIdentity(ctx, args.followerDeviceId);
    const following = await resolveIdentity(ctx, args.followingDeviceId);
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerDeviceId", follower))
      .collect();
    for (const r of rows) {
      if (r.followingDeviceId === following) {
        await ctx.db.delete(r._id);
      }
    }
    return { ok: true as const };
  },
});

/** Everyone following this identity (for the follower list / notify fan-out). */
export const followers = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const id = await resolveIdentity(ctx, args.deviceId);
    return await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingDeviceId", id))
      .collect();
  },
});

/** Everyone this identity follows (the Friends list). */
export const following = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const id = await resolveIdentity(ctx, args.deviceId);
    return await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerDeviceId", id))
      .collect();
  },
});

export const isFollowing = query({
  args: { followerDeviceId: v.string(), followingDeviceId: v.string() },
  handler: async (ctx, args) => {
    const follower = await resolveIdentity(ctx, args.followerDeviceId);
    const followingId = await resolveIdentity(ctx, args.followingDeviceId);
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerDeviceId", follower))
      .collect();
    return rows.some((r) => r.followingDeviceId === followingId);
  },
});

/**
 * Online status for a batch of identities (drives the Friends list dots).
 * An identity is online if ANY of its linked devices has a live participant
 * row anywhere (googleSub expands to all linked deviceIds).
 */
export const onlineStatus = query({
  args: { deviceIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    const out: Record<
      string,
      { online: boolean; nickname?: string; roomId?: string }
    > = {};
    for (const id of args.deviceIds.slice(0, 100)) {
      // Expand googleSub -> all linked deviceIds; plain deviceIds stay as-is.
      const candidates = new Set<string>([id]);
      const links = await ctx.db
        .query("googleLinks")
        .withIndex("by_googleSub", (q) => q.eq("googleSub", id))
        .collect();
      for (const l of links) candidates.add(l.deviceId as string);
      let live: any = null;
      for (const deviceId of candidates) {
        const rows = await ctx.db
          .query("participants")
          .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
          .collect();
        live = rows.find((r) => r.lastHeartbeat > cutoff);
        if (live) break;
      }
      out[id] = live
        ? {
            online: true,
            nickname: live.nickname,
            roomId: live.roomId as unknown as string,
          }
        : { online: false };
    }
    return out;
  },
});

/** Internal: follower rows for fan-out (action can't filter client-side). */
export const followersInternal = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const id = await resolveIdentity(ctx, args.deviceId);
    return await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingDeviceId", id))
      .collect();
  },
});

/** Internal: stamp the rate-limit clock after a successful fan-out. */
export const touchNotif = internalMutation({
  args: { followId: v.id("follows"), at: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.followId, { lastOnlineNotifAt: args.at });
  },
});

/**
 * Fan out "X is online" pushes to followers. Scheduled (runAfter 0) from
 * presence.heartbeat / presence.join when a device comes back online.
 *
 * Needs Convex env: PUSH_SEND_SECRET (must match the Next.js route's) and
 * SITE_URL (defaults to the production URL). Without them it skips
 * silently — the app works fine, just no pushes.
 */
export const notifyOnline = internalAction({
  args: { deviceId: v.string(), nickname: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.PUSH_SEND_SECRET;
    if (!secret) return; // push not configured — skip silently
    const siteUrl =
      process.env.SITE_URL || "https://free-open-talk.vercel.app";

    const now = Date.now();
    const followers: Array<{
      _id: any;
      followerDeviceId: string;
      lastOnlineNotifAt?: number;
    }> = await ctx.runQuery(internal.follows.followersInternal, {
      deviceId: args.deviceId,
    });

    const eligible = followers.filter(
      (f) =>
        !f.lastOnlineNotifAt ||
        now - f.lastOnlineNotifAt > NOTIF_RATE_LIMIT_MS
    );
    if (eligible.length === 0) return;

    const title = `🔥 ${args.nickname.slice(0, 30)} is online now`;
    try {
      const res = await fetch(`${siteUrl}/api/push/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          deviceIds: eligible.map((f) => f.followerDeviceId),
          title,
          body: "Tap to open Free Open Talk and say salaam!",
          url: "/",
        }),
      });
      if (!res.ok) return;
    } catch {
      return; // network hiccup — skip silently, retry next online event
    }
    for (const f of eligible) {
      await ctx.runMutation(internal.follows.touchNotif, {
        followId: f._id,
        at: now,
      });
    }
  },
});
