/**
 * Fair-time targets + live fairness debt (PRD §7.1–7.2). Pure, deterministic.
 *
 * Targets answer "how many field-seconds does each player deserve?"; debt is the live signal
 * "are they ahead or behind right now?". Positive debt ⇒ under-played (bring ON);
 * negative debt ⇒ over-played (candidate OFF). Handles all three gkPolicy modes (§7.1).
 */
import { invariant } from "./errors";
import type { LiveState, Match, Player } from "./types";
import {
  carryForwardOf,
  effectiveWeight,
  getAvailablePlayers,
  isSingleKeeper,
  keepersByPeriod,
  totalMatchSeconds,
} from "./util";

export interface TargetsResult {
  /** target field-seconds per player id. */
  targetSeconds: Record<string, number>;
  /**
   * Player ids excluded from the fairness VERDICT — the whole-match fixed GK (they keep, by
   * definition) and anyone retired mid-match. They keep a target (which is what redistributes the
   * minutes; see `effectiveWeight`); they're just not counted in "did the squad get fair time?",
   * because no plan can change what they already played.
   */
  excludedFromFairness: Set<string>;
}

/**
 * Retired players are out of the fairness VERDICT, not out of the maths.
 *
 * A player pulled off injured at minute 20 usually finishes ahead of their pro-rated share — they
 * were on the pitch the whole time they were available. That leaves a permanent, unfixable gap. If
 * it counted toward the worst case, `predictedMaxAbsDebtSeconds` would sit above tolerance for the
 * rest of the match: the planner would never hit its early return and would re-run its entire
 * search on every single commit, and the coach would be told the squad can't be balanced when in
 * fact everyone still playing is level.
 *
 * The mark is only ever written as "now" when the coach retires someone, so its presence — not a
 * comparison against a clock — is what makes this time-independent and safe to use here.
 */
function isRetired(player: Player): boolean {
  return player.availableUntilMinute !== undefined;
}

/**
 * Compute each available player's target field-seconds (PRD §7.1):
 *   totalFieldSeconds = onFieldCount * totalMatchSeconds
 *   targetSeconds(p)  = totalFieldSeconds * (effectiveWeight(p) / Σ effectiveWeight)
 * adjusted per gkPolicy.
 */
export function computeTargets(match: Match, players: Player[]): TargetsResult {
  invariant(match.onFieldCount >= 1, "onFieldCount must be ≥ 1", { onFieldCount: match.onFieldCount });
  const available = getAvailablePlayers(match, players);
  const total = totalMatchSeconds(match);
  const targetSeconds: Record<string, number> = {};
  const excludedFromFairness = new Set<string>();
  for (const p of available) {
    if (isRetired(p)) excludedFromFairness.add(p.id);
  }

  if (match.gkPolicy === "fixedGK") {
    if (isSingleKeeper(match)) {
      // ONE keeper for the whole match: they're excluded from the outfield fair-share (they keep the
      // whole game) and the remaining (onFieldCount − 1) slots are shared by everyone else.
      const gkId = keepersByPeriod(match)[0];
      invariant(gkId !== undefined, 'gkPolicy "fixedGK" requires a keeper', {});
      invariant(match.availableSquad.includes(gkId), "keeper must be in the available squad", { gkId });
      excludedFromFairness.add(gkId);
      targetSeconds[gkId] = total;
      const outfield = available.filter((p) => p.id !== gkId);
      const outfieldFieldSeconds = (match.onFieldCount - 1) * total;
      distributeByWeight(outfield, match, outfieldFieldSeconds, targetSeconds);
      return { targetSeconds, excludedFromFairness };
    }
    // TWO+ keepers split the match by period. Each keeps their half (in goal) and plays outfield the
    // rest — so we balance TOTAL pitch time across everyone (GK time counts, like countAsFieldTime);
    // the forward plan locks the right keeper in goal each period, which naturally compensates a
    // keeper with less outfield time. Nobody is excluded — a keeper is a normal rotation player when
    // they're not the one keeping.
    const totalFieldSeconds = match.onFieldCount * total;
    distributeByWeight(available, match, totalFieldSeconds, targetSeconds);
    return { targetSeconds, excludedFromFairness };
  }

  if (match.gkPolicy === "rotateSeparately") {
    // Outfield fairness computed over outfield seconds only; the GK role rotates on its own
    // schedule and GK seconds are excluded from each player's outfield fairness (see debt below).
    const outfieldFieldSeconds = (match.onFieldCount - 1) * total;
    distributeByWeight(available, match, outfieldFieldSeconds, targetSeconds);
    return { targetSeconds, excludedFromFairness };
  }

  // countAsFieldTime (default): GK seconds count like any other. SHORT-HANDED (fewer players than
  // slots) the pitch only ever holds the squad, so the field-seconds to share are the squad's, not
  // the formation's; otherwise everyone is "owed" more than the whole match and reads as behind.
  const onPitch = Math.min(match.onFieldCount, available.filter((p) => effectiveWeight(p, match) > 0).length);
  const totalFieldSeconds = onPitch * total;
  distributeByWeight(available, match, totalFieldSeconds, targetSeconds);
  return { targetSeconds, excludedFromFairness };
}

function distributeByWeight(
  pool: Player[],
  match: Match,
  fieldSeconds: number,
  out: Record<string, number>,
): void {
  const sumWeights = pool.reduce((s, p) => s + effectiveWeight(p, match), 0);
  for (const p of pool) {
    out[p.id] = sumWeights > 0 ? fieldSeconds * (effectiveWeight(p, match) / sumWeights) : 0;
  }
}

/** The seconds that count toward a player's fairness, per gkPolicy. */
export function fairnessSecondsOf(
  match: Match,
  liveState: LiveState,
  playerId: string,
): number {
  const ls = liveState.players[playerId];
  if (!ls) return 0;
  if (match.gkPolicy === "rotateSeparately") return ls.secondsOnField - ls.secondsAsGk;
  return ls.secondsOnField;
}

export interface DebtRow {
  playerId: string;
  targetSeconds: number;
  expectedSoFarSeconds: number;
  playedSeconds: number;
  /** expectedSoFar − played + carryForward. Positive ⇒ under-played (bring ON). */
  debtSeconds: number;
  eligible: boolean;
}

/**
 * Live fairness debt per available player (PRD §7.2):
 *   expectedSoFar(p) = targetSeconds(p) * (elapsed / total)
 *   debt(p)          = expectedSoFar(p) − playedSeconds(p) + carryForward(p)
 */
export function computeDebts(match: Match, players: Player[], liveState: LiveState): DebtRow[] {
  const { targetSeconds, excludedFromFairness } = computeTargets(match, players);
  const total = totalMatchSeconds(match);
  const elapsed = Math.max(0, Math.min(liveState.elapsedSeconds, total));
  const available = getAvailablePlayers(match, players);

  return available.map((p) => {
    const target = targetSeconds[p.id] ?? 0;
    const expectedSoFar = total > 0 ? target * (elapsed / total) : 0;
    const played = fairnessSecondsOf(match, liveState, p.id);
    const debt = expectedSoFar - played + carryForwardOf(p);
    return {
      playerId: p.id,
      targetSeconds: target,
      expectedSoFarSeconds: expectedSoFar,
      playedSeconds: played,
      debtSeconds: debt,
      eligible: !excludedFromFairness.has(p.id) && effectiveWeight(p, match) > 0,
    };
  });
}

/** Convenience map of player id → current debt seconds. */
export function debtMap(match: Match, players: Player[], liveState: LiveState): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of computeDebts(match, players, liveState)) m.set(row.playerId, row.debtSeconds);
  return m;
}

export interface FairnessReport {
  elapsedSeconds: number;
  totalSeconds: number;
  rows: DebtRow[];
  /** max |debt| over fairness-eligible players (seconds). The product guarantee (PRD §2). */
  maxAbsDebtSeconds: number;
  /** max − min debt over fairness-eligible players (seconds). The §13 spread metric. */
  spreadSeconds: number;
}

export function fairnessReport(match: Match, players: Player[], liveState: LiveState): FairnessReport {
  const rows = computeDebts(match, players, liveState);
  const eligible = rows.filter((r) => r.eligible);
  const debts = eligible.map((r) => r.debtSeconds);
  const maxAbsDebtSeconds = debts.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
  const spreadSeconds = debts.length > 0 ? Math.max(...debts) - Math.min(...debts) : 0;
  return {
    elapsedSeconds: liveState.elapsedSeconds,
    totalSeconds: totalMatchSeconds(match),
    rows,
    maxAbsDebtSeconds,
    spreadSeconds,
  };
}
