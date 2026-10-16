'use client';

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

/** Keep in sync with MILESTONES in convex/streaks.ts. */
const MILESTONES = [7, 30, 100] as const;
type Milestone = (typeof MILESTONES)[number];

export interface UseMilestoneResult {
  /** The next milestone reached but not yet claimed (null when none). */
  pendingMilestone: Milestone | null;
  /** Claims the pending milestone. Returns true when newly claimed. */
  claim: () => Promise<boolean>;
  loading: boolean;
}

/**
 * useMilestone(deviceId) → { pendingMilestone, claim, loading }.
 * On mount (and whenever the streak row changes), checks whether the
 * device just reached an unclaimed milestone (7 / 30 / 100 days).
 */
export function useMilestone(
  deviceId: string | undefined | null
): UseMilestoneResult {
  const row = useQuery(api.streaks.get, deviceId ? { deviceId } : "skip");
  const claimMutation = useMutation(api.streaks.claimMilestone);
  const [pendingMilestone, setPendingMilestone] = useState<Milestone | null>(
    null
  );

  useEffect(() => {
    if (row === undefined) return;
    const claimed = new Set(row?.claimedMilestones ?? []);
    const streak = row?.currentStreak ?? 0;
    const next =
      MILESTONES.find((m) => streak >= m && !claimed.has(String(m))) ?? null;
    setPendingMilestone(next);
  }, [row]);

  const claim = useCallback(async () => {
    if (!deviceId || pendingMilestone === null) return false;
    const res = await claimMutation({
      deviceId,
      milestone: pendingMilestone,
    });
    if (res.claimed) setPendingMilestone(null);
    return res.claimed;
  }, [deviceId, pendingMilestone, claimMutation]);

  return { pendingMilestone, claim, loading: row === undefined };
}
