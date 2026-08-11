/** Shared test fixtures + helpers for the engine corpus. Not a test file (no *.test.ts). */
import {
  applyEvent,
  fairnessReport,
  initLiveState,
  type BuildPlanResult,
  type LiveState,
  type Match,
  type Player,
  type PositionGroup,
  type PositionSlot,
} from "../../src/engine/index";

const GROUP_CYCLE: PositionGroup[] = ["DEF", "MID", "FWD"];

export interface SquadOptions {
  /** How many players can play GK (the first `keepers` players). Default 2. */
  keepers?: number;
  /** Give every player broad eligibility (2 groups) so fairness isn't blocked by fit. Default true. */
  broad?: boolean;
}

/**
 * Build a deterministic squad of `size` players with ids p01..pNN. Each is eligible for a primary
 * group (cycled) and, when `broad`, an adjacent group too, so the rotation engine can always find a
 * position-compatible swap.
 */
export function makeSquad(size: number, opts: SquadOptions = {}): Player[] {
  const keepers = opts.keepers ?? 2;
  const broad = opts.broad ?? true;
  const players: Player[] = [];
  for (let i = 0; i < size; i++) {
    const primary = GROUP_CYCLE[i % GROUP_CYCLE.length] as PositionGroup;
    const secondary = GROUP_CYCLE[(i + 1) % GROUP_CYCLE.length] as PositionGroup;
    const eligible: (PositionSlot | PositionGroup)[] = broad ? [primary, secondary] : [primary];
    players.push({
      id: `p${String(i + 1).padStart(2, "0")}`,
      name: `Player ${i + 1}`,
      squadNumber: i + 1,
      eligiblePositions: eligible,
      preferredPositions: [primary],
      canPlayGK: i < keepers,
      minutesWeight: 1,
    });
  }
  return players;
}

export type MatchOptions = Partial<Match>;

export function makeMatch(onFieldCount: number, players: Player[], opts: MatchOptions = {}): Match {
  return {
    onFieldCount,
    periods: 2,
    periodLengthMinutes: 25,
    rolloverSubsAllowed: true,
    gkPolicy: "countAsFieldTime",
    fairnessToleranceMinutes: 2,
    rotationStyle: "continuous",
    availableSquad: players.map((p) => p.id),
    minStintMinutes: 3,
    ...opts,
  };
}

/**
 * Execute a built plan through the REAL event reducer (independent of the planner's internal
 * simulation): place the lineup, then for each window tick forward and apply the sub, finally tick
 * to full time. Returns the final live state — its fairness report should match the plan's
 * prediction, which is what the cross-format fairness tests assert.
 */
export function executePlan(match: Match, players: Player[], built: BuildPlanResult): LiveState {
  let state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: built.startingLineup.assignments,
  });
  let cursor = 0;
  const windows = [...built.plan.windows].sort((a, b) => a.atMinute - b.atMinute);
  for (const w of windows) {
    const t = Math.round(w.atMinute * 60);
    state = applyEvent(state, { type: "TICK", atSeconds: t, deltaSeconds: t - cursor });
    cursor = t;
    state = applyEvent(state, {
      type: "SUB_APPLIED",
      atSeconds: t,
      off: w.off,
      on: w.swaps.map((s) => ({ playerId: s.playerOn, slot: s.toSlot })),
      positionChanges: w.positionChanges,
    });
  }
  const total = match.periods * match.periodLengthMinutes * 60;
  if (cursor < total) {
    state = applyEvent(state, { type: "TICK", atSeconds: total, deltaSeconds: total - cursor });
  }
  return state;
}

/** Convenience: minutes → seconds. */
export const min = (m: number): number => m * 60;

/** Re-export for tests. */
export { fairnessReport };
