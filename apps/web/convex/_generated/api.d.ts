/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as dailymotion from "../dailymotion.js";
import type * as follows from "../follows.js";
import type * as moderation from "../moderation.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as roomapps from "../roomapps.js";
import type * as rooms from "../rooms.js";
import type * as sharedMedia from "../sharedMedia.js";
import type * as signals from "../signals.js";
import type * as streaks from "../streaks.js";
import type * as watchparty from "../watchparty.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  crons: typeof crons;
  dailymotion: typeof dailymotion;
  follows: typeof follows;
  moderation: typeof moderation;
  presence: typeof presence;
  push: typeof push;
  roomapps: typeof roomapps;
  rooms: typeof rooms;
  sharedMedia: typeof sharedMedia;
  signals: typeof signals;
  streaks: typeof streaks;
  watchparty: typeof watchparty;
  youtube: typeof youtube;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
