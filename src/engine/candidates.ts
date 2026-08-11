/** Shared candidate selection used by both the planner and the live recommender. Pure. */
import { SECONDS_PER_MINUTE } from "./constants";
import { benchIds } from "./liveState";
import type { LiveState, Match, Player, PlayerLiveState } from "./types";
import { effectiveWeight, isRetiredAt, keeperAt } from "./util";

export function minStintSeconds(match: Match): number {
  return (match.minStintMinutes ?? 3) * SECONDS_PER_MINUTE;
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
