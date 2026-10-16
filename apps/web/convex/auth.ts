import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Google Sign In (one-tap, GIS). Guest-first: linking is purely additive.
 *
 * Identity model:
 * - Guests are identified by deviceId (random per browser, localStorage).
 * - When a guest links Google, their deviceId maps to a stable googleSub.
 * - follows / streaks / friends resolve through resolveIdentity(), so a
 *   user's social graph and streaks survive across their devices.
 * - Unlinking keeps the googleSub-keyed rows (they re-attach on re-link);
 *   the device simply falls back to its deviceId identity.
 */

/** deviceId -> stable identity (googleSub when linked, else deviceId). */
export async function resolveIdentity(
  ctx: any,
  deviceId: string
): Promise<string> {
  if (!deviceId || deviceId === "ssr") return deviceId;
  const link = await ctx.db
    .query("googleLinks")
    .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
    .first();
  return link ? (link.googleSub as string) : deviceId;
}

export const getLink = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    if (!args.deviceId || args.deviceId === "ssr") return null;
    const link = await ctx.db
      .query("googleLinks")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    return link ?? null;
  },
});

/**
 * Link a guest device to a Google identity. Migrates follows + streaks from
 * the deviceId to the googleSub so nothing is lost across devices.
 * NOTE: the ID token is verified client-side by Google's GIS button flow;
 * this mutation trusts the sub the client reports (same trust level as the
 * guest deviceId itself — guests are self-asserted identities).
 */
export const linkGoogle = mutation({
  args: {
    deviceId: v.string(),
    googleSub: v.string(),
    email: v.string(),
    name: v.string(),
    picture: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sub = args.googleSub.slice(0, 128);
    const deviceId = args.deviceId.slice(0, 128);

    // Upsert the link (one row per device).
    const existing = await ctx.db
      .query("googleLinks")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        googleSub: sub,
        email: args.email.slice(0, 120),
        name: args.name.slice(0, 60),
        picture: args.picture?.slice(0, 500),
        linkedAt: now,
      });
    } else {
      await ctx.db.insert("googleLinks", {
        deviceId,
        googleSub: sub,
        email: args.email.slice(0, 120),
        name: args.name.slice(0, 60),
        picture: args.picture?.slice(0, 500),
        linkedAt: now,
      });
    }

    // Migrate follows: deviceId -> googleSub (both directions).
    const asFollower = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerDeviceId", deviceId))
      .collect();
    for (const f of asFollower) {
      // Avoid creating a self-follow or duplicate after migration.
      const dup = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerDeviceId", sub))
        .collect();
      if (
        f.followingDeviceId === sub ||
        dup.some((d: any) => d.followingDeviceId === f.followingDeviceId)
      ) {
        await ctx.db.delete(f._id);
      } else {
        await ctx.db.patch(f._id, { followerDeviceId: sub });
      }
    }
    const asFollowing = await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingDeviceId", deviceId))
      .collect();
    for (const f of asFollowing) {
      const dup = await ctx.db
        .query("follows")
        .withIndex("by_following", (q) => q.eq("followingDeviceId", sub))
        .collect();
      if (
        f.followerDeviceId === sub ||
        dup.some((d: any) => d.followerDeviceId === f.followerDeviceId)
      ) {
        await ctx.db.delete(f._id);
      } else {
        await ctx.db.patch(f._id, { followingDeviceId: sub });
      }
    }

    // Migrate streaks: merge the device row into the googleSub row.
    const devRow: any = await ctx.db
      .query("streaks")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (devRow) {
      const subRow: any = await ctx.db
        .query("streaks")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", sub))
        .first();
      if (subRow && subRow._id !== devRow._id) {
        await ctx.db.patch(subRow._id, {
          currentStreak: Math.max(
            subRow.currentStreak ?? 0,
            devRow.currentStreak ?? 0
          ),
          longestStreak: Math.max(
            subRow.longestStreak ?? 0,
            devRow.longestStreak ?? 0
          ),
          totalMinutes: (subRow.totalMinutes ?? 0) + (devRow.totalMinutes ?? 0),
          nickname: devRow.nickname || subRow.nickname,
        });
        await ctx.db.delete(devRow._id);
      } else if (!subRow) {
        await ctx.db.patch(devRow._id, { deviceId: sub });
      }
    }

    return { ok: true as const, identity: sub };
  },
});

/** Unlink Google from this device. Social rows stay under googleSub. */
export const unlinkGoogle = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("googleLinks")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (link) await ctx.db.delete(link._id);
    return { ok: true as const };
  },
});
