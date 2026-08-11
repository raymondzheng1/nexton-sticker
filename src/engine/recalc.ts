/**
 * Real-time recalculation (PRD §7.5). After EVERY event — a window tick, a confirmed sub, a manual
 * swap, an override, a pause, an injury, a skipped sub — re-run the forward simulation for the
 * remaining time and regenerate the sub plan, so one-off coach decisions are absorbed and the squad
 * still trends toward fair time by full time. This is a thin, intentional wrapper over the shared
 * simulation core in plan.ts (the same engine that builds the pre-match plan), guaranteeing the
 * pre-match plan and live recalculation behave identically.
 */
import { planFromState } from "./plan";
import type { LiveState, Match, Player, SubPlan } from "./types";

export function recalculate(match: Match, players: Player[], liveState: LiveState): SubPlan {
  return planFromState(match, players, liveState);
}
