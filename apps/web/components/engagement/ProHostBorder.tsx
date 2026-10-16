import type { ReactNode } from "react";

/**
 * Wrapper adding a tasteful rotating conic-gradient border
 * (orange → amber → yellow → orange, ~3s per rotation) around children.
 * Used for "pro host" spotlight treatment on room cards / stage tiles.
 */
export default function ProHostBorder({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`talkfree-pro-border ${className}`}>
      <style>{`
        @property --talkfree-border-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes talkfree-border-spin {
          to { --talkfree-border-angle: 360deg; }
        }
        .talkfree-pro-border {
          position: relative;
          border-radius: 1rem;
          padding: 2px;
          background: conic-gradient(
            from var(--talkfree-border-angle),
            #f97316, #fbbf24, #fde047, #f59e0b, #f97316
          );
          animation: talkfree-border-spin 3s linear infinite;
        }
      `}</style>
      <div className="h-full w-full overflow-hidden rounded-[calc(1rem-2px)] bg-surface-default">
        {children}
      </div>
    </div>
  );
}
