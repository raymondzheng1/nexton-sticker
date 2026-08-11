import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  initLiveState,
  invalidatesPlan,
  planFromLineup,
  recommendationFromWindow,
  replanAfter,
  replanFromLive,
  sanitizePlan,
  stateAfterWindows,
  nextPlannedWindow,
  type MatchEvent,
  type PlannedWindow,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

describe("editable substitution plan (coach review timeline)", () => {
  const players = makeSquad(10);
  const match = makeMatch(7, players);
  const startingLineup = buildPlan(match, players).startingLineup.assignments;

  it("planFromLineup yields windows in chronological order within the match", () => {
    const windows = planFromLineup(match, players, startingLineup);
    expect(windows.length).toBeGreaterThan(0);
    const total = match.periods * match.periodLengthMinutes * 60;
    for (let i = 0; i < windows.length; i++) {
      expect(windows[i]!.atSeconds).toBeGreaterThan(0);
      expect(windows[i]!.atSeconds).toBeLessThan(total);
      if (i > 0) expect(windows[i]!.atSeconds).toBeGreaterThan(windows[i - 1]!.atSeconds);
      // every on-player has a slot; off/on counts pair up
      expect(windows[i]!.on.length).toBe(windows[i]!.off.length);
      for (const on of windows[i]!.on) expect(on.slot).toBeTruthy();
    }
  });

  it("stateAfterWindows actually applies the swaps (off goes to bench, on comes on)", () => {
    const windows = planFromLineup(match, players, startingLineup);
    const w0 = windows[0]!;
    const state = stateAfterWindows(match, players, startingLineup, [w0]);
    for (const offId of w0.off) expect(state.players[offId]!.onField).toBe(false);
    for (const on of w0.on) {
      expect(state.players[on.playerId]!.onField).toBe(true);
      expect(state.players[on.playerId]!.currentSlot).toBe(on.slot);
    }
    // on-field count is preserved
    expect(Object.values(state.players).filter((p) => p.onField)).toHaveLength(match.onFieldCount);
  });

  it("replanAfter keeps the coach's prefix verbatim and re-plans the rest", () => {
    const windows = planFromLineup(match, players, startingLineup);
    // Retime the first window earlier, then re-plan everything after it.
    const edited: PlannedWindow = { ...windows[0]!, atSeconds: 5 * 60 };
    const next = replanAfter(match, players, startingLineup, [edited, ...windows.slice(1)], 1);
    expect(next[0]).toEqual(edited); // prefix preserved exactly
    // downstream windows all come after the kept one and stay in order
    for (let i = 1; i < next.length; i++) {
      expect(next[i]!.atSeconds).toBeGreaterThan(next[i - 1]!.atSeconds);
    }
  });

  it("removing a window (keep prefix, re-plan from there) still produces a valid plan", () => {
    const windows = planFromLineup(match, players, startingLineup);
    // drop window index 1 by keeping only [0] then re-planning the remainder
    const next = replanAfter(match, players, startingLineup, [windows[0]!], 1);
    const total = match.periods * match.periodLengthMinutes * 60;
    for (const w of next) expect(w.atSeconds).toBeLessThan(total);
    // the kept first window is unchanged
    expect(next[0]).toEqual(windows[0]);
  });

  it("a literal remove (sanitizePlan) drops the change and keeps the rest valid", () => {
    const windows = planFromLineup(match, players, startingLineup);
    const without = sanitizePlan(match, players, startingLineup, windows.filter((_, k) => k !== 0));
    expect(without.length).toBeLessThan(windows.length); // the removed change is gone, not re-added
    // every step still fields exactly onFieldCount players (no count drift from the removal)
    const final = stateAfterWindows(match, players, startingLineup, without);
    expect(Object.values(final.players).filter((p) => p.onField)).toHaveLength(match.onFieldCount);
  });

  it("INVARIANT #3: a keep-on locked player is never suggested off by a stored plan window", () => {
    const windows = planFromLineup(match, players, startingLineup);
    const w = windows[0]!;
    const lockedId = w.off[0]!;
    // Reach the window's moment, with the coach having locked that player mid-match.
    let live = stateAfterWindows(match, players, startingLineup, [], w.atSeconds);
    live = { ...live, players: { ...live.players, [lockedId]: { ...live.players[lockedId]!, locked: true } } };
    const rec = recommendationFromWindow(match, players, live, w);
    // The locked player's pair is dropped WHOLE — they are not off, and their paired incoming
    // doesn't sneak on against someone else's slot (no mispairing).
    expect(rec.primary.map((s) => s.playerOff)).not.toContain(lockedId);
    expect(rec.primary.length).toBe(w.on.length - 1);
    for (const s of rec.primary) {
      const offState = live.players[s.playerOff ?? ""];
      expect(offState?.onField).toBe(true);
      expect(s.toSlot).toBe(offState?.currentSlot); // incoming inherits the outgoing's CURRENT slot
    }
  });

  it("recommendationFromWindow shapes a window for the live sheet with current fit", () => {
    const windows = planFromLineup(match, players, startingLineup);
    const live = stateAfterWindows(match, players, startingLineup, []); // kickoff state
    const rec = recommendationFromWindow(match, players, live, windows[0]!);
    expect(rec.primary.length).toBe(windows[0]!.on.length);
    for (const s of rec.primary) {
      expect(s.positionFit).toBeGreaterThanOrEqual(0);
      expect(s.positionFit).toBeLessThanOrEqual(1);
    }
  });

  it("nextPlannedWindow returns the first window still ahead of the clock", () => {
    const windows = planFromLineup(match, players, startingLineup);
    const first = windows[0]!;
    expect(nextPlannedWindow(windows, 0)).toEqual(first);
    // once past the first window's time, it returns the second (if any)
    const afterFirst = nextPlannedWindow(windows, first.atSeconds + 60);
    if (windows.length > 1) expect(afterFirst).toEqual(windows[1]);
    expect(nextPlannedWindow(null, 0)).toBeNull();
  });

  it("works for basketball (5-on-court, no GK) too", () => {
    const bb = makeSquad(8);
    const bbMatch = makeMatch(5, bb, { sport: "basketball", gkPolicy: "countAsFieldTime" });
    const lineup = buildPlan(bbMatch, bb).startingLineup.assignments;
    const windows = planFromLineup(bbMatch, bb, lineup);
    expect(windows.length).toBeGreaterThan(0);
    const state = stateAfterWindows(bbMatch, bb, lineup, windows.slice(0, 1));
    expect(Object.values(state.players).filter((p) => p.onField)).toHaveLength(5);
  });
});

describe("the guide re-plans when the coach deviates (live)", () => {
  it("invalidatesPlan: subs + new constraints stale the plan; clock/goal/kickoff events don't", () => {
    const sub: MatchEvent = { type: "SUB_APPLIED", atSeconds: 60, off: ["a"], on: [{ playerId: "b", slot: "MC" }], positionChanges: [] };
    expect(invalidatesPlan([sub])).toBe(true);
    expect(invalidatesPlan([{ type: "PLAYER_LOCKED", atSeconds: 60, playerId: "a", locked: true }])).toBe(true);
    expect(invalidatesPlan([{ type: "PLAYER_PINNED", atSeconds: 60, playerId: "a", slot: "MC" }])).toBe(true);
    // These must NOT re-plan: re-planning at kickoff would discard the coach's pre-match edits,
    // and a goal/tick changes nothing about who's on or the minutes trajectory.
    expect(invalidatesPlan([{ type: "TICK", atSeconds: 60, deltaSeconds: 60 }])).toBe(false);
    expect(invalidatesPlan([{ type: "GOAL_SCORED", atSeconds: 60, playerId: "a" }])).toBe(false);
    expect(invalidatesPlan([{ type: "CLOCK_PAUSED", atSeconds: 60 }])).toBe(false);
    expect(invalidatesPlan([{ type: "PERIOD_STARTED", atSeconds: 1500, period: 2 }])).toBe(false);
    expect(invalidatesPlan([])).toBe(false);
  });

  it("REGRESSION: after a manual sub the guide never again suggests a player who is already on", () => {
    const squad = makeSquad(10);
    const m = makeMatch(7, squad);
    const lineup = buildPlan(m, squad).startingLineup.assignments;
    const approved = planFromLineup(m, squad, lineup); // the plan the coach approved pre-match

    // The next planned change would bring `incomingId` on from the bench…
    const planned = approved.find((w) => w.atSeconds > 300 && w.on.length > 0)!;
    const incomingId = planned.on[0]!.playerId;
    const plannedOffId = planned.off[0]!;

    // …but at 5′ the coach subs that player on MANUALLY, for somebody else.
    const manualOff = lineup.find((a) => a.playerId !== plannedOffId)!;
    let state = applyEvent(initLiveState(m, squad), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    state = applyEvent(state, { type: "TICK", atSeconds: 300, deltaSeconds: 300 });
    state = applyEvent(state, {
      type: "SUB_APPLIED",
      atSeconds: 300,
      off: [manualOff.playerId],
      on: [{ playerId: incomingId, slot: manualOff.slot }],
      positionChanges: [],
    });

    // The bug: the approved plan still wants them brought ON, though they're already playing.
    expect(state.players[incomingId]!.onField).toBe(true);
    expect(planned.on.some((o) => o.playerId === incomingId)).toBe(true);

    // The fix: re-planning from the real state can only bring on players who are actually benched.
    const fresh = replanFromLive(m, squad, state, approved);
    const future = fresh.filter((w) => w.atSeconds > 300);
    expect(future.length).toBeGreaterThan(0);
    for (const on of future[0]!.on) {
      expect(state.players[on.playerId]!.onField, `${on.playerId} is already on the pitch`).toBe(false);
    }

    // History is preserved verbatim — only the future is regenerated.
    const past = approved.filter((w) => w.atSeconds <= 300);
    expect(fresh.slice(0, past.length)).toEqual(past);
  });
});
