/**
 * Pre-match plan + forward simulation (PRD §7.3) and the simulation core reused by recalc (§7.5).
 *
 * The plan: pick a starting lineup, choose sub windows from the rotation style, then forward-
 * simulate the whole match — at each window swapping the most over-played on-field players for the
 * most under-played bench players (respecting positions, locks, pins, just-subbed protection) — so
 * everyone trends toward fair time by full time. Pure & deterministic (time is stepped via TICK
 * events through the same reducer the live match uses).
 */
import {
  DEFAULT_SUB_FREQUENCY,
  MAX_PLAN_WINDOWS,
  MIN_STINT_FLOOR_MINUTES,
  PLAN_SWAP_HYSTERESIS_MINUTES,
  SECONDS_PER_MINUTE,
  defaultIntervalMinutes,
  subFrequencyMinStintScale,
  subFrequencyMultiplier,
} from "./constants";
import { benchEligibleNow, isStartableAtKickoff, minStintSeconds } from "./candidates";
import { invariant } from "./errors";
import { computeTargets, debtMap } from "./fairness";
import { getFormation } from "./formations";
import { applyEvent, initLiveState, onFieldIds } from "./liveState";
import { canFillSlot, positionFit } from "./positions";
import type {
  Formation,
  LineupAssignment,
  LiveState,
  Match,
  PlayerLiveState,
  PositionChange,
  PositionSlot,
  StartingLineup,
  SubPlan,
  SubWindow,
  Swap,
} from "./types";
import {
  byAsc,
  byDesc,
  carryForwardOf,
  effectiveWeight,
  getAvailablePlayers,
  indexPlayers,
  isRetiredAt,
  keeperAt,
  keepersByPeriod,
  periodLengthSeconds,
  totalMatchSeconds,
} from "./util";
import type { Player } from "./types";

const HYSTERESIS_SECONDS = PLAN_SWAP_HYSTERESIS_MINUTES * SECONDS_PER_MINUTE;

/**
 * The minimum stint the PLANNER works to at this frequency level, in minutes. Levels 1–3 use the
 * coach's setting untouched; the top of the slider relaxes it (never below
 * {@link MIN_STINT_FLOOR_MINUTES}, and never LONGER than the coach asked for) so "more changes"
 * has somewhere to go — see subFrequencyMinStintScale. The relaxed value drives BOTH how many
 * windows fit and the just-subbed protection inside each one; if the two disagreed, extra windows
 * would arrive with nobody eligible to come off and come back empty.
 */
function plannerMinStintMinutes(match: Match): number {
  const configured = (match.minStintMinutes ?? 3) || 1;
  const scaled = configured * subFrequencyMinStintScale(match.subFrequency);
  return Math.min(configured, Math.max(MIN_STINT_FLOOR_MINUTES, scaled));
}

// ── Starting lineup (§7.3 step 1) ───────────────────────────────────────────

/**
 * Choose the starting XI: honour `fixedGK` and `mustStart`, fill the rest by best position fit,
 * breaking ties toward players owed minutes from the season (carry-forward) so starts balance out.
 */
export function chooseStartingLineup(
  match: Match,
  players: Player[],
  formation: Formation,
): StartingLineup {
  invariant(formation.slots.length === match.onFieldCount, "formation must match onFieldCount", {
    onFieldCount: match.onFieldCount,
    slots: formation.slots.length,
  });
  const byId = indexPlayers(players);
  // Everyone with a positive fairness weight is part of the squad (incl. late arrivals, who sit
  // on the bench until they arrive)…
  const available = getAvailablePlayers(match, players).filter((p) => effectiveWeight(p, match) > 0);
  // …but a player who arrives late can't be in the KICKOFF XI — only the kickoff-available subset
  // can fill starting slots (late arrivals become bench-eligible once their minute passes; see
  // benchEligibleNow).
  const kickoffPool = available.filter(isStartableAtKickoff);
  invariant(
    kickoffPool.length >= match.onFieldCount,
    "not enough players available at kickoff to field a full team",
    { availableAtKickoff: kickoffPool.length, onFieldCount: match.onFieldCount },
  );

  const slots = formation.slots;
  const assignment = new Map<number, string>(); // slotIndex → playerId
  const used = new Set<string>();

  const startBias = (id: string): number => {
    const p = byId.get(id);
    return p ? carryForwardOf(p) : 0;
  };

  // 1) GK slot(s).
  const gkSlotIndices = slots.map((s, i) => (s === "GK" ? i : -1)).filter((i) => i >= 0);
  for (const gkIdx of gkSlotIndices) {
    let chosen: string | undefined;
    if (match.gkPolicy === "fixedGK") {
      chosen = keepersByPeriod(match)[0]; // the first-half keeper starts in goal
      invariant(chosen !== undefined, 'gkPolicy "fixedGK" requires a keeper', {});
    } else {
      const keepers = kickoffPool
        .filter((p) => p.canPlayGK && !used.has(p.id))
        .sort(
          byDesc(
            (p) => (p.mustStart || p.alwaysOn ? 1e9 : 0) + carryForwardOf(p),
            (p) => p.id,
          ),
        );
      chosen = keepers[0]?.id;
    }
    invariant(chosen !== undefined, "no available player can play GK", { onFieldCount: match.onFieldCount });
    assignment.set(gkIdx, chosen);
    used.add(chosen);
  }

  // 2) must-start players (incl. always-on: not in the rotation ⇒ must begin on the pitch) into
  //    their best-fitting open outfield slot.
  const mustStarts = kickoffPool
    .filter((p) => (p.mustStart || p.alwaysOn) && !used.has(p.id))
    .sort(byDesc((p) => carryForwardOf(p), (p) => p.id));
  for (const p of mustStarts) {
    const slotIdx = bestOpenSlotFor(p, slots, assignment);
    if (slotIdx !== -1) {
      assignment.set(slotIdx, p.id);
      used.add(p.id);
    }
  }

  // 3) fill remaining slots by best fit, tie-broken by carry-forward (who's owed a start).
  for (let i = 0; i < slots.length; i++) {
    if (assignment.has(i)) continue;
    const slot = slots[i] as PositionSlot;
    const candidate = kickoffPool
      .filter((p) => !used.has(p.id) && canFillSlot(p, slot))
      .sort(byDesc((p) => positionFit(p, slot) * 1000 + startBias(p.id) / SECONDS_PER_MINUTE, (p) => p.id))[0];
    invariant(candidate !== undefined, "could not fill a starting slot", { slot, index: i });
    assignment.set(i, candidate.id);
    used.add(candidate.id);
  }

  const assignments: LineupAssignment[] = slots.map((slot, i) => {
    const playerId = assignment.get(i) as string;
    const p = byId.get(playerId) as Player;
    return { slot, playerId, positionFit: positionFit(p, slot) };
  });
  const bench = available.filter((p) => !used.has(p.id)).map((p) => p.id);
  return { assignments, bench };
}

function bestOpenSlotFor(
  player: Player,
  slots: PositionSlot[],
  assignment: Map<number, string>,
): number {
  let best = -1;
  let bestFit = 0;
  for (let i = 0; i < slots.length; i++) {
    if (assignment.has(i)) continue;
    const slot = slots[i] as PositionSlot;
    if (slot === "GK") continue; // GK handled separately
    const fit = positionFit(player, slot);
    if (fit > bestFit) {
      bestFit = fit;
      best = i;
    }
  }
  return best;
}

// ── Window selection ────────────────────────────────────────────────────────

function intervalSeconds(match: Match): number {
  const mins = match.intervalMinutes ?? defaultIntervalMinutes(match.onFieldCount);
  invariant(mins > 0, "intervalMinutes must be > 0", { mins });
  const mult = subFrequencyMultiplier(match.subFrequency);
  if (mult === 1) return mins * SECONDS_PER_MINUTE; // default level — byte-identical to before
  // More frequent ⇒ a shorter gap between windows. Floored at a minute: a fixed cadence tighter
  // than that isn't something a coach can actually run.
  return Math.max(SECONDS_PER_MINUTE, Math.round((mins / mult) * SECONDS_PER_MINUTE));
}

function periodBoundaries(match: Match): number[] {
  const len = periodLengthSeconds(match);
  const out: number[] = [];
  for (let k = 1; k < match.periods; k++) out.push(k * len);
  return out;
}

function evenlySpacedWindows(fromSec: number, toSec: number, n: number): number[] {
  if (n <= 0) return [];
  const span = toSec - fromSec;
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(Math.round(fromSec + (span * i) / (n + 1)));
  return out;
}

// ── Simulation core ─────────────────────────────────────────────────────────

interface SimResult {
  windows: SubWindow[];
  finalState: LiveState;
}

/**
 * Step the match from `startState` to full time, applying greedy fairness swaps at each rotation
 * window (and GK rotation at period boundaries under gkPolicy "rotateSeparately"). Returns the
 * resulting plan windows and the final simulated state.
 */
function runSimulation(
  match: Match,
  players: Player[],
  startState: LiveState,
  rotationWindowSec: number[],
  isOuterRotation: boolean,
  hysteresisSeconds: number = HYSTERESIS_SECONDS,
  minStintOverrideSec?: number,
): SimResult {
  const byId = indexPlayers(players);
  const total = totalMatchSeconds(match);
  const boundaries = new Set(periodBoundaries(match));
  const rotationSet = new Set(rotationWindowSec);

  let state = startState;
  let cursor = state.elapsedSeconds;

  const times = [...new Set([...rotationWindowSec, ...boundaries])]
    .filter((t) => t > cursor && t < total)
    .sort((a, b) => a - b);

  const windows: SubWindow[] = [];

  for (const t of times) {
    state = applyEvent(state, { type: "TICK", atSeconds: t, deltaSeconds: t - cursor });
    cursor = t;
    const debts = debtMap(match, players, state);

    const off: string[] = [];
    const on: { playerId: string; slot: PositionSlot }[] = [];
    const swaps: Swap[] = [];
    const positionChanges: PositionChange[] = [];
    const acc: SwapAccumulator = { off, on, swaps, positionChanges };

    // GK change at a period boundary runs FIRST and reserves its participants, so the outfield pass
    // can't also try to move the same players (which would leave the GK slot vacated).
    const reserved = new Set<string>();
    if (boundaries.has(t) && match.gkPolicy === "rotateSeparately") {
      rotateGk(match, byId, state, t, acc, reserved);
    }
    // fixedGK with per-half keepers: force the designated keeper for the period we're entering.
    if (boundaries.has(t) && match.gkPolicy === "fixedGK") {
      forceGk(match, byId, state, t, acc, reserved);
    }
    if (isOuterRotation && rotationSet.has(t)) {
      decideOutfieldSwaps(match, byId, state, debts, t, acc, reserved, hysteresisSeconds, minStintOverrideSec);
    }

    if (off.length > 0 || on.length > 0 || positionChanges.length > 0) {
      state = applyEvent(state, { type: "SUB_APPLIED", atSeconds: t, off, on, positionChanges });
      windows.push({
        atMinute: t / SECONDS_PER_MINUTE,
        off,
        on: on.map((o) => o.playerId),
        swaps,
        positionChanges,
      });
    }
  }

  if (cursor < total) {
    state = applyEvent(state, { type: "TICK", atSeconds: total, deltaSeconds: total - cursor });
  }
  return { windows, finalState: state };
}

interface SwapAccumulator {
  off: string[];
  on: { playerId: string; slot: PositionSlot }[];
  swaps: Swap[];
  positionChanges?: PositionChange[];
}

/** Greedy fairness pairing: most over-played off ↔ most under-played on, respecting positions. */
function decideOutfieldSwaps(
  match: Match,
  byId: Map<string, Player>,
  state: LiveState,
  debts: Map<string, number>,
  nowSec: number,
  acc: SwapAccumulator,
  reserved: Set<string>,
  hysteresisSeconds: number,
  minStintOverrideSec?: number,
): void {
  const gkExcluded = match.gkPolicy === "fixedGK" || match.gkPolicy === "rotateSeparately";
  const minStint = minStintOverrideSec ?? minStintSeconds(match);

  const offCandidates = onFieldIds(state)
    .map((id) => state.players[id])
    .filter((ps): ps is PlayerLiveState => ps !== undefined)
    .filter(
      (ps) =>
        !ps.locked &&
        ps.pinnedSlot === null &&
        ps.secondsThisStint >= minStint &&
        !reserved.has(ps.playerId) &&
        !(gkExcluded && ps.currentSlot === "GK"),
    )
    .sort(byAsc((ps) => debts.get(ps.playerId) ?? 0, (ps) => ps.playerId));

  const benchPool = benchEligibleNow(match, byId, state, nowSec)
    .filter((ps) => !reserved.has(ps.playerId))
    .sort(byDesc((ps) => debts.get(ps.playerId) ?? 0, (ps) => ps.playerId));

  const usedBench = new Set<string>();
  const maxSwaps = Math.min(offCandidates.length, benchPool.length);

  for (const offPs of offCandidates) {
    if (acc.off.length >= maxSwaps) break;
    const vacated = offPs.currentSlot;
    if (vacated === null) continue;
    const cand = pickBenchFor(vacated, benchPool, usedBench, byId, debts);
    if (!cand) continue;
    const offDebt = debts.get(offPs.playerId) ?? 0;
    const onDebt = debts.get(cand.playerId) ?? 0;
    // Only swap when the incoming player is meaningfully more owed than the outgoing — net
    // fairness improvement (avoids churn near equilibrium). Lists are sorted, so once the best
    // available pair fails this test, no later pair passes either. The margin narrows as the coach
    // asks for more frequent changes (see hysteresisSecondsFor).
    if (onDebt - offDebt <= hysteresisSeconds) break;

    const candPlayer = byId.get(cand.playerId) as Player;
    acc.off.push(offPs.playerId);
    acc.on.push({ playerId: cand.playerId, slot: vacated });
    acc.swaps.push({
      playerOff: offPs.playerId,
      playerOn: cand.playerId,
      toSlot: vacated,
      offDebtSeconds: offDebt,
      onDebtSeconds: onDebt,
      positionFit: positionFit(candPlayer, vacated),
    });
    usedBench.add(cand.playerId);
  }
}

/**
 * Pick the bench player for a vacated slot: prefer the highest-debt player with a good (same-group
 * or better) fit; otherwise the highest-debt player who can fill it at all. `benchPool` is
 * pre-sorted by debt desc.
 */
function pickBenchFor(
  slot: PositionSlot,
  benchPool: PlayerLiveState[],
  used: Set<string>,
  byId: Map<string, Player>,
  _debts: Map<string, number>,
): PlayerLiveState | undefined {
  let fallback: PlayerLiveState | undefined;
  for (const ps of benchPool) {
    if (used.has(ps.playerId)) continue;
    const p = byId.get(ps.playerId);
    if (!p) continue;
    const fit = positionFit(p, slot);
    if (fit <= 0) continue; // e.g. GK slot but !canPlayGK
    if (fit >= 0.65) return ps; // good like-for-like (or better) — take the highest-debt such
    if (!fallback) fallback = ps; // remember highest-debt fillable as fallback
  }
  return fallback;
}

/** Rotate the GK among canPlayGK players at a period boundary (gkPolicy "rotateSeparately"). */
function rotateGk(
  match: Match,
  byId: Map<string, Player>,
  state: LiveState,
  nowSec: number,
  acc: SwapAccumulator,
  reserved: Set<string>,
): void {
  const currentGk = onFieldIds(state)
    .map((id) => state.players[id])
    .find((ps) => ps?.currentSlot === "GK");
  if (!currentGk) return;

  const keepers = Object.values(state.players)
    .filter((ps) => {
      const p = byId.get(ps.playerId);
      if (!p || !p.canPlayGK) return false;
      if (effectiveWeight(p, match) <= 0) return false;
      if (isRetiredAt(p, nowSec)) return false; // out of the match — never rotated into goal
      if (
        p.availability === "arrives-late" &&
        p.unavailableUntilMinute !== undefined &&
        p.unavailableUntilMinute * SECONDS_PER_MINUTE > nowSec
      ) {
        return false;
      }
      return true;
    })
    .sort(byAsc((ps) => ps.secondsAsGk, (ps) => ps.playerId));

  const next = keepers[0];
  if (!next || next.playerId === currentGk.playerId) return;

  // Reserve both keepers so the outfield pass won't also move them (avoids a vacated GK slot).
  reserved.add(currentGk.playerId);
  reserved.add(next.playerId);

  if (next.onField) {
    // Both on field: exchange slots (both keep playing).
    const nextSlot = next.currentSlot;
    if (nextSlot === null) return;
    acc.positionChanges?.push({ playerId: currentGk.playerId, fromSlot: "GK", toSlot: nextSlot });
    acc.positionChanges?.push({ playerId: next.playerId, fromSlot: nextSlot, toSlot: "GK" });
  } else {
    // Next keeper on the bench: they come on at GK; the current GK rotates to the bench.
    acc.off.push(currentGk.playerId);
    acc.on.push({ playerId: next.playerId, slot: "GK" });
    acc.swaps.push({
      playerOff: currentGk.playerId,
      playerOn: next.playerId,
      toSlot: "GK",
      offDebtSeconds: 0,
      onDebtSeconds: 0,
      positionFit: 1,
    });
  }
}

/**
 * Force the DESIGNATED keeper (gkPolicy "fixedGK" with per-half keepers) into goal for the period
 * starting at `nowSec`. If the designated keeper already keeps, no-op. Otherwise the outgoing keeper
 * moves to the incoming keeper's outfield slot (both stay on) or to the bench (incoming was benched),
 * and the incoming keeper takes goal — so the coach's chosen keeper is always in goal each half, and
 * the outgoing keeper rejoins the outfield rotation.
 */
function forceGk(
  match: Match,
  byId: Map<string, Player>,
  state: LiveState,
  nowSec: number,
  acc: SwapAccumulator,
  reserved: Set<string>,
): void {
  const designatedId = keeperAt(match, nowSec);
  if (designatedId === undefined) return;
  const designated = byId.get(designatedId);
  // The keeper the coach nominated for this half may since have been retired (injury) or marked
  // unavailable. Forcing them into goal would put a player who has left the match back on the
  // pitch, so leave whoever is keeping in place and let the coach make the call.
  if (!designated || designated.availability === "unavailable" || isRetiredAt(designated, nowSec)) return;
  const currentGk = onFieldIds(state)
    .map((id) => state.players[id])
    .find((ps) => ps?.currentSlot === "GK");
  if (!currentGk || currentGk.playerId === designatedId) return; // already the right keeper

  const incoming = state.players[designatedId];
  if (!incoming) return; // not in the squad — leave the current keeper (defensive)

  reserved.add(currentGk.playerId);
  reserved.add(designatedId);

  if (incoming.onField) {
    // Incoming is playing outfield — exchange slots (both keep playing).
    const incomingSlot = incoming.currentSlot;
    if (incomingSlot === null) return;
    acc.positionChanges?.push({ playerId: currentGk.playerId, fromSlot: "GK", toSlot: incomingSlot });
    acc.positionChanges?.push({ playerId: designatedId, fromSlot: incomingSlot, toSlot: "GK" });
  } else {
    // Incoming is on the bench — sub them on at GK; the outgoing keeper rotates to the bench.
    acc.off.push(currentGk.playerId);
    acc.on.push({ playerId: designatedId, slot: "GK" });
    acc.swaps.push({
      playerOff: currentGk.playerId,
      playerOn: designatedId,
      toSlot: "GK",
      offDebtSeconds: 0,
      onDebtSeconds: 0,
      positionFit: 1,
    });
  }
}

// ── Assemble a SubPlan + predicted fairness ─────────────────────────────────

function makePlan(match: Match, players: Player[], sim: SimResult): SubPlan {
  const { excludedFromFairness } = computeTargets(match, players);
  const total = totalMatchSeconds(match);
  const finalDebts = debtMap(match, players, { ...sim.finalState, elapsedSeconds: total });

  const predictedFinalDebtSeconds: Record<string, number> = {};
  let maxAbs = 0;
  for (const [id, debt] of finalDebts) {
    predictedFinalDebtSeconds[id] = debt;
    const p = players.find((pl) => pl.id === id);
    const eligible = !excludedFromFairness.has(id) && p !== undefined && effectiveWeight(p, match) > 0;
    if (eligible) maxAbs = Math.max(maxAbs, Math.abs(debt));
  }

  const tolSec = match.fairnessToleranceMinutes * SECONDS_PER_MINUTE;
  return {
    windows: sim.windows,
    predictedFinalDebtSeconds,
    predictedMaxAbsDebtSeconds: maxAbs,
    toleranceInfeasible: maxAbs > tolSec,
  };
}

// ── Stability hold ──────────────────────────────────────────────────────────
// With LONG periods (> 10′), don't schedule a change during the first 4 minutes of a period — let
// the shape settle after kickoff/each restart. A window exactly AT a break (offset 0) stays: that
// change happens during the break, which is the stable moment. Short periods are exempt (a 4′ hold
// on an 8′ quarter would strangle rotation). The coach can still move a change anywhere by hand.
const STABILITY_MIN_PERIOD_MINUTES = 10;
const STABILITY_HOLD_SECONDS = 4 * SECONDS_PER_MINUTE;

/** Push generated window times out of each period's opening hold; dedupe + drop past-full-time. */
function applyStabilityHold(match: Match, times: number[], total: number): number[] {
  // Coach opted for even subbing from the first minute — skip the hold entirely.
  if (match.stabilityHold === false) return times;
  if (match.periodLengthMinutes <= STABILITY_MIN_PERIOD_MINUTES) return times;
  const periodSec = match.periodLengthMinutes * SECONDS_PER_MINUTE;
  const out: number[] = [];
  for (const t of times) {
    const offset = t % periodSec;
    const adjusted = offset > 0 && offset < STABILITY_HOLD_SECONDS ? t - offset + STABILITY_HOLD_SECONDS : t;
    if (adjusted < total && !out.includes(adjusted)) out.push(adjusted);
  }
  return out;
}

/**
 * Build the forward plan from a given state (kickoff state for {@link buildPlan}, or the live
 * state for {@link recalc}). Honours the rotation style and snooze (no window before the snooze).
 */
export function planFromState(match: Match, players: Player[], state: LiveState): SubPlan {
  // A 🕑 late player who hasn't ARRIVED yet is planned around as if not on the team sheet at all —
  // we don't know when (or whether) they'll actually turn up, so no window may count on them.
  // Narrow BOTH the squad and the simulation state (bench candidates come from state.players, so
  // the squad list alone wouldn't stop the simulation scheduling them once simulated time passes
  // their estimate). Marking them arrived (or the estimate passing in real time) re-anchors their
  // window ≤ now, and the next re-plan folds them in. Never drop an ON-FIELD player (a coach may
  // have subbed them straight on — that IS arrival, handled upstream).
  const byId = indexPlayers(players);
  const notHere = new Set(
    match.availableSquad.filter((id) => {
      const p = byId.get(id);
      return (
        p !== undefined &&
        p.availability === "arrives-late" &&
        (p.unavailableUntilMinute ?? 0) * SECONDS_PER_MINUTE > state.elapsedSeconds &&
        !(state.players[id]?.onField ?? false)
      );
    }),
  );
  if (notHere.size > 0) {
    match = { ...match, availableSquad: match.availableSquad.filter((id) => !notHere.has(id)) };
    state = {
      ...state,
      players: Object.fromEntries(Object.entries(state.players).filter(([id]) => !notHere.has(id))),
    };
  }

  // The plan projects the FUTURE of play. A paused clock (or a period break) stops the PRESENT,
  // not the future — simulate as if play resumes, otherwise no simulated time accrues and the
  // planner concludes "no changes needed" (an empty plan a caller could then persist as the guide).
  if (state.status === "paused" || state.status === "period-break") {
    state = { ...state, status: "running" };
  }

  const total = totalMatchSeconds(match);
  const elapsed = state.elapsedSeconds;
  const snoozeUntil = state.snoozedUntilSeconds ?? 0;
  const effectiveStart = Math.max(elapsed, snoozeUntil);

  if (match.rotationStyle === "interval") {
    const step = intervalSeconds(match);
    const times: number[] = [];
    for (let t = step; t < total; t += step) {
      if (t > effectiveStart) times.push(t);
    }
    return makePlan(
      match,
      players,
      runSimulation(match, players, state, applyStabilityHold(match, times, total), true),
    );
  }

  if (match.rotationStyle === "period") {
    // Changes happen at the breaks and nowhere else, so the frequency preference has nothing to
    // move here — the setup screen says so rather than offering a control that does nothing.
    const times = periodBoundaries(match).filter((t) => t > effectiveStart);
    return makePlan(match, players, runSimulation(match, players, state, times, true));
  }

  // continuous: adaptively add windows until predicted spread meets tolerance (fewest subs that
  // do), capped by minStint spacing and MAX_PLAN_WINDOWS. PRD §7.3 / §15.1.
  return planContinuous(match, players, state, effectiveStart, total);
}

/** Total |debt| across the squad — the tie-breaker when two plans have the same worst case. */
function sumAbsDebt(plan: SubPlan): number {
  return Object.values(plan.predictedFinalDebtSeconds).reduce((s, d) => s + Math.abs(d), 0);
}

function planContinuous(
  match: Match,
  players: Player[],
  state: LiveState,
  fromSec: number,
  total: number,
): SubPlan {
  // Effective tolerance is CAPPED relative to the match length (~17%, floor 1′): a nominal 2′
  // tolerance is fine for a 50′ game but is a third of a 6′ one — without the cap the planner
  // "meets tolerance" with a single window and a wildly uneven split.
  const tolSec = Math.min(
    match.fairnessToleranceMinutes * SECONDS_PER_MINUTE,
    Math.max(SECONDS_PER_MINUTE, Math.round(total / 6)),
  );
  const remainingMin = (total - fromSec) / SECONDS_PER_MINUTE;
  const configuredMinStintMin = (match.minStintMinutes ?? 3) || 1;
  // The stint floor the planner works to: the coach's setting at levels 1–3, relaxed at the top of
  // the slider so "more changes" isn't silently capped (see plannerMinStintMinutes).
  const minStintMin = plannerMinStintMinutes(match);
  const minStintSec = minStintMin * SECONDS_PER_MINUTE;
  const capFor = (stintMin: number): number =>
    Math.max(0, Math.min(MAX_PLAN_WINDOWS, Math.floor(remainingMin / stintMin) - 1));
  // The AUTO answer must be searched against the coach's own floor — otherwise level 4/5's relaxed
  // floor would move the baseline the slider is measured from, and level 3 wouldn't be the anchor.
  const autoMaxWindows = capFor(configuredMinStintMin);

  // At the top notch the coach is asking to rotate as much as the squad allows, so the "only swap
  // for a meaningful fairness gain" margin comes off — otherwise, once everyone is already level,
  // every extra window comes back empty and the slider stops responding mid-match. Every other
  // level keeps the standard margin: below the top, churn without a fairness reason is just churn.
  const hysteresis = Math.round(match.subFrequency ?? 0) >= 5 ? 0 : HYSTERESIS_SECONDS;

  const buildAt = (n: number, stintSec?: number): SubPlan => {
    const times = applyStabilityHold(match, evenlySpacedWindows(fromSec, total, n), total);
    return makePlan(match, players, runSimulation(match, players, state, times, true, hysteresis, stintSec));
  };

  // ── 1. The engine's own answer: the fewest windows that meet tolerance ──
  let autoPlan: SubPlan | undefined;
  let best: SubPlan | undefined;
  for (let n = 0; n <= autoMaxWindows; n++) {
    const plan = buildAt(n);
    if (plan.predictedMaxAbsDebtSeconds <= tolSec) {
      autoPlan = plan; // fewest windows that meet tolerance
      break;
    }
    // Track the fairest infeasible plan: lowest worst-case debt, then lowest TOTAL debt — a small
    // bench can pin the worst case (someone must play long), but more windows still spread the rest.
    if (
      !best ||
      plan.predictedMaxAbsDebtSeconds < best.predictedMaxAbsDebtSeconds ||
      (plan.predictedMaxAbsDebtSeconds === best.predictedMaxAbsDebtSeconds && sumAbsDebt(plan) < sumAbsDebt(best))
    ) {
      best = plan;
    }
  }
  if (!autoPlan && best) {
    // None met the (capped) SEARCH tolerance — take the fairest candidate. Its public
    // `toleranceInfeasible` flag stays makePlan's verdict against the coach's NOMINAL tolerance:
    // the cap only decides how hard we search, it must not redefine what "infeasible" means.
    autoPlan = best;
  }
  // maxWindows === 0 path is already covered by the loop (n = 0); this is unreachable in practice.
  if (!autoPlan) return buildAt(0);

  // ── 2. The coach's frequency preference, applied AROUND that answer ──
  // The engine decides what fair costs; the coach decides how much rotation they want to run. We
  // scale the engine's own count rather than imposing a cadence, so the preference means the same
  // thing for a 6′ game with 7 players as for a 90′ game with 18.
  const mult = subFrequencyMultiplier(match.subFrequency);
  if (mult === 1) return autoPlan; // balanced (or absent) — exactly as before this setting existed

  // Scale the number of changes the coach will actually SEE, not the number of slots we schedule.
  // Those differ: a scheduled window with nobody eligible to come off (just-subbed protection)
  // produces no change at all, so past a point extra slots stop turning into changes — and at the
  // top of the slider they can even crowd each other out and produce FEWER. Targeting the visible
  // count and searching for it keeps the slider monotonic, which is the whole point of a slider.
  const autoVisible = autoPlan.windows.length;
  if (autoVisible === 0) return autoPlan; // nothing to rotate (no usable bench) — no level changes that
  // Each notch must ASK for at least one more (or fewer) change than the notch beside it. Scaling
  // alone doesn't guarantee that: when the balanced plan is only two or three changes, rounding
  // collapses neighbouring levels onto the same number and the slider appears dead in the middle of
  // a match. Whether the squad can DELIVER the separation is another matter — the search below takes
  // the closest achievable — but the ask is always distinct.
  const level = Math.min(5, Math.max(1, Math.round(match.subFrequency ?? DEFAULT_SUB_FREQUENCY)));
  const step = level - DEFAULT_SUB_FREQUENCY; // −2 … +2
  const scaled = Math.round(autoVisible * mult);
  const targetVisible =
    step < 0
      ? Math.max(1, Math.min(scaled, autoVisible + step)) // fewer, but never none
      : Math.max(scaled, autoVisible + step);

  let chosen = autoPlan;
  let chosenMiss = Math.abs(autoVisible - targetVisible);
  for (let n = 0; n <= capFor(minStintMin); n++) {
    const plan = buildAt(n, minStintSec);
    const miss = Math.abs(plan.windows.length - targetVisible);
    // Closest to what the coach asked for; ties go to the calmer plan (fewer scheduled windows),
    // then to the fairer one.
    if (miss < chosenMiss || (miss === chosenMiss && plan.predictedMaxAbsDebtSeconds < chosen.predictedMaxAbsDebtSeconds)) {
      chosen = plan;
      chosenMiss = miss;
    }
  }
  // Fairness is REPORTED, not enforced, at the coach's chosen level — asking for fewer changes
  // widens the predicted spread, and `toleranceInfeasible` + the projected minutes say so plainly.
  return chosen;
}

// ── Public entry point ──────────────────────────────────────────────────────

export interface BuildPlanResult {
  formation: Formation;
  startingLineup: StartingLineup;
  plan: SubPlan;
}

/** Full pre-match build: resolve formation → choose XI → forward-simulate the sub plan (§7.3). */
export function buildPlan(match: Match, players: Player[]): BuildPlanResult {
  const formation = getFormation(match.onFieldCount, match.formationName, match.sport);
  const startingLineup = chooseStartingLineup(match, players, formation);
  const startState = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup.assignments,
  });
  const plan = planFromState(match, players, startState);
  return { formation, startingLineup, plan };
}
