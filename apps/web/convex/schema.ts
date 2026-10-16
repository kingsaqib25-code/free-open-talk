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
  })
    .index("by_room", ["roomId"])
    .index("by_room_device", ["roomId", "deviceId"]),

  messages: defineTable({
    roomId: v.id("rooms"),
    deviceId: v.string(),
    nickname: v.string(),
    text: v.string(),
    createdAt: v.number(),
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
      v.literal("track-meta")
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
});
