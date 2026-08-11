/**
 * Live "who to sub" recommendation (PRD §7.4). **Advisory only** — the engine suggests a paired
 * swap (or a multi-sub batch) plus alternatives; the coach accepts, edits, or dismisses, and the
 * coach's decision always wins (CLAUDE.md invariant #2). Honours locks (key players are never
 * suggested off), pins, and just-subbed protection. Pure & deterministic.
 */
import { benchEligibleNow, minStintSeconds } from "./candidates";
import { PLAN_SWAP_HYSTERESIS_MINUTES, SECONDS_PER_MINUTE, SWAP_WEIGHTS } from "./constants";
import { debtMap } from "./fairness";
import { onFieldIds } from "./liveState";
import { overrideTradeoffNote } from "./overrides";
import { positionFit } from "./positions";
import type {
  LiveState,
  Match,
  Player,
  PlayerLiveState,
  PositionChange,
  PositionSlot,
  Recommendation,
  Swap,
} from "./types";
import { byAsc, byDesc, indexPlayers } from "./util";

const HYSTERESIS_SECONDS = PLAN_SWAP_HYSTERESIS_MINUTES * SECONDS_PER_MINUTE;

export interface RecommendOptions {
  /** Ignore just-subbed protection — the coach is forcing a change now (PRD §7.6, §11). */
  forceImmediate?: boolean;
  /** Cap the batch size; default = as many fairness-improving swaps as exist. */
  maxSwaps?: number;
  /**
   * Force these on-field players OFF and suggest the best incoming replacement + position reshuffle
   * for each — for "coach taps a player → Sub off → review" (PRD §7.4/§7.6). Bypasses just-subbed
   * protection and the fairness-improvement gate (the coach has decided they're coming off).
   */
  forceOff?: string[];
}

/**
 * The swapScore from PRD §7.4 (all debts in MINUTES so terms are comparable):
 *   w1·onComingDebt − w2·offGoingDebtIfKept + w3·positionFit − w4·stintTooShort − w5·overrideViolation
 * `offGoingDebtMin` is negative for an over-played player, so subtracting it rewards taking them off.
 */
export function swapScore(
  onComingDebtMin: number,
  offGoingDebtMin: number,
  fit: number,
  stintShortMin: number,
  overrideViolation = 0,
): number {
  return (
    SWAP_WEIGHTS.onComingDebt * onComingDebtMin -
    SWAP_WEIGHTS.offGoingDebt * offGoingDebtMin +
    SWAP_WEIGHTS.positionFit * fit -
    SWAP_WEIGHTS.stintTooShort * stintShortMin -
    SWAP_WEIGHTS.overrideViolation * overrideViolation
  );
}

export function recommendSwaps(
  match: Match,
  players: Player[],
  liveState: LiveState,
  options: RecommendOptions = {},
): Recommendation {
  const byId = indexPlayers(players);
  const debts = debtMap(match, players, liveState);
  const nowSec = liveState.elapsedSeconds;
  const minStint = minStintSeconds(match);
  const minStintMin = minStint / SECONDS_PER_MINUTE;
  const gkExcluded = match.gkPolicy === "fixedGK" || match.gkPolicy === "rotateSeparately";

  const debtOf = (id: string): number => debts.get(id) ?? 0;

  const forceOff = options.forceOff ?? [];
  // "Immediate" = coach is forcing the change: skip just-subbed protection + the improvement gate.
  const immediate = options.forceImmediate === true || forceOff.length > 0;

  const offCandidates =
    forceOff.length > 0
      ? // Exactly the players the coach chose to take off (on-field), in the given order.
        forceOff
          .map((id) => liveState.players[id])
          .filter((ps): ps is PlayerLiveState => ps !== undefined && ps.onField)
      : onFieldIds(liveState)
          .map((id) => liveState.players[id])
          .filter((ps): ps is PlayerLiveState => ps !== undefined)
          .filter(
            (ps) =>
              !ps.locked && // key players are never suggested off (§7.6)
              ps.pinnedSlot === null &&
              !(gkExcluded && ps.currentSlot === "GK") &&
              (immediate || ps.secondsThisStint >= minStint),
          )
          .sort(byAsc((ps) => debtOf(ps.playerId), (ps) => ps.playerId));

  const benchPool = benchEligibleNow(match, byId, liveState, nowSec).sort(
    byDesc((ps) => debtOf(ps.playerId), (ps) => ps.playerId),
  );

  const stintShortMinOf = (ps: PlayerLiveState): number =>
    Math.max(0, minStintMin - ps.secondsThisStint / SECONDS_PER_MINUTE);

  const scoreFor = (benchPs: PlayerLiveState, offPs: PlayerLiveState, slot: PositionSlot): number => {
    const onPlayer = byId.get(benchPs.playerId);
    if (!onPlayer) return Number.NEGATIVE_INFINITY;
    const fit = positionFit(onPlayer, slot);
    if (fit <= 0) return Number.NEGATIVE_INFINITY; // e.g. GK slot, !canPlayGK
    return swapScore(
      debtOf(benchPs.playerId) / SECONDS_PER_MINUTE,
      debtOf(offPs.playerId) / SECONDS_PER_MINUTE,
      fit,
      immediate ? 0 : stintShortMinOf(offPs),
    );
  };

  const usedBench = new Set<string>();
  const primary: Swap[] = [];
  // Subs are ALWAYS like-for-like: the incoming player takes the exact slot of the player going off.
  // The engine never reshuffles on-field players by fit/preferred position — preferred position is a
  // suggestion (it influences WHO comes on, not WHERE), and the coach repositions on the live pitch.
  const positionChanges: PositionChange[] = [];
  const maxSwaps = options.maxSwaps ?? Math.min(offCandidates.length, benchPool.length);

  for (const offPs of offCandidates) {
    if (primary.length >= maxSwaps) break;
    const vacated = offPs.currentSlot;
    if (vacated === null) continue;

    const ranked = benchPool
      .filter((b) => !usedBench.has(b.playerId))
      .map((b) => ({ b, score: scoreFor(b, offPs, vacated) }))
      .filter((x) => x.score > Number.NEGATIVE_INFINITY)
      .sort(byDesc((x) => x.score, (x) => x.b.playerId));

    const top = ranked[0];
    if (!top) continue; // no eligible bench player can fill THIS slot (e.g. GK, no spare keeper) — try the next

    const offDebt = debtOf(offPs.playerId);
    const onDebt = debtOf(top.b.playerId);
    // Require a net fairness improvement (lists are sorted, so once the best pair fails, stop).
    // Skipped when the coach is forcing the change (forceImmediate / forceOff).
    if (!immediate && onDebt - offDebt <= HYSTERESIS_SECONDS) break;

    const candPlayer = byId.get(top.b.playerId) as Player;
    const toSlot = vacated; // like-for-like: the incoming player takes the vacated slot, full stop

    primary.push({
      playerOff: offPs.playerId,
      playerOn: top.b.playerId,
      toSlot,
      offDebtSeconds: offDebt,
      onDebtSeconds: onDebt,
      positionFit: positionFit(candPlayer, toSlot),
    });
    usedBench.add(top.b.playerId);
  }

  // Alternatives: for the primary's first (fillable) off-slot, the next-best single swaps the coach
  // could pick instead (PRD §7.4 — "plus 1–2 alternatives"). Keyed off the first actual swap so an
  // unfillable top candidate (e.g. the GK with no spare keeper) doesn't yield empty alternatives.
  const alternatives: Swap[] = [];
  const firstSwap = primary[0];
  const firstOff = firstSwap
    ? liveState.players[firstSwap.playerOff ?? ""]
    : offCandidates[0];
  if (firstOff && firstOff.currentSlot !== null) {
    const vacated = firstOff.currentSlot;
    const chosenForFirst = firstSwap?.playerOn;
    const ranked = benchPool
      .map((b) => ({ b, score: scoreFor(b, firstOff, vacated) }))
      .filter((x) => x.score > Number.NEGATIVE_INFINITY && x.b.playerId !== chosenForFirst)
      .sort(byDesc((x) => x.score, (x) => x.b.playerId));
    for (const r of ranked) {
      if (alternatives.length >= 2) break;
      const onPlayer = byId.get(r.b.playerId) as Player;
      alternatives.push({
        playerOff: firstOff.playerId,
        playerOn: r.b.playerId,
        toSlot: vacated,
        offDebtSeconds: debtOf(firstOff.playerId),
        onDebtSeconds: debtOf(r.b.playerId),
        positionFit: positionFit(onPlayer, vacated),
      });
    }
  }

  return {
    atMinute: nowSec / SECONDS_PER_MINUTE,
    primary,
    alternatives,
    positionChanges,
    note: overrideTradeoffNote(match, players, liveState),
  };
}

