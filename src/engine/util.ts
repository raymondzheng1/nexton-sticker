/** Small pure helpers shared across the engine. No I/O, no clock reads. */
import { DEFAULT_MINUTES_WEIGHT, SECONDS_PER_MINUTE } from "./constants";
import { EngineError, invariant } from "./errors";
import type { Match, Player } from "./types";

export function totalMatchSeconds(match: Match): number {
  invariant(match.periods >= 1 && match.periodLengthMinutes > 0, "match must have ≥1 period of positive length", {
    periods: match.periods,
    periodLengthMinutes: match.periodLengthMinutes,
  });
  return match.periods * match.periodLengthMinutes * SECONDS_PER_MINUTE;
}

export function periodLengthSeconds(match: Match): number {
  return match.periodLengthMinutes * SECONDS_PER_MINUTE;
}

/** Build an id→player map, throwing on duplicate ids (loud failure). */
export function indexPlayers(players: Player[]): Map<string, Player> {
  const map = new Map<string, Player>();
  for (const p of players) {
    if (map.has(p.id)) throw new EngineError("duplicate player id", { id: p.id });
    map.set(p.id, p);
  }
  return map;
}

/**
 * Resolve the available squad to Player objects, in the order listed in `match.availableSquad`.
 * Throws if an id doesn't resolve (loud failure, Harness §7.1).
 */
export function getAvailablePlayers(match: Match, players: Player[]): Player[] {
  const byId = indexPlayers(players);
  return match.availableSquad.map((id) => {
    const p = byId.get(id);
    if (!p) throw new EngineError("availableSquad references unknown player id", { id });
    return p;
  });
}

export function minutesWeightOf(player: Player): number {
  return player.minutesWeight ?? DEFAULT_MINUTES_WEIGHT;
}

/**
 * Effective fairness weight for a player in this match (PRD §11). Folds in:
 *  - `minutesWeight` (reduced-minutes override),
 *  - `availability === "unavailable"` ⇒ 0,
 *  - the player's AVAILABILITY WINDOW ⇒ scaled by the fraction of the match they can actually play,
 *    so the engine targets fair time over that window rather than the whole game.
 *
 * The window runs from `unavailableUntilMinute` (an `arrives-late` player turns up part-way) to
 * `availableUntilMinute` (a retired player is out for the rest). Both edges matter, and for the same
 * reason: minutes a player can't play must flow to the players who CAN, or everyone else's target
 * would be inflated past what the match can supply. Total field-seconds are conserved — a player out
 * from minute 20 of 60 carries a third of a share, and the other two thirds land on the rest of the
 * squad.
 */
export function effectiveWeight(player: Player, match: Match): number {
  if (player.availability === "unavailable") return 0;
  const base = minutesWeightOf(player);
  const total = match.periods * match.periodLengthMinutes;
  if (total <= 0) return base;
  const from = player.availability === "arrives-late" ? (player.unavailableUntilMinute ?? 0) : 0;
  const until = player.availableUntilMinute ?? total;
  // No window set at either edge ⇒ fraction 1 ⇒ plain `minutesWeight` (the common case, unchanged).
  const fraction = Math.max(0, Math.min(1, (Math.min(until, total) - Math.max(from, 0)) / total));
  return base * fraction;
}

/**
 * True when the coach has RETIRED this player — they played up to `availableUntilMinute` and are out
 * for the rest of the match (injury, fouled out, had to leave). `nowSeconds` is compared against the
 * mark so a retirement never applies retroactively to an earlier simulated moment.
 */
export function isRetiredAt(player: Player, nowSeconds: number): boolean {
  const until = player.availableUntilMinute;
  return until !== undefined && until * SECONDS_PER_MINUTE <= nowSeconds;
}

export function carryForwardOf(player: Player): number {
  return player.carryForwardSeconds ?? 0;
}

/**
 * The designated keeper for each period under gkPolicy "fixedGK": `gkByPeriod` when set, else
 * `fixedGkPlayerId` for every period. `[]` if neither is set (no designated keeper). Length is
 * clamped/padded to `match.periods` (a short array repeats its last keeper for the remaining
 * periods; a missing entry falls back to fixedGkPlayerId).
 */
export function keepersByPeriod(match: Match): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (let i = 0; i < match.periods; i++) {
    out.push(match.gkByPeriod?.[i] ?? match.gkByPeriod?.[match.gkByPeriod.length - 1] ?? match.fixedGkPlayerId);
  }
  return out;
}

/** The keeper on duty at `nowSeconds` (which period we're in), or undefined. */
export function keeperAt(match: Match, nowSeconds: number): string | undefined {
  const periodIndex = Math.min(match.periods - 1, Math.floor(nowSeconds / periodLengthSeconds(match)));
  return keepersByPeriod(match)[Math.max(0, periodIndex)];
}

/** True when one player keeps every period (a single whole-match keeper). */
export function isSingleKeeper(match: Match): boolean {
  const keepers = keepersByPeriod(match).filter((k): k is string => k !== undefined);
  return keepers.length > 0 && keepers.every((k) => k === keepers[0]) && keepers.length === match.periods;
}

/** Stable comparison by a numeric key descending, breaking ties by id ascending (determinism). */
export function byDesc<T>(value: (t: T) => number, id: (t: T) => string) {
  return (a: T, b: T): number => {
    const d = value(b) - value(a);
    if (d !== 0) return d;
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  };
}

/** Stable comparison by a numeric key ascending, breaking ties by id ascending (determinism). */
export function byAsc<T>(value: (t: T) => number, id: (t: T) => string) {
  return (a: T, b: T): number => {
    const d = value(a) - value(b);
    if (d !== 0) return d;
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  };
}
