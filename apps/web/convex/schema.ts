import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * talkfree Convex schema — $0/month backend.
 * Replaces: Express + Postgres(Drizzle) + Redis + Socket.io server.
 * Voice/video itself is P2P (browser-to-browser); Convex only carries
 * room state, presence, chat, and WebRTC signaling.
 */
export default defineSchema({
  rooms: defineTable({
    name: v.string(),
    language: v.string(), // e.g. "English", "Urdu"
    topic: v.optional(v.string()),
    level: v.optional(v.string()), // CEFR-ish tag, self-declared
    mode: v.union(
      v.literal("voice"), // open voice room, up to ~20 listeners
      v.literal("stage"), // group video: max 8, admin picks <=4 publishers
      v.literal("private") // 1-on-1: full video + screen share
    ),
    ownerDeviceId: v.string(),
    locked: v.boolean(),
    maxParticipants: v.number(),
    participantCount: v.number(),
    lastActivityAt: v.number(),
    welcomeMessage: v.optional(v.string()),
  })
    .index("by_language", ["language"])
    .index("by_activity", ["lastActivityAt"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    deviceId: v.string(), // anonymous guest identity (no login wall)
    nickname: v.string(),
    isOwner: v.boolean(),
    role: v.union(v.literal("publisher"), v.literal("listener")),
    muted: v.boolean(),
    handRaised: v.boolean(),
    videoOn: v.boolean(),
    sharingScreen: v.boolean(),
    lastHeartbeat: v.number(),
    joinedAt: v.number(),
    // Watch Party (Phase 6): in "file" mode the participant must pick the
    // same local file on their own device before they can watch in sync.
    watchReady: v.optional(v.boolean()),
  })
    .index("by_room", ["roomId"])
    .index("by_room_device", ["roomId", "deviceId"]),

  messages: defineTable({
    roomId: v.id("rooms"),
    deviceId: v.string(),
    nickname: v.string(),
    text: v.string(),
    createdAt: v.number(),
    // Emoji reactions: one entry per (deviceId, emoji); UI toggles them.
    reactions: v.optional(
      v.array(v.object({ deviceId: v.string(), emoji: v.string() }))
    ),
    // Reply quote: points at the quoted message.
    replyTo: v.optional(
      v.object({
        messageId: v.id("messages"),
        nickname: v.string(),
        text: v.string(), // snippet, sliced at write time
      })
    ),
  }).index("by_room", ["roomId"]),

  // WebRTC signaling: offer/answer/ICE. Consumer deletes after reading.
  signals: defineTable({
    roomId: v.id("rooms"),
    fromDeviceId: v.string(),
    toDeviceId: v.string(),
    type: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice"),
      // Track metadata: lets peers tell camera tracks apart from screen-share
      // tracks (e.g. { action: "add", kind: "screen", streamId }).
      v.literal("track-meta"),
      // Phase 8 (engagement): live emoji reactions. Payload is JSON of
      // { emoji: string }; broadcast to every other participant in the room.
      v.literal("reaction")
    ),
    payload: v.string(), // JSON-stringified RTCSessionDescriptionInit / RTCIceCandidateInit
    createdAt: v.number(),
  })
    .index("by_recipient", ["roomId", "toDeviceId"])
    .index("by_room", ["roomId"]),

  bans: defineTable({
    roomId: v.optional(v.id("rooms")), // null roomId = site-wide
    deviceId: v.string(),
    reason: v.string(),
    expiresAt: v.number(),
  }).index("by_device", ["deviceId"]),

  reports: defineTable({
    roomId: v.id("rooms"),
    reporterDeviceId: v.string(),
    targetDeviceId: v.string(),
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Watch Party (Phase 6): one live session per room. The host writes
  // playback state here; every viewer subscribes reactively, so late
  // joiners snap to the current timestamp. Each viewer streams from their
  // own device (YouTube directly, or their own copy of the file) — zero
  // bandwidth cost to us, and no audio echo in the voice mesh.
  watchParty: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("youtube"), v.literal("file")),
    videoId: v.string(), // YouTube video ID; "" in file mode
    title: v.optional(v.string()),
    fileName: v.optional(v.string()), // file mode: name hint for matching
    fileSize: v.optional(v.number()), // file mode: size hint for matching
    status: v.union(v.literal("playing"), v.literal("paused")),
    positionSec: v.number(), // playback position at updatedAt
    updatedAt: v.number(),
    hostDeviceId: v.string(),
  }).index("by_room", ["roomId"]),

  // Shared platform media (in-room Apps Panel): one live share per room.
  sharedMedia: defineTable({
    roomId: v.id("rooms"),
    platform: v.string(), // tiktok | twitch | vimeo | dailymotion | spotify | x | facebook | instagram
    ref: v.string(), // embed-ready id / parsed reference
    title: v.optional(v.string()),
    hostDeviceId: v.string(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Web Push subscriptions (PWA). One row per device; endpoint is the
  // unique key. VAPID keys live in env (never in code).
  pushSubscriptions: defineTable({
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_endpoint", ["endpoint"]),

  // Daily visit streaks (Phase 8 — engagement & delight). One row per
  // deviceId (guest flows stay auth-free). A calendar day "counts" once the
  // device accrues >= 10 active minutes that day (minutes accrue from
  // presence heartbeat gaps — see convex/streaks.ts). Consecutive counted
  // days grow currentStreak; a missed day resets it to 1.
  streaks: defineTable({
    deviceId: v.string(),
    nickname: v.string(),
    currentStreak: v.number(),
    longestStreak: v.number(),
    lastVisitDay: v.string(), // YYYY-MM-DD of the most recent active day
    totalMinutes: v.number(),
    claimedMilestones: v.array(v.string()), // e.g. ["7", "30"]
    // Internal accounting (not shown in UI):
    dayMinutes: v.optional(v.number()), // minutes accrued on lastVisitDay
    dayCounted: v.optional(v.boolean()), // lastVisitDay already hit the 10-min threshold
    lastCountedDay: v.optional(v.string()), // YYYY-MM-DD of the last counted day
    lastStreakHeartbeatAt: v.optional(v.number()), // ms — cursor for gap-based accrual
    lastStreakWriteAt: v.optional(v.number()), // dayMinutes value at the last write (write-spam guard)
  }).index("by_deviceId", ["deviceId"]),

  // Room Apps (in-room panel: whiteboard, games, shared notepad).
  // All keyed by guest deviceId — no auth wall, $0 infra.

  // Collaborative whiteboard: one row per drawn stroke. Coordinates are
  // normalized to 0..1000 so strokes render on any canvas size. The
  // app keeps the latest 300 strokes per room and deletes older ones.
  whiteboard: defineTable({
    roomId: v.id("rooms"),
    deviceId: v.string(),
    nickname: v.string(),
    points: v.array(v.object({ x: v.number(), y: v.number() })),
    color: v.string(), // hex
    width: v.number(), // brush width in normalized units
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Tic-tac-toe: one row per room. First joiner is X, second is O,
  // everyone else spectates live.
  tictactoe: defineTable({
    roomId: v.id("rooms"),
    board: v.array(v.string()), // length 9, each "" | "X" | "O"
    turn: v.union(v.literal("X"), v.literal("O")),
    playerX: v.optional(v.string()), // deviceId
    playerO: v.optional(v.string()), // deviceId
    winner: v.union(
      v.literal(""),
      v.literal("X"),
      v.literal("O"),
      v.literal("draw")
    ),
    updatedAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Shared room notepad (vocab lists, notes). Last-write-wins, 5000 chars.
  notepad: defineTable({
    roomId: v.id("rooms"),
    text: v.string(),
    updatedAt: v.number(),
    byDeviceId: v.string(),
  }).index("by_room", ["roomId"]),
});
