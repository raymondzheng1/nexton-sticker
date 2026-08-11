/**
 * NextOn Rotation Engine — public API (PRD §7). A PURE, deterministic, identity-agnostic module
 * with zero react-native/UI/IO imports. Time is injected (never read from a clock). The engine's
 * correctness is the whole product (CLAUDE.md).
 */

// Domain types
export type {
  Availability,
  ClockStatus,
  Formation,
  FormationStyle,
  GkPolicy,
  LineupAssignment,
  LiveState,
  Match,
  MatchEvent,
  MatchEventType,
  Player,
  PlayerLiveState,
  PositionChange,
  PlannedWindow,
  PositionGroup,
  PositionSlot,
  Recommendation,
  RotationStyle,
  Sport,
  StartingLineup,
  SubPlan,
  SubWindow,
  Swap,
} from "./types";

// Errors + constants (SoT)
export { EngineError, invariant } from "./errors";
export {
  DEFAULT_FAIRNESS_TOLERANCE_MINUTES,
  DEFAULT_MINUTES_WEIGHT,
  DEFAULT_MIN_STINT_MINUTES,
  DEFAULT_SUB_FREQUENCY,
  LOCAL_OWNER_ID,
  SCHEMA_VERSION,
  SECONDS_PER_MINUTE,
  SUB_FREQUENCY_LEVELS,
  SWAP_WEIGHTS,
  defaultIntervalMinutes,
  subFrequencyMultiplier,
} from "./constants";

// Positions & formations (flexible format)
export {
  ALL_GROUPS,
  ALL_SLOTS,
  canFillSlot,
  columnOf,
  groupOf,
  groupsAdjacent,
  positionFit,
  slotsForGroup,
} from "./positions";
export {
  buildCustomFormation,
  generateFormation,
  getFormation,
  listFormations,
  styleFormation,
} from "./formations";

// Fairness (targets + debt)
export {
  computeDebts,
  computeTargets,
  debtMap,
  fairnessReport,
  fairnessSecondsOf,
} from "./fairness";
export type { DebtRow, FairnessReport, TargetsResult } from "./fairness";

// Live state (event reducer + clock)
export {
  applyEvent,
  benchIds,
  initLiveState,
  onFieldIds,
  rebuildLiveState,
} from "./liveState";

// Plan, recommend, recalc
export { isBenchEligibleNow, isStartableAtKickoff } from "./candidates";
export { buildPlan, chooseStartingLineup, planFromState } from "./plan";
export type { BuildPlanResult } from "./plan";
export { recommendSwaps, swapScore } from "./recommend";
export type { RecommendOptions } from "./recommend";
export { recalculate } from "./recalc";

// Editable substitution plan (coach review timeline + live guide)
export {
  invalidatesPlan,
  nextPlannedWindow,
  planFromLineup,
  projectFromLive,
  recommendationFromWindow,
  replanAfter,
  replanFromLive,
  sanitizePlan,
  stateAfterWindows,
  subPlanToWindows,
  suggestWindowAt,
} from "./planEdit";

// Overrides
export {
  keepPlayerOn,
  overrideTradeoffNote,
  pinPlayer,
  restPlayerNow,
  setMustStart,
  setReducedMinutes,
  snoozeNextSub,
} from "./overrides";

// Shared utils useful to callers (store/UI) that stay identity-agnostic
export {
  carryForwardOf,
  effectiveWeight,
  getAvailablePlayers,
  isRetiredAt,
  minutesWeightOf,
  totalMatchSeconds,
} from "./util";
