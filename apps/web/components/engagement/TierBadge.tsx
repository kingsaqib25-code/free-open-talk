import { tierForStreak } from "./tiers";

/**
 * Small warm-themed pill showing a user's engagement tier.
 * e.g. "🔥 Regular". Sizes: sm | md | lg.
 */
export default function TierBadge({
  streak,
  size = "md",
}: {
  streak: number;
  size?: "sm" | "md" | "lg";
}) {
  const tier = tierForStreak(streak);
  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2.5 py-1 gap-1.5",
    lg: "text-sm px-3.5 py-1.5 gap-2",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-primary-500/30 bg-gradient-to-r from-primary-500/20 to-secondary-500/20 font-semibold text-text-primary ${sizes[size]}`}
      title={`${streak} day streak`}
    >
      <span aria-hidden>{tier.emoji}</span>
      <span>{tier.name}</span>
    </span>
  );
}
