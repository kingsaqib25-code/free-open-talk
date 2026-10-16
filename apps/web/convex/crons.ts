import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled hygiene jobs ($0 — Convex crons).
 * - cleanupEmpty: delete rooms empty past the 15-minute grace period
 *   (emptySince stamped by presence.leave, cleared on rejoin).
 * - cleanupStale: prune participants whose heartbeat went stale.
 */
const crons = cronJobs();

crons.interval("cleanup empty rooms", { minutes: 2 }, internal.rooms.cleanupEmpty);
crons.interval("prune stale presence", { minutes: 2 }, internal.presence.cleanupStale);

export default crons;
