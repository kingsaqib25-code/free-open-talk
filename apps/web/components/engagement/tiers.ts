/**
 * Engagement tiers (Phase 8). Streak days -> a warm, playful rank shown
 * across room cards, leaderboards, and the profile corner.
 */

export interface Tier {
  name: string;
  emoji: string;
  /** Minimum streak days to reach this tier. */
  min: number;
}

export const TIER_ORDER: Tier[] = [
  { name: "Newbie", emoji: "🌱", min: 0 },
  { name: "Regular", emoji: "🔥", min: 7 },
  { name: "Pro", emoji: "⭐", min: 30 },
  { name: "Legend", emoji: "👑", min: 90 },
];

export function tierForStreak(days: number): Tier {
  const d = Math.max(0, Math.floor(days));
  let tier = TIER_ORDER[0];
  for (const t of TIER_ORDER) {
    if (d >= t.min) tier = t;
  }
  return tier;
}
