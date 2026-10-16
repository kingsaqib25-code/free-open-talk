'use client';

import { useEffect, useRef, useState } from "react";

interface ConfettiPiece {
  id: number;
  left: number; // %
  delay: number; // s
  duration: number; // s
  size: number; // px
  color: string;
  round: boolean;
}

/** Warm palette only — matches the orange/amber theme. */
const COLORS = [
  "#f97316",
  "#f59e0b",
  "#fbbf24",
  "#fde047",
  "#fb923c",
  "#fdba74",
  "#fff7ed",
];

function makePieces(n: number): ConfettiPiece[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.6 + Math.random() * 1.2,
    size: 6 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() > 0.6,
  }));
}

/**
 * Canvas-free CSS confetti burst. Fires once per `burstKey` change
 * (ignore key 0 — the initial mount). pointer-events-none, self-cleaning.
 */
export default function ConfettiBurst({ burstKey }: { burstKey: number }) {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (burstKey <= 0) return;
    const batch = makePieces(42);
    setPieces(batch);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPieces([]), 3400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [burstKey]);

  if (pieces.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[60] overflow-hidden"
    >
      <style>{`
        @keyframes talkfree-confetti-fall {
          0% { transform: translateY(-4vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(60vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: p.round ? "50%" : "1px",
            animation: `talkfree-confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}
