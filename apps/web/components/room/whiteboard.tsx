'use client';

/**
 * Collaborative whiteboard — the in-room "advanced" app.
 *
 * Strokes live in the Convex `whiteboard` table; every participant
 * subscribes reactively so drawings appear live for everyone.
 * Coordinates are normalized 0..1000 so strokes render on any canvas
 * size. The server keeps the latest 300 strokes per room.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Trash2, Check, AlertCircle } from '@/components/ui/icons';
import { cn } from '@/lib/design-system';
import { setMyActivity, clearMyActivity } from '@/lib/activity';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

// Warm palette only: orange/amber/reds/browns + black + white.
const PALETTE = [
  '#171717', // black
  '#f97316', // orange
  '#f59e0b', // amber
  '#ef4444', // red
  '#f43f5e', // rose
  '#fde047', // yellow
  '#92400e', // brown
  '#ffffff', // white
];

const BRUSH_WIDTHS = [4, 10, 18];
const ERASER_COLOR = '#ffffff';

export function Whiteboard({
  roomId,
  deviceId,
}: {
  roomId: string;
  deviceId: string;
}) {
  const rid = roomId as Id<'rooms'>;
  const strokes = useQuery(api.roomapps.getStrokes, { roomId: rid });
  const addStrokeMut = useMutation(api.roomapps.addStroke);
  const clearMut = useMutation(api.roomapps.clearWhiteboard);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const localStrokeRef = useRef<Stroke | null>(null);

  const [color, setColor] = useState('#f97316');
  const [brushWidth, setBrushWidth] = useState(BRUSH_WIDTHS[1]);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Activity presence: whiteboard open → 'whiteboard', closed → clear.
  useEffect(() => {
    setMyActivity('whiteboard', undefined, 'whiteboard');
    return () => clearMyActivity('whiteboard');
  }, []);

  const drawStroke = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      stroke: Stroke,
      w: number,
      h: number
    ) => {
      const pts = stroke.points;
      if (pts.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(1, (stroke.width * w) / 1000);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo((pts[0].x * w) / 1000, (pts[0].y * h) / 1000);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo((pts[i].x * w) / 1000, (pts[i].y * h) / 1000);
      }
      ctx.stroke();
    },
    []
  );

  /** Repaint everything: remote strokes + the in-progress local stroke. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of strokes ?? []) {
      drawStroke(ctx, s as Stroke, w, h);
    }
    if (localStrokeRef.current) {
      drawStroke(ctx, localStrokeRef.current, w, h);
    }
  }, [strokes, drawStroke]);

  useEffect(() => {
    repaint();
  }, [repaint]);

  // Repaint on container resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => repaint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [repaint]);

  const pointFromEvent = useCallback((e: React.PointerEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1000, Math.max(0, ((e.clientX - rect.left) / rect.width) * 1000)),
      y: Math.min(1000, Math.max(0, ((e.clientY - rect.top) / rect.height) * 1000)),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const pt = pointFromEvent(e);
      if (!pt) return;
      drawingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      localStrokeRef.current = { points: [pt], color, width: brushWidth };
      repaint();
    },
    [pointFromEvent, color, brushWidth, repaint]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const pt = pointFromEvent(e);
      if (!pt) return;
      const s = localStrokeRef.current;
      if (!s) return;
      const last = s.points[s.points.length - 1];
      // Drop near-duplicate points to keep payloads small.
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy < 4) return;
      s.points.push(pt);
      if (s.points.length <= 2000) repaint();
    },
    [pointFromEvent, repaint]
  );

  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const s = localStrokeRef.current;
    localStrokeRef.current = null;
    repaint();
    if (s && s.points.length >= 2) {
      addStrokeMut({
        roomId: rid,
        deviceId,
        points: s.points,
        color: s.color,
        width: s.width,
      }).catch(() => {
        /* write failed — remote view simply won't show it */
      });
    }
  }, [addStrokeMut, rid, deviceId, repaint]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    setClearError(null);
    try {
      await clearMut({ roomId: rid, deviceId });
    } catch (err) {
      setClearError(
        err instanceof Error ? err.message : 'Could not clear the board.'
      );
      setTimeout(() => setClearError(null), 4000);
    } finally {
      setClearing(false);
    }
  }, [clearMut, rid, deviceId]);

  const toggleEraser = useCallback(() => {
    setColor((c) => (c === ERASER_COLOR ? '#f97316' : ERASER_COLOR));
  }, []);

  const isEraser = color === ERASER_COLOR;

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full bg-amber-100/60 p-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Brush color ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform',
                color === c
                  ? 'scale-110 border-orange-500'
                  : 'border-black/10 hover:scale-105'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full bg-amber-100/60 p-1">
          {BRUSH_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`Brush width ${w}`}
              onClick={() => setBrushWidth(w)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                brushWidth === w
                  ? 'bg-orange-500 text-white'
                  : 'text-amber-900 hover:bg-amber-200/70'
              )}
            >
              <span
                className="rounded-full bg-current"
                style={{
                  width: Math.max(3, w / 2.5),
                  height: Math.max(3, w / 2.5),
                }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleEraser}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            isEraser
              ? 'bg-orange-500 text-white'
              : 'bg-amber-100/60 text-amber-900 hover:bg-amber-200/70'
          )}
        >
          Eraser
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50"
        >
          <Trash2 size="xs" />
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      </div>

      {clearError && (
        <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          <AlertCircle size="xs" />
          {clearError}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={wrapRef}
        className="relative flex-1 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-inner"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
        />
        {strokes === undefined && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-700">
            Loading board…
          </div>
        )}
        {strokes && strokes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-amber-400">
              Draw something — everyone in the room sees it live
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
        <Check size="xs" />
        <span>
          {(strokes ?? []).length} stroke{(strokes ?? []).length === 1 ? '' : 's'}
          {' '}· the host can clear the board
        </span>
      </div>
    </div>
  );
}
