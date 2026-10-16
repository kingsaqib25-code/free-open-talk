export interface ReactionEvent {
  /** Unique id per event (e.g. `${fromDeviceId}-${Date.now()}`). */
  id: string;
  emoji: string;
  /** Horizontal position in percent (0–100). */
  x: number;
}

/**
 * Full-area overlay rendering floating emoji bubbles that drift upward and
 * fade. Render it as the LAST sibling inside the room / screen-share /
 * watch-player container so it floats over everything (z-50,
 * pointer-events-none — never blocks taps).
 *
 * The parent feeds `events` (from 'reaction' signals) and removes each
 * event after ~2s (the animation length) so the DOM stays tiny.
 */
export default function ReactionOverlay({
  events,
}: {
  events: ReactionEvent[];
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
    >
      <style>{`
        @keyframes talkfree-reaction-float {
          0% { transform: translateY(0) scale(0.5); opacity: 0; }
          12% { opacity: 1; transform: translateY(-28px) scale(1.15); }
          70% { opacity: 1; }
          100% { transform: translateY(-46vh) scale(1); opacity: 0; }
        }
      `}</style>
      {events.map((e) => (
        <span
          key={e.id}
          className="absolute bottom-20 select-none text-3xl"
          style={{
            left: `${Math.min(90, Math.max(5, e.x))}%`,
            animation: "talkfree-reaction-float 1.8s ease-out forwards",
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
          }}
        >
          {e.emoji}
        </span>
      ))}
    </div>
  );
}
