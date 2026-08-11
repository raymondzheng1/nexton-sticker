/**
 * Editable substitution plan (PRD §7.3 + the coach-review extension). The engine already builds a
 * forward-simulated {@link SubPlan}; this module turns it into a flat, coach-editable, persistable
 * list of {@link PlannedWindow}s and supports the three edits the coach can make on the pre-match
 * timeline — retime, change who, add/remove — by **re-planning the remainder from the engine** after
 * the kept prefix (so fairness stays coherent downstream of a manual edit).
 *
 * Pure + deterministic like the rest of the engine: no IO, no clock reads, no Math.random. The
 * window times are SECONDS from kickoff (the persisted form mirrors a SUB_APPLIED event so it folds
 * straight into a live state).
 */
import { fairnessReport } from "./fairness";
import { applyEvent, initLiveState } from "./liveState";
import { overrideTradeoffNote } from "./overrides";
import { planFromState } from "./plan";
import { positionFit } from "./positions";
import { recommendSwaps } from "./recommend";
import { SECONDS_PER_MINUTE } from "./constants";
import { totalMatchSeconds } from "./util";
import type {
  LineupAssignment,
  LiveState,
  Match,
  MatchEvent,
  PlannedWindow,
  Player,
  PositionChange,
  Recommendation,
  SubPlan,
  Swap,
} from "./types";

/**
 * Clamp a planned window to what's valid in `state`, PAIR BY PAIR (off[i] ↔ on[i]): a pair survives
 * only when the outgoing player is on the field AND NOT locked/pinned (a keep-on player is never
 * suggested off — invariant #3) and the incoming player is on the bench. The incoming player takes
 * the outgoing player's CURRENT slot (like-for-like at execution time — the planned slot may be
 * stale if the coach repositioned people since). Dropping whole pairs — never truncating the lists
 * independently — keeps off/on correctly matched. Position changes are dropped for players who are
 * off the field or pinned to their slot.
 */
function sanitizeWindow(
  state: LiveState,
  window: PlannedWindow,
): { off: string[]; on: { playerId: string; slot: PlannedWindow["on"][number]["slot"] }[]; positionChanges: PositionChange[] } {
  const pairs = window.on
    .map((on, i) => ({ on, off: window.off[i] ?? null }))
    .filter((p): p is { on: PlannedWindow["on"][number]; off: string } => {
      if (p.off === null) return false;
      const outgoing = state.players[p.off];
      const incoming = state.players[p.on.playerId];
      return (
        outgoing !== undefined &&
        outgoing.onField &&
        !outgoing.locked && // keep-on: never suggested off (invariant #3)
        outgoing.pinnedSlot === null &&
        incoming !== undefined &&
        !incoming.onField
      );
    });
  const positionChanges = window.positionChanges.filter((pc) => {
    const ps = state.players[pc.playerId];
    return ps !== undefined && ps.onField && ps.pinnedSlot === null;
  });
  return {
    off: pairs.map((p) => p.off),
    on: pairs.map((p) => ({ playerId: p.on.playerId, slot: state.players[p.off]?.currentSlot ?? p.on.slot })),
    positionChanges,
  };
}

/** Flatten an engine {@link SubPlan} into the editable/persisted {@link PlannedWindow} form. */
export function subPlanToWindows(plan: SubPlan): PlannedWindow[] {
  return plan.windows.map((w) => ({
    atSeconds: Math.round(w.atMinute * SECONDS_PER_MINUTE),
    off: [...w.off],
    on: w.swaps.map((s) => ({ playerId: s.playerOn, slot: s.toSlot })),
    positionChanges: w.positionChanges.map((pc) => ({ ...pc })),
  }));
}

/**
 * Fold a starting lineup + a list of planned windows into the live state they produce — used to (a)
 * preview the lineup at each step of the timeline and (b) get the state to re-plan from after an
 * edit. `untilSeconds` optionally advances the clock past the last window (so a recommendation can be
 * computed AT a chosen time). Pure replay through the tested live reducer.
 */
export function stateAfterWindows(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
  windows: PlannedWindow[],
  untilSeconds?: number,
): LiveState {
  let state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup,
  });
  let t = 0;
  for (const w of windows) {
    if (w.atSeconds > t) {
      state = applyEvent(state, { type: "TICK", atSeconds: w.atSeconds, deltaSeconds: w.atSeconds - t });
      t = w.atSeconds;
    }
    const s = sanitizeWindow(state, w); // keep the on-field count valid even after a literal edit
    if (s.on.length > 0 || s.positionChanges.length > 0) {
      state = applyEvent(state, { type: "SUB_APPLIED", atSeconds: t, off: s.off, on: s.on, positionChanges: s.positionChanges });
    }
  }
  if (untilSeconds !== undefined && untilSeconds > t) {
    state = applyEvent(state, { type: "TICK", atSeconds: untilSeconds, deltaSeconds: untilSeconds - t });
  }
  return state;
}

/**
 * Project the rest of the match from where it ACTUALLY is: take the live state — real minutes
 * already played, whoever is really on the pitch — apply the changes still ahead, and run the clock
 * to full time. The answer is "if the plan runs from here, this is what everyone finishes on".
 *
 * The live counterpart of {@link stateAfterWindows}, which replays a hypothetical match from
 * kick-off. This one has to start mid-match, so it takes a state rather than a lineup, and it
 * ignores windows already in the past — those are history, and the log records what really happened.
 */
export function projectFromLive(
  match: Match,
  players: Player[],
  state: LiveState,
  windows: readonly PlannedWindow[],
  untilSeconds?: number,
): LiveState {
  // A projection is about the FUTURE of play. A paused clock or a half-time break stops the
  // present, not the rest of the match — without this no simulated time accrues and the projection
  // would say everyone finishes on the minutes they have right now.
  let s: LiveState = state.status === "running" ? state : { ...state, status: "running" };
  let t = s.elapsedSeconds;
  const until = untilSeconds ?? totalMatchSeconds(match);
  for (const w of [...windows].sort((a, b) => a.atSeconds - b.atSeconds)) {
    if (w.atSeconds <= t) continue; // already happened (or missed) — not part of the projection
    if (w.atSeconds > until) break;
    s = applyEvent(s, { type: "TICK", atSeconds: w.atSeconds, deltaSeconds: w.atSeconds - t });
    t = w.atSeconds;
    // Clamp each window to what's valid at that simulated moment, exactly as the live guide does.
    const c = sanitizeWindow(s, w);
    if (c.on.length > 0 || c.positionChanges.length > 0) {
      s = applyEvent(s, { type: "SUB_APPLIED", atSeconds: t, off: c.off, on: c.on, positionChanges: c.positionChanges });
    }
  }
  // Already past full time (added time) ⇒ nothing left to project; the current minutes ARE final.
  if (until > t) s = applyEvent(s, { type: "TICK", atSeconds: until, deltaSeconds: until - t });
  return s;
}

/**
 * Rewrite a window list to its valid, non-redundant form against a forward replay (drops swaps that
 * have become no-ops and collapses partial ones). Used after a literal edit (e.g. removing a window)
 * so the displayed timeline matches what will actually happen.
 */
export function sanitizePlan(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
  windows: PlannedWindow[],
): PlannedWindow[] {
  let state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup,
  });
  let t = 0;
  const out: PlannedWindow[] = [];
  for (const w of windows) {
    if (w.atSeconds > t) {
      state = applyEvent(state, { type: "TICK", atSeconds: w.atSeconds, deltaSeconds: w.atSeconds - t });
      t = w.atSeconds;
    }
    const s = sanitizeWindow(state, w);
    if (s.on.length === 0) continue; // window collapsed to nothing → drop it
    state = applyEvent(state, { type: "SUB_APPLIED", atSeconds: t, off: s.off, on: s.on, positionChanges: s.positionChanges });
    out.push({ atSeconds: w.atSeconds, off: s.off, on: s.on, positionChanges: s.positionChanges });
  }
  return out;
}

/** The full auto-plan, from the coach's CONFIRMED starting lineup (not the engine's auto-pick). */
export function planFromLineup(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
): PlannedWindow[] {
  const state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup,
  });
  return subPlanToWindows(planFromState(match, players, state));
}

/**
 * Keep the first `keptCount` windows exactly as the coach set them, then let the engine re-plan the
 * remainder from the state those windows produce. This is what every edit (retime / change-who /
 * remove / add) runs through, so downstream fairness adapts to the manual change.
 */
export function replanAfter(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
  windows: PlannedWindow[],
  keptCount: number,
): PlannedWindow[] {
  const kept = windows.slice(0, Math.max(0, keptCount));
  const state = stateAfterWindows(match, players, startingLineup, kept);
  const downstream = subPlanToWindows(planFromState(match, players, state));
  return [...kept, ...downstream];
}

/**
 * Events that INVALIDATE the rest of an approved plan, because they change the premises the plan
 * was simulated from:
 *  - `SUB_APPLIED` — the coach subbed (or repositioned) manually, so both who's on and the minutes
 *    trajectory have changed. Every downstream window was computed for a match that no longer
 *    exists — leave it and the guide keeps naming a player who is already on the pitch.
 *  - `PLAYER_LOCKED` / `PLAYER_PINNED` — a new hard constraint the remaining windows must respect
 *    (invariant #3: a locked player is never suggested off).
 * Deliberately NOT invalidating: `MATCH_STARTED` / `PERIOD_STARTED` (nothing about who's on changed,
 * and re-planning at kickoff would discard the coach's pre-match edits), clock events, and
 * `GOAL_SCORED` (no effect on minutes or fairness).
 */
const PLAN_INVALIDATING_EVENTS: ReadonlySet<MatchEvent["type"]> = new Set([
  "SUB_APPLIED",
  "PLAYER_LOCKED",
  "PLAYER_PINNED",
]);

/** True when any of `events` makes the remaining planned windows stale (see the set above). */
export function invalidatesPlan(events: readonly MatchEvent[]): boolean {
  return events.some((e) => PLAN_INVALIDATING_EVENTS.has(e.type));
}

/**
 * Re-plan the FUTURE of an approved plan against the ACTUAL live state. Windows already in the past
 * are kept verbatim (they're history — executed or missed); everything still ahead is regenerated
 * from where the match really is, so fairness re-converges after the coach deviates from the plan.
 *
 * This is the live counterpart of {@link replanAfter}: that one re-plans after a *simulated* prefix
 * while editing the pre-match timeline; this one re-plans from the *real* state mid-match.
 */
export function replanFromLive(
  match: Match,
  players: Player[],
  state: LiveState,
  plan: readonly PlannedWindow[],
): PlannedWindow[] {
  const done = plan.filter((w) => w.atSeconds <= state.elapsedSeconds);
  const future = subPlanToWindows(planFromState(match, players, state)).filter(
    (w) => w.atSeconds > state.elapsedSeconds,
  );
  return [...done, ...future];
}

/**
 * The engine's best single/multi change AT `atSeconds` (given the windows already planned before it),
 * shaped as a new {@link PlannedWindow} — the default content when the coach taps "Add a change".
 * Returns null when there's nothing sensible to suggest there (e.g. no bench).
 */
export function suggestWindowAt(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
  windowsBefore: PlannedWindow[],
  atSeconds: number,
): PlannedWindow | null {
  const state = stateAfterWindows(match, players, startingLineup, windowsBefore, atSeconds);
  let rec = recommendSwaps(match, players, state, { forceImmediate: true });
  if (rec.primary.length === 0) rec = recommendSwaps(match, players, state);
  if (rec.primary.length === 0) return null;
  return {
    atSeconds,
    off: rec.primary.map((s) => s.playerOff).filter((id): id is string => id !== null),
    on: rec.primary.map((s) => ({ playerId: s.playerOn, slot: s.toSlot })),
    positionChanges: rec.positionChanges,
  };
}

/**
 * Shape a stored {@link PlannedWindow} as a {@link Recommendation} for the live suggestion sheet,
 * using the CURRENT live state for debts + fit — so the approved plan drives the in-match cue while
 * still showing live numbers.
 */
export function recommendationFromWindow(
  match: Match,
  players: Player[],
  live: LiveState,
  window: PlannedWindow,
): Recommendation {
  const debt = new Map(fairnessReport(match, players, live).rows.map((r) => [r.playerId, r.debtSeconds]));
  const byId = new Map(players.map((p) => [p.id, p]));
  // Clamp to what's valid right now (the live lineup may differ from when the plan was made).
  const s = sanitizeWindow(live, window);
  const primary: Swap[] = s.on.map((onEntry, i) => {
    const offId = s.off[i] ?? null;
    const player = byId.get(onEntry.playerId);
    return {
      playerOff: offId,
      playerOn: onEntry.playerId,
      toSlot: onEntry.slot,
      offDebtSeconds: offId ? (debt.get(offId) ?? 0) : 0,
      onDebtSeconds: debt.get(onEntry.playerId) ?? 0,
      positionFit: player ? positionFit(player, onEntry.slot) : 0,
    };
  });
  return {
    atMinute: window.atSeconds / SECONDS_PER_MINUTE,
    primary,
    alternatives: [],
    positionChanges: s.positionChanges,
    // Same advisory note the engine's own recommendations carry: explains when a keep-on lock /
    // fixed GK makes perfectly-equal time impossible (PRD §7.6).
    note: overrideTradeoffNote(match, players, live),
  };
}

/** The next planned window still ahead of `elapsedSeconds` (with a small grace), or null. */
export function nextPlannedWindow(
  windows: PlannedWindow[] | null | undefined,
  elapsedSeconds: number,
  graceSeconds = 5,
): PlannedWindow | null {
  if (!windows) return null;
  return windows.find((w) => w.atSeconds > elapsedSeconds - graceSeconds) ?? null;
}
