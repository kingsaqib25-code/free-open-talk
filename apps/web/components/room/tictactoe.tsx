'use client';

/**
 * Tic-tac-toe — synced, cheap, fun.
 *
 * One row per room in the Convex `tictactoe` table. First joiner plays
 * X, second plays O, everyone else spectates live. Moves are validated
 * server-side (turn, emptiness, no finished game).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { RefreshCw, Users, AlertCircle, Loader2 } from '@/components/ui/icons';
import { cn } from '@/lib/design-system';
import { setMyActivity, clearMyActivity } from '@/lib/activity';

type Mark = 'X' | 'O';
type Seat = Mark | null;

export function TicTacToe({
  roomId,
  deviceId,
}: {
  roomId: string;
  deviceId: string;
}) {
  const rid = roomId as Id<'rooms'>;
  const game = useQuery(api.roomapps.getGame, { roomId: rid });
  const room = useQuery(api.rooms.get, { roomId: rid });
  const joinMut = useMutation(api.roomapps.joinGame);
  const moveMut = useMutation(api.roomapps.move);
  const resetMut = useMutation(api.roomapps.resetGame);

  const joinedRef = useRef(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<number | null>(null);

  // Join exactly once per mount (idempotent server-side).
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    joinMut({ roomId: rid, deviceId }).catch((err) => {
      setJoinError(
        err instanceof Error ? err.message : 'Could not join the game.'
      );
    });
  }, [joinMut, rid, deviceId]);

  const flashActionError = useCallback((err: unknown) => {
    setActionError(
      err instanceof Error ? err.message : 'Something went wrong.'
    );
    setTimeout(() => setActionError(null), 3000);
  }, []);

  const handleMove = useCallback(
    async (idx: number) => {
      if (busyCell !== null) return;
      setBusyCell(idx);
      try {
        await moveMut({ roomId: rid, deviceId, idx });
      } catch (err) {
        flashActionError(err);
      } finally {
        setBusyCell(null);
      }
    },
    [moveMut, rid, deviceId, busyCell, flashActionError]
  );

  const handleReset = useCallback(async () => {
    try {
      await resetMut({ roomId: rid, deviceId });
    } catch (err) {
      flashActionError(err);
    }
  }, [resetMut, rid, deviceId, flashActionError]);

  const mySeat: Seat =
    !game
      ? null
      : game.playerX === deviceId
        ? 'X'
        : game.playerO === deviceId
          ? 'O'
          : null;

  const winner = game?.winner ?? '';
  const isDraw = winner === 'draw';
  const gameOver = winner !== '';
  const myTurn =
    !gameOver && game && mySeat !== null && game.turn === mySeat;

  // Activity presence: live game as a player → 'gaming'. Spectators,
  // finished games, and unmounts clear it.
  useEffect(() => {
    if (mySeat !== null && !gameOver) {
      setMyActivity('gaming', undefined, 'game');
    } else {
      clearMyActivity('game');
    }
    return () => clearMyActivity('game');
  }, [mySeat, gameOver]);

  const canReset =
    mySeat !== null || room?.ownerDeviceId === deviceId;

  const statusText = !game
    ? 'Joining…'
    : gameOver
      ? isDraw
        ? "It's a draw!"
        : winner === mySeat
          ? 'You win!'
          : `${winner} wins!`
      : mySeat === null
        ? `Spectating · ${game.turn}'s turn`
        : myTurn
          ? 'Your turn'
          : `${game.turn}'s turn`;

  return (
    <div className="flex h-full flex-col items-center gap-3 py-2">
      {/* Status */}
      <div className="flex flex-col items-center gap-1">
        <div
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-bold',
            gameOver
              ? isDraw
                ? 'bg-amber-100 text-amber-900'
                : 'bg-orange-500 text-white'
              : myTurn
                ? 'bg-orange-500 text-white'
                : 'bg-amber-100 text-amber-900'
          )}
        >
          {statusText}
        </div>
        <div className="flex items-center gap-2 text-xs text-amber-700">
          {mySeat ? (
            <span>
              You are <strong>{mySeat}</strong>
            </span>
          ) : game ? (
            <span className="inline-flex items-center gap-1">
              <Users size="xs" /> Spectating
            </span>
          ) : null}
        </div>
      </div>

      {/* Board */}
      <div className="grid w-full max-w-[280px] grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, idx) => {
          const mark = game?.board?.[idx] ?? '';
          const playable =
            !!game &&
            !gameOver &&
            myTurn &&
            mark === '' &&
            busyCell === null;
          return (
            <button
              key={idx}
              type="button"
              aria-label={`Cell ${idx + 1}${mark ? `, ${mark}` : ''}`}
              disabled={!playable}
              onClick={() => handleMove(idx)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-2xl border text-5xl font-black transition-all',
                mark === 'X'
                  ? 'border-orange-300 bg-orange-50 text-orange-500'
                  : mark === 'O'
                    ? 'border-amber-300 bg-amber-50 text-amber-600'
                    : 'border-amber-200 bg-white text-amber-200',
                playable && 'cursor-pointer hover:scale-105 hover:bg-orange-50'
              )}
            >
              {busyCell === idx ? (
                <Loader2 size="md" className="animate-spin text-orange-500" />
              ) : (
                mark
              )}
            </button>
          );
        })}
      </div>

      {/* Winner banner + play again */}
      {gameOver && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold text-amber-900">
            {isDraw
              ? 'Nobody takes this one — good game!'
              : winner === mySeat
                ? 'Nice work! Rematch?'
                : `${winner} takes the round. Rematch?`}
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-orange-600"
          >
            <RefreshCw size="sm" />
            Play again
          </button>
        </div>
      )}

      {/* Fresh-board reset (players or host) */}
      {!gameOver && canReset && (
        <button
          type="button"
          onClick={handleReset}
          className="text-xs font-medium text-amber-600 underline-offset-2 hover:underline"
        >
          Reset board
        </button>
      )}

      {(joinError || actionError) && (
        <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          <AlertCircle size="xs" />
          {joinError ?? actionError}
        </div>
      )}
    </div>
  );
}
