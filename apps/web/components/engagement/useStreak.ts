'use client';

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { tierForStreak, type Tier } from "./tiers";

/**
 * useStreak(deviceId) → { streak, longest, totalMinutes, tier, loading }
 * Reads the device's streak row reactively (updates as heartbeats accrue).
 */
export function useStreak(deviceId: string | undefined | null) {
  const row = useQuery(
    api.streaks.get,
    deviceId ? { deviceId } : "skip"
  );

  const streak = row?.currentStreak ?? 0;
  const tier: Tier = tierForStreak(streak);

  return {
    streak,
    longest: row?.longestStreak ?? 0,
    totalMinutes: row?.totalMinutes ?? 0,
    tier,
    loading: row === undefined,
  };
}
