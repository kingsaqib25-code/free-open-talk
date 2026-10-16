import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Dailymotion public API search cache.
 *
 * The Dailymotion API is keyless (no quota pressure), but results are still
 * cached per normalized query for 1 hour so repeat searches are instant —
 * same pattern as convex/youtube.ts.
 */

const CACHE_TTL_MS = 60 * 60_000; // 1 hour
const MAX_RESULTS_JSON = 60_000; // sanity cap on stored payload

function normalize(q: string): string {
  return q.trim().toLowerCase().slice(0, 100);
}

/** Cached results for a query, or null when missing/stale. */
export const searchCached = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const q = normalize(args.query);
    if (q.length < 2) return null;
    const row = await ctx.db
      .query("dmCache")
      .withIndex("by_query", (qb) => qb.eq("query", q))
      .first();
    if (!row) return null;
    if (Date.now() - row.createdAt > CACHE_TTL_MS) return null;
    try {
      return JSON.parse(row.resultsJson);
    } catch {
      return null;
    }
  },
});

/** Store search results (upsert by normalized query). */
export const saveCache = mutation({
  args: { query: v.string(), resultsJson: v.string() },
  handler: async (ctx, args) => {
    const q = normalize(args.query);
    if (q.length < 2) return { ok: false as const };
    const payload = args.resultsJson.slice(0, MAX_RESULTS_JSON);
    const existing = await ctx.db
      .query("dmCache")
      .withIndex("by_query", (qb) => qb.eq("query", q))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        resultsJson: payload,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.insert("dmCache", {
        query: q,
        resultsJson: payload,
        createdAt: Date.now(),
      });
    }
    return { ok: true as const };
  },
});

/** Housekeeping: drop cache rows older than 24h (cron safety net). */
export const cleanupOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    const rows = await ctx.db.query("dmCache").collect();
    let removed = 0;
    for (const r of rows) {
      if (r.createdAt < cutoff) {
        await ctx.db.delete(r._id);
        removed++;
      }
    }
    return removed;
  },
});
