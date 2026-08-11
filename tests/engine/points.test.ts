/**
 * Scoring in points (basketball 1/2/3) alongside goals (football, always 1).
 *
 * Two things must hold forever: a score must never move a single second of playing time, and a
 * basket recorded before `points` existed must still count as it did on the day it was logged.
 */
import { describe, expect, it } from "vitest";
import { applyEvent, buildPlan, initLiveState } from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

function kickedOff() {
  const players = makeSquad(10);
  const match = makeMatch(5, players, { sport: "basketball", periodLengthMinutes: 18 });
  const built = buildPlan(match, players);
  const state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: built.startingLineup.assignments,
  });
  const scorer = built.startingLineup.assignments[0]?.playerId as string;
  return { match, players, state, scorer };
}

describe("scoring in points", () => {
  it("adds the basket's value to points and one to the scoring count", () => {
    const { state, scorer } = kickedOff();
    let s = applyEvent(state, { type: "GOAL_SCORED", atSeconds: 60, playerId: scorer, points: 3 });
    s = applyEvent(s, { type: "GOAL_SCORED", atSeconds: 120, playerId: scorer, points: 2 });
    s = applyEvent(s, { type: "GOAL_SCORED", atSeconds: 180, playerId: scorer, points: 1 });
    expect(s.players[scorer]?.points).toBe(6);
    expect(s.players[scorer]?.goals).toBe(3); // three baskets made
  });

  it("counts a score with no value as one — matches stored before points existed", () => {
    const { state, scorer } = kickedOff();
    const s = applyEvent(state, { type: "GOAL_SCORED", atSeconds: 60, playerId: scorer });
    expect(s.players[scorer]?.points).toBe(1);
    expect(s.players[scorer]?.goals).toBe(1);
  });

  it("never moves a second of playing time", () => {
    const { state, scorer } = kickedOff();
    const before = { ...state.players[scorer] };
    const after = applyEvent(state, { type: "GOAL_SCORED", atSeconds: 60, playerId: scorer, points: 3 });
    const ps = after.players[scorer];
    expect(ps?.secondsOnField).toBe(before.secondsOnField);
    expect(ps?.secondsThisStint).toBe(before.secondsThisStint);
    expect(ps?.currentSlot).toBe(before.currentSlot);
    expect(after.elapsedSeconds).toBe(state.elapsedSeconds);
  });

  it("starts every player on zero — a fresh state is never partially initialised", () => {
    const players = makeSquad(8);
    const state = initLiveState(makeMatch(5, players), players);
    for (const ps of Object.values(state.players)) {
      expect(ps.points).toBe(0);
      expect(ps.goals).toBe(0);
    }
  });

  it("keeps points per player, not pooled across the squad", () => {
    const { match, players, state } = kickedOff();
    const [a, b] = buildPlan(match, players).startingLineup.assignments;
    let s = applyEvent(state, { type: "GOAL_SCORED", atSeconds: 60, playerId: a?.playerId as string, points: 3 });
    s = applyEvent(s, { type: "GOAL_SCORED", atSeconds: 90, playerId: b?.playerId as string, points: 2 });
    expect(s.players[a?.playerId as string]?.points).toBe(3);
    expect(s.players[b?.playerId as string]?.points).toBe(2);
  });
});
