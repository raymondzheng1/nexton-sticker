/**
 * Pure live-match logic, lifted verbatim from the original app.
 *
 * Deliberately smaller than the original barrel: the components it also exported (Pitch,
 * PlayerToken, BenchRail, MiniPitch) were presentation for the old design. The Back Page renders
 * the squad as newspaper tables, so those have no counterpart here — only the logic crossed over.
 */
export {
  buildMatchFeed,
  countActualSubs,
  feedLineText,
  wallClockLabel,
  type FeedEntry,
  type FeedLabels,
  type FeedMove,
  type FeedSwap,
} from "./matchFeed";
export {
  STATUS_META,
  STATUS_TOL_SECONDS,
  statusFor,
  statusTolFor,
  type StatusMeta,
  type TokenStatus,
  type TokenPlayer,
} from "./status";
export { courtLayout, pitchLayout, type SurfacePoint } from "./surfaceLayout";
