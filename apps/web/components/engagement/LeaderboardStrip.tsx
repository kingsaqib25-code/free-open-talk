'use client';

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import TierBadge from "./TierBadge";

/**
 * Horizontal scroll strip: "Most active this week 🔥" — the top streaks
 * from streaks.leaderboard(), each row wearing its TierBadge.
 * Display only: rows are not interactive.
 */
export default function LeaderboardStrip() {
  const rows = useQuery(api.streaks.leaderboard);

  if (rows === undefined) {
    return (
      <div className="flex gap-3 overflow-hidden py-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 w-40 shrink-0 animate-pulse rounded-xl bg-surface-hover"
          />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <section aria-label="Most active this week">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">
        Most active this week <span aria-hidden>🔥</span>
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {rows.map((r, i) => (
          <div
            key={r.deviceId}
            className="flex w-44 shrink-0 flex-col gap-1.5 rounded-xl border border-surface-border bg-surface-default p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-tertiary">
                #{i + 1}
              </span>
              <TierBadge streak={r.currentStreak} size="sm" />
            </div>
            <span className="truncate text-sm font-medium text-text-primary">
              {r.nickname}
            </span>
            <span className="text-xs text-text-secondary">
              {r.currentStreak} day{r.currentStreak === 1 ? "" : "s"} in a row
              <span aria-hidden> 🔥</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
