import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Room Apps backend — whiteboard, tic-tac-toe, shared notepad.
 * Guest flows (deviceId, no auth). $0 infra: small tables, capped writes,
 * deletions keep growth bounded.
 */

const MAX_WHITEBOARD_STROKES = 300;
const MAX_STROKE_POINTS = 2000;
const MAX_NOTEPAD_CHARS = 5000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function nicknameFor(
  ctx: any,
  roomId: any,
  deviceId: string
): Promise<string> {
  const p = await ctx.db
    .query("participants")
    .withIndex("by_room_device", (q: any) =>
      q.eq("roomId", roomId).eq("deviceId", deviceId)
    )
    .first();
  return p?.nickname ?? "Guest";
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function computeWinner(board: string[]): "" | "X" | "O" | "draw" {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as "X" | "O";
    }
  }
  return board.every((cell) => cell !== "") ? "draw" : "";
}

/* ------------------------------------------------------------------ */
/* Whiteboard                                                          */
/* ------------------------------------------------------------------ */

/** Latest strokes for a room (capped at 300, oldest first). */
export const getStrokes = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("whiteboard")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("asc")
      .take(MAX_WHITEBOARD_STROKES);
  },
});

/** Add one finished stroke. Points are normalized 0..1000. */
export const addStroke = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    points: v.array(v.object({ x: v.number(), y: v.number() })),
    color: v.string(),
    width: v.number(),
  },
  handler: async (ctx, args) => {
    const points = args.points
      .slice(0, MAX_STROKE_POINTS)
      .map((p) => ({
        x: Math.min(1000, Math.max(0, p.x)),
        y: Math.min(1000, Math.max(0, p.y)),
      }));
    if (points.length < 2) return; // ignore taps / empty strokes
    const nickname = await nicknameFor(ctx, args.roomId, args.deviceId);
    await ctx.db.insert("whiteboard", {
      roomId: args.roomId,
      deviceId: args.deviceId,
      nickname,
      points,
      color: args.color.slice(0, 16),
      width: Math.min(60, Math.max(1, args.width)),
      createdAt: Date.now(),
    });
    // Cap: keep only the latest 300 strokes per room.
    const strokes = await ctx.db
      .query("whiteboard")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("asc")
      .collect();
    const excess = strokes.length - MAX_WHITEBOARD_STROKES;
    if (excess > 0) {
      for (const s of strokes.slice(0, excess)) {
        await ctx.db.delete(s._id);
      }
    }
  },
});

/** Host-only wipe of the room's whiteboard. */
export const clearWhiteboard = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found.");
    if (room.ownerDeviceId !== args.deviceId) {
      throw new Error("Only the host can clear the whiteboard.");
    }
    const strokes = await ctx.db
      .query("whiteboard")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const s of strokes) {
      await ctx.db.delete(s._id);
    }
  },
});

/* ------------------------------------------------------------------ */
/* Tic-tac-toe                                                         */
/* ------------------------------------------------------------------ */

/** Current game state for a room (null if no game yet). */
export const getGame = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tictactoe")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
  },
});

/** Join the game: first device becomes X, second becomes O, rest spectate. */
export const joinGame = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    let game = await ctx.db
      .query("tictactoe")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!game) {
      await ctx.db.insert("tictactoe", {
        roomId: args.roomId,
        board: ["", "", "", "", "", "", "", "", ""],
        turn: "X",
        playerX: args.deviceId,
        playerO: undefined,
        winner: "",
        updatedAt: Date.now(),
      });
      return "X" as const;
    }
    if (game.playerX === args.deviceId) return "X" as const;
    if (game.playerO === args.deviceId) return "O" as const;
    if (!game.playerX) {
      await ctx.db.patch(game._id, { playerX: args.deviceId, updatedAt: Date.now() });
      return "X" as const;
    }
    if (!game.playerO) {
      await ctx.db.patch(game._id, { playerO: args.deviceId, updatedAt: Date.now() });
      return "O" as const;
    }
    return null; // spectating
  },
});

/** Play a move (validates turn, emptiness, and no finished game). */
export const move = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    idx: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db
      .query("tictactoe")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!game) throw new Error("No game in this room yet — join first.");
    if (game.winner) throw new Error("Game is over. Start a new one.");
    if (args.idx < 0 || args.idx > 8) throw new Error("Bad cell.");
    if (game.board[args.idx] !== "") throw new Error("Cell is taken.");

    const myMark =
      game.playerX === args.deviceId ? "X" : game.playerO === args.deviceId ? "O" : null;
    if (!myMark) throw new Error("You are spectating this game.");
    if (game.turn !== myMark) throw new Error("Not your turn.");

    const board = [...game.board];
    board[args.idx] = myMark;
    const winner = computeWinner(board);
    await ctx.db.patch(game._id, {
      board,
      turn: myMark === "X" ? "O" : "X",
      winner,
      updatedAt: Date.now(),
    });
  },
});

/** Reset the board; players keep their seats. */
export const resetGame = mutation({
  args: { roomId: v.id("rooms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const game = await ctx.db
      .query("tictactoe")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!game) throw new Error("No game in this room yet.");
    const isPlayer =
      game.playerX === args.deviceId || game.playerO === args.deviceId;
    const room = await ctx.db.get(args.roomId);
    const isHost = room?.ownerDeviceId === args.deviceId;
    if (!isPlayer && !isHost) {
      throw new Error("Only a player or the host can reset the game.");
    }
    await ctx.db.patch(game._id, {
      board: ["", "", "", "", "", "", "", "", ""],
      turn: "X",
      winner: "",
      updatedAt: Date.now(),
    });
  },
});

/* ------------------------------------------------------------------ */
/* Notepad                                                             */
/* ------------------------------------------------------------------ */

/** Current shared text for a room (null if never written). */
export const getNotepad = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notepad")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
  },
});

/** Last-write-wins; capped at 5000 chars. Upserts the single row per room. */
export const setText = mutation({
  args: {
    roomId: v.id("rooms"),
    deviceId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const text = args.text.slice(0, MAX_NOTEPAD_CHARS);
    const existing = await ctx.db
      .query("notepad")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        text,
        updatedAt: Date.now(),
        byDeviceId: args.deviceId,
      });
    } else {
      await ctx.db.insert("notepad", {
        roomId: args.roomId,
        text,
        updatedAt: Date.now(),
        byDeviceId: args.deviceId,
      });
    }
  },
});
