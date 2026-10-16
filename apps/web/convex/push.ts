import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Web Push subscriptions (PWA). Browsers subscribe after the user opts in;
 * VAPID keys live in env (PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY),
 * never in code. Sending happens through the Next.js /api/push/send route.
 */

export const subscribe = mutation({
  args: {
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        deviceId: args.deviceId,
        p256dh: args.p256dh,
        auth: args.auth,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      deviceId: args.deviceId,
      endpoint: args.endpoint.slice(0, 500),
      p256dh: args.p256dh.slice(0, 200),
      auth: args.auth.slice(0, 100),
      createdAt: Date.now(),
    });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Subscriptions for devices, minus the requester's own (for mentions). */
export const forDevices = query({
  args: { deviceIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out: Array<{
      endpoint: string;
      p256dh: string;
      auth: string;
      deviceId: string;
    }> = [];
    for (const deviceId of args.deviceIds.slice(0, 50)) {
      const subs = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
        .collect();
      for (const s of subs) {
        out.push({
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
          deviceId: s.deviceId,
        });
      }
    }
    return out;
  },
});
