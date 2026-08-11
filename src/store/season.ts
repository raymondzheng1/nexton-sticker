/**
 * Season aggregation (PRD §8.6) — computed ON READ from the stored matches, never persisted
 * (Harness §3.5 "derived state is computed, never stored", so it can't drift). Pure: it folds each
 * match's event log back through the engine to recover final minutes, then sums across matches.
 * This is the data behind season carry-forward and the manager's insight views.
 */
import { rebuildLiveState } from "../engine/index";
import type { SavedMatch } from "./schema";

export interface PlayerSeasonRow {
  playerId: string;
  name: string;
  /** Matches in which the player actually took the field. */
  matchesPlayed: number;
  /** Matches the player started (was in the kickoff lineup). */
  starts: number;
  totalSecondsOnField: number;
  totalSecondsAsGk: number;
  /** Scoring events across the season (football goals; basketball baskets made). */
  totalGoals: number;
  /** Points across the season — football goals are worth 1 each, basketball 1/2/3. */
  totalPoints: number;
  /** Field seconds by position slot (e.g. MC/FC/GK…) — the player's positional history. */
  totalSecondsBySlot: Record<string, number>;
}

/**
 * Aggregate per-player minutes/starts across the given matches (typically a team's season). Only
 * matches that kicked off contribute. The returned `carryForwardSeconds` seed for the engine is the
 * caller's call (e.g. target − actual); this report gives the raw actuals to compute it from.
 */
export function seasonReport(matches: SavedMatch[]): PlayerSeasonRow[] {
  const rows = new Map<string, PlayerSeasonRow>();
  const nameOf = new Map<string, string>();

  for (const match of matches) {
    if (match.deletedAt !== null) continue;
    for (const p of match.players) nameOf.set(p.id, p.name);

    const started = match.events.find((e) => e.type === "MATCH_STARTED");
    if (!started) continue; // a match that never kicked off contributes nothing

    const starterIds = new Set(
      started.type === "MATCH_STARTED" ? started.lineup.map((a) => a.playerId) : [],
    );
    const finalState = rebuildLiveState(match.config, match.players, match.events);

    for (const p of match.players) {
      const ls = finalState.players[p.id];
      if (!ls) continue;
      const row = rows.get(p.id) ?? {
        playerId: p.id,
        name: nameOf.get(p.id) ?? p.id,
        matchesPlayed: 0,
        starts: 0,
        totalSecondsOnField: 0,
        totalSecondsAsGk: 0,
        totalGoals: 0,
        totalPoints: 0,
        totalSecondsBySlot: {},
      };
      if (ls.secondsOnField > 0) row.matchesPlayed += 1;
      if (starterIds.has(p.id)) row.starts += 1;
      row.totalSecondsOnField += ls.secondsOnField;
      row.totalSecondsAsGk += ls.secondsAsGk;
      row.totalGoals += ls.goals;
      row.totalPoints += ls.points;
      for (const [slot, sec] of Object.entries(ls.secondsBySlot)) {
        if (sec) row.totalSecondsBySlot[slot] = (row.totalSecondsBySlot[slot] ?? 0) + sec;
      }
      rows.set(p.id, row);
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.totalSecondsOnField - a.totalSecondsOnField ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
}

/**
 * Season carry-forward seeds (PRD §8.6): how many seconds each player is "owed" relative to the
 * squad's average season minutes. Positive ⇒ under-played across the season (favour starts/minutes
 * next match); negative ⇒ over-played. Fed to the engine as `carryForwardSeconds` so fairness
 * balances ACROSS matches, not just within one. Self-balancing (sums to ~0 over the squad). The
 * caller decides whether to apply it (per-team toggle) and may clamp the magnitude.
 */
export function carryForwardSeeds(matches: SavedMatch[], playerIds: string[]): Record<string, number> {
  const played = new Map(seasonReport(matches).map((r) => [r.playerId, r.totalSecondsOnField]));
  const totals = playerIds.map((id) => played.get(id) ?? 0);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const seeds: Record<string, number> = {};
  for (const id of playerIds) seeds[id] = Math.round(avg - (played.get(id) ?? 0));
  return seeds;
}
