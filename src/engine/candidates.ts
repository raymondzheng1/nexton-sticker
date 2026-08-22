/** Shared candidate selection used by both the planner and the live recommender. Pure. */
import {
  MIN_REST_FLOOR_SECONDS,
  MIN_STINT_FLOOR_MINUTES,
  PLAN_SWAP_HYSTERESIS_MINUTES,
  ROTATION_HARD_FRACTION,
  ROTATION_SOFT_WEIGHT,
  ROTATION_STINTS_PER_PLAYER,
  SECONDS_PER_MINUTE,
  subFrequencyMinStintScale,
} from "./constants";
import { benchIds } from "./liveState";
import type { LiveState, Match, Player, PlayerLiveState } from "./types";
import { effectiveWeight, getAvailablePlayers, isRetiredAt, keeperAt, totalMatchSeconds } from "./util";

export function minStintSeconds(match: Match): number {
  return (match.minStintMinutes ?? 3) * SECONDS_PER_MINUTE;
}

export interface RotationFloors {
  /** Shortest stint the engine will end on its own (seconds) — the HARD floor. */
  minStintSec: number;
  /** Shortest rest after which the engine will bring a player back on (seconds). 0 = no bench. */
  minRestSec: number;
  /** The stint the rotation is AIMING for (seconds); cutting one shorter costs fairness gain. */
  targetStintSec: number;
  /** The rest the rotation is aiming for (seconds). */
  targetRestSec: number;
  /** Match length, for tapering the soft cost. */
  totalSec: number;
}

/**
 * The rotation floors for this match and squad: how long a player should be ON before the engine
 * considers taking them off, and OFF before bringing them back (see ROTATION_STINTS_PER_PLAYER).
 *
 * Derived from each player's fair share: with K on the pitch and N in the rotation, a player plays
 * about K/N of the match and rests the remainder; both are split into about
 * ROTATION_STINTS_PER_PLAYER stretches. Never below the coach's just-subbed protection
 * (`minStintMinutes`), never above half a share (two stints must always be possible), shortened by
 * the frequency slider at levels 4-5. Short-handed (N <= K) there is no rotation to protect: the
 * stint floor is the configured one and the rest floor is 0. Pure and deterministic.
 */
export function rotationFloors(match: Match, players: Player[]): RotationFloors {
  const total = totalMatchSeconds(match);
  const n = getAvailablePlayers(match, players).filter((p) => effectiveWeight(p, match) > 0).length;
  const k = match.onFieldCount;
  const configured = minStintSeconds(match);
  if (n <= k || n === 0) {
    return { minStintSec: configured, minRestSec: 0, targetStintSec: configured, targetRestSec: 0, totalSec: total };
  }
  const scale = subFrequencyMinStintScale(match.subFrequency);
  const share = total * (k / n); // field-seconds each player is owed
  const targetStint = Math.min(share / 2, (share / ROTATION_STINTS_PER_PLAYER) * scale);
  const restShare = total - share; // bench-seconds each player spends
  const targetRest = (restShare / ROTATION_STINTS_PER_PLAYER) * scale;
  const hardStint = Math.max(configured, targetStint * ROTATION_HARD_FRACTION);
  const hardRest = Math.max(MIN_REST_FLOOR_SECONDS, targetRest * ROTATION_HARD_FRACTION);
  return {
    minStintSec: Math.max(MIN_STINT_FLOOR_MINUTES * SECONDS_PER_MINUTE, Math.round(Math.min(share / 2, hardStint))),
    minRestSec: Math.round(hardRest),
    targetStintSec: Math.round(targetStint),
    targetRestSec: Math.round(targetRest),
    totalSec: total,
  };
}

/**
 * The floors as they apply NOW. A stint floor longer than the time left is meaningless — it would
 * only block the last balancing changes of the match — so both hard floors shrink to at most half
 * the remaining time (the soft cost tapers separately, see rotationCostSeconds). Early and
 * mid-match this is the identity.
 */
export function effectiveFloors(floors: RotationFloors, nowSec: number): RotationFloors {
  const remaining = Math.max(0, floors.totalSec - nowSec);
  const cap = remaining / 2;
  return {
    ...floors,
    minStintSec: Math.min(floors.minStintSec, cap),
    minRestSec: Math.min(floors.minRestSec, cap),
  };
}

/**
 * The soft rotation cost of a swap (debt-seconds): how far it cuts the outgoing player's stint and
 * the incoming player's rest short of their targets, weighted and tapered by the time left (late in
 * a match, finishing fair outranks keeping shape). A never-played incoming player has no rest to
 * cut. Pure; 0 when short-handed (no targets) or when the swap respects both targets.
 */
export function rotationCostSeconds(
  floors: RotationFloors,
  offPs: PlayerLiveState,
  onPs: PlayerLiveState,
  nowSec: number,
  toleranceSec: number,
): number {
  if (floors.targetRestSec <= 0 || floors.totalSec <= 0) return 0;
  const taper = Math.max(0, (floors.totalSec - nowSec) / floors.totalSec);
  const stintShort = Math.max(0, floors.targetStintSec - offPs.secondsThisStint);
  const restShort = onPs.secondsOnField === 0 ? 0 : Math.max(0, floors.targetRestSec - onPs.secondsThisRest);
  // BOUNDED by the coach's tolerance: rotation shapes fairness INSIDE the tolerance band and never
  // beyond it. Any swap worth more than half the tolerance always goes ahead, so the squad can never
  // drift more than a band apart while the engine "waits for a proper stint" — which is also what
  // keeps a match that ends early (see shortMatch.test) fair to the minute it stopped.
  const cap = Math.max(0, toleranceSec / 2 - PLAN_SWAP_HYSTERESIS_MINUTES * SECONDS_PER_MINUTE);
  return Math.min(cap, ROTATION_SOFT_WEIGHT * taper * (stintShort + restShort));
}

/**
 * Fresh enough to come on? Anyone who has never played is fresh by definition (kick-off bench,
 * late arrivals); otherwise they need a full rest behind them.
 */
export function isRestedEnough(ps: PlayerLiveState, minRestSec: number): boolean {
  return ps.secondsOnField === 0 || ps.secondsThisRest >= minRestSec;
}

/**
 * Can this player be in the KICKOFF lineup? A player marked unavailable can't play at all, and a
 * late arrival (unavailableUntilMinute > 0) is on the bench until their minute — never a starter.
 * Shared by the planner, the lineup editor (seed + drag guard), and the kickoff safety check.
 */
export function isStartableAtKickoff(player: Player): boolean {
  if (player.availability === "unavailable") return false;
  if (isRetiredAt(player, 0)) return false; // retired before a ball was kicked
  return !(player.availability === "arrives-late" && (player.unavailableUntilMinute ?? 0) > 0);
}

/** Is this bench player eligible to come on right now (availability + late-arrival + fixedGK)? */
export function isBenchEligibleNow(
  match: Match,
  player: Player,
  nowSec: number,
): boolean {
  if (effectiveWeight(player, match) <= 0) return false;
  if (
    player.availability === "arrives-late" &&
    player.unavailableUntilMinute !== undefined &&
    player.unavailableUntilMinute * SECONDS_PER_MINUTE > nowSec
  ) {
    return false;
  }
  // Retired mid-match: out for the rest of the game, so never suggested on again. They stay in the
  // fairness pool (with their pro-rated weight) — that's what redistributes the minutes they can no
  // longer play — they're just not a candidate any more.
  if (isRetiredAt(player, nowSec)) return false;
  // The keeper ON DUTY for the current period belongs in goal, not on as an outfielder. An OFF-duty
  // keeper (the other half's keeper, benched now) is a normal outfield candidate — so per-half
  // keepers can play out the half they're not keeping.
  if (match.gkPolicy === "fixedGK" && player.id === keeperAt(match, nowSec)) return false;
  return true;
}

/** Bench players currently eligible to come on, as their live-state rows. */
export function benchEligibleNow(
  match: Match,
  byId: Map<string, Player>,
  state: LiveState,
  nowSec: number,
): PlayerLiveState[] {
  return benchIds(state)
    .map((id) => state.players[id])
    .filter((ps): ps is PlayerLiveState => ps !== undefined)
    .filter((ps) => {
      const p = byId.get(ps.playerId);
      return p !== undefined && isBenchEligibleNow(match, p, nowSec);
    });
}

/**
 * The bench players the engine will bring on of its own accord: the RESTED ones, full stop. When a
 * whole bench came on in one batch, nobody is rested at the next window — and the right answer is
 * to wait a minute, not to waive the floor; waiving it was precisely what put a player back on
 * two minutes after they came off (found in the short-match trace, 2026-08-17). The floors are
 * modest and taper with the time left (effectiveFloors), so waiting never stalls a rotation: a
 * one-player bench rests its floor and rotates. A coach FORCING a change (`allowUnrested`) still
 * gets the best available player — the coach's call always wins.
 */
export function benchRestedNow(
  match: Match,
  byId: Map<string, Player>,
  state: LiveState,
  nowSec: number,
  minRestSec: number,
  allowUnrested = false,
): PlayerLiveState[] {
  const eligible = benchEligibleNow(match, byId, state, nowSec);
  const rested = eligible.filter((ps) => isRestedEnough(ps, minRestSec));
  return rested.length > 0 || !allowUnrested ? rested : eligible;
}
