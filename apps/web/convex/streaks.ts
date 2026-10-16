import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Daily visit streaks (Phase 8 — engagement & delight). $0 infra: rows are
 * tiny, one per deviceId, and writes are minute-bucket guarded.
 *
 * Rules:
 * - A calendar day counts once the device accrues >= STREAK_DAY_MINUTES
 *   (10) active minutes that day.
 * - Consecutive counted calendar days grow currentStreak; a missed day
 *   resets it to 1 (not 0 — the new day itself just became the streak).
 * - longestStreak tracks the all-time best; totalMinutes accumulates forever.
 * - Milestones (7 / 30 / 100 days) are claimed once each via claimMilestone.
 *
 * Minutes can arrive two ways:
 * 1. recordMinutes() — explicit deltas (e.g. end-of-session accounting).
 * 2. accrueStreakHeartbeat() — called from presence.heartbeat; accrues from
 *    heartbeat gaps so streaks grow even without a clean "leave".
 */

export const MILESTONES = [7, 30, 100] as const;
/** Active minutes a calendar day needs before it counts toward a streak. */
export const STREAK_DAY_MINUTES = 10;
/** Heartbeat gaps longer than this are treated as idle (tab closed/asleep). */
const MAX_HEARTBEAT_GAP_MIN = 10;

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function rowByDeviceId(ctx: any, deviceId: string) {
  return await ctx.db
    .query("streaks")
    .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
    .first();
}

/**
 * Build the patch for accruing `addedMinutes` on `day`, handling day
 * rollover and the 10-minute "day counts" threshold. Pure — callers write.
 */
function accrualPatch(row: any, nickname: string, day: string, addedMinutes: number) {
  const patch: Record<string, number | string | boolean | string[]> = {};

  // New calendar day: roll the per-day counter over.
  let dayMinutes = row.dayMinutes ?? 0;
  let dayCounted = row.dayCounted ?? false;
  if (row.lastVisitDay !== day) {
    dayMinutes = 0;
    dayCounted = false;
    patch.lastVisitDay = day;
  }

  dayMinutes += addedMinutes;
  patch.dayMinutes = dayMinutes;
  patch.totalMinutes = (row.totalMinutes ?? 0) + addedMinutes;
  if (nickname && nickname !== row.nickname) {
    patch.nickname = nickname.slice(0, 30);
  }

  if (!dayCounted && dayMinutes >= STREAK_DAY_MINUTES) {
    patch.dayCounted = true;
    const continued = (row.lastCountedDay ?? "") === previousDay(day);
    const currentStreak = continued ? (row.currentStreak ?? 0) + 1 : 1;
    patch.currentStreak = currentStreak;
    patch.longestStreak = Math.max(row.longestStreak ?? 0, currentStreak);
    patch.lastCountedDay = day;
  }
  return patch;
}

/**
 * Cheap streak accounting for presence.heartbeat — accrues minutes from
 * heartbeat gaps per device. Only touches the streaks row when the minute
 * bucket actually changes (lastStreakWriteAt guards write spam); otherwise
 * it just moves the heartbeat cursor forward.
 */
export async function accrueStreakHeartbeat(
  ctx: any,
  deviceId: string,
  nickname: string,
  now: number
) {
  const day = dayString(now);
  const row = await rowByDeviceId(ctx, deviceId);
  if (!row) {
    await ctx.db.insert("streaks", {
      deviceId,
      nickname: nickname.slice(0, 30),
      currentStreak: 0,
      longestStreak: 0,
      lastVisitDay: day,
      totalMinutes: 0,
      claimedMilestones: [],
      dayMinutes: 0,
      dayCounted: false,
      lastStreakHeartbeatAt: now,
      lastStreakWriteAt: 0,
    });
    return;
  }

  const last = row.lastStreakHeartbeatAt ?? now;
  let gapMinutes = (now - last) / 60000;
  if (gapMinutes < 0 || gapMinutes > MAX_HEARTBEAT_GAP_MIN) gapMinutes = 0;

  const rolled = row.lastVisitDay !== day;
  const baseMinutes = rolled ? 0 : (row.dayMinutes ?? 0);
  const newDayMinutes = baseMinutes + gapMinutes;
  const bucketChanged =
    rolled ||
    Math.floor(newDayMinutes) !== Math.floor(row.lastStreakWriteAt ?? 0);

  if (bucketChanged) {
    const patch = accrualPatch(row, nickname, day, gapMinutes);
    patch.lastStreakHeartbeatAt = now;
    patch.lastStreakWriteAt = newDayMinutes;
    await ctx.db.patch(row._id, patch);
  } else {
    await ctx.db.patch(row._id, { lastStreakHeartbeatAt: now });
  }
}

/** One device's streak row (null when the device never visited). */
export const get = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await rowByDeviceId(ctx, args.deviceId);
  },
});

/**
 * Explicit minute recording (e.g. end-of-session accounting from the
 * client). `day` defaults to today (server time).
 */
export const recordMinutes = mutation({
  args: {
    deviceId: v.string(),
    nickname: v.string(),
    day: v.optional(v.string()),
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const minutes = Math.max(0, Math.min(1440, args.minutes));
    const day = args.day ?? dayString(Date.now());
    const now = Date.now();
    let row: any = await rowByDeviceId(ctx, args.deviceId);
    if (!row) {
      const id = await ctx.db.insert("streaks", {
        deviceId: args.deviceId,
        nickname: args.nickname.slice(0, 30),
        currentStreak: 0,
        longestStreak: 0,
        lastVisitDay: day,
        totalMinutes: 0,
        claimedMilestones: [],
        dayMinutes: 0,
        dayCounted: false,
        lastStreakHeartbeatAt: now,
        lastStreakWriteAt: 0,
      });
      row = await ctx.db.get(id);
    }
    const patch = accrualPatch(row, args.nickname, day, minutes);
    patch.lastStreakWriteAt = (row!.dayMinutes ?? 0) + minutes;
    await ctx.db.patch(row!._id, patch);
    const updated: any = await ctx.db.get(row!._id);
    return {
      currentStreak: updated!.currentStreak,
      dayMinutes: updated!.dayMinutes ?? 0,
      dayCounted: updated!.dayCounted ?? false,
    };
  },
});

/** Top 10 devices by currentStreak, ties broken by totalMinutes. */
export const leaderboard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("streaks").collect();
    return rows
      .sort((a, b) => {
        if (b.currentStreak !== a.currentStreak)
          return b.currentStreak - a.currentStreak;
        return b.totalMinutes - a.totalMinutes;
      })
      .slice(0, 10)
      .map((r) => ({
        deviceId: r.deviceId,
        nickname: r.nickname,
        currentStreak: r.currentStreak,
        longestStreak: r.longestStreak,
        totalMinutes: r.totalMinutes,
      }));
  },
});

/**
 * Claim a streak milestone (7 / 30 / 100). Returns whether this claim was
 * newly granted (idempotent — a milestone can only be claimed once).
 */
export const claimMilestone = mutation({
  args: { deviceId: v.string(), milestone: v.number() },
  handler: async (ctx, args) => {
    if (!(MILESTONES as readonly number[]).includes(args.milestone)) {
      throw new Error("Unknown milestone.");
    }
    const row = await rowByDeviceId(ctx, args.deviceId);
    if (!row) return { claimed: false as const };
    const key = String(args.milestone);
    if (row.currentStreak < args.milestone) return { claimed: false as const };
    if (row.claimedMilestones.includes(key)) return { claimed: false as const };
    await ctx.db.patch(row._id, {
      claimedMilestones: [...row.claimedMilestones, key],
    });
    return { claimed: true as const, milestone: args.milestone };
  },
});

/** A device's current streak — used on room cards ("Hosted X days in a row"). */
export const hostStreak = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const row = await rowByDeviceId(ctx, args.deviceId);
    return row?.currentStreak ?? 0;
  },
});
