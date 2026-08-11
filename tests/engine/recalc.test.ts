import { describe, expect, it } from "vitest";
import {
  applyEvent,
  benchIds,
  buildPlan,
  initLiveState,
  onFieldIds,
  recalculate,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

function started(match: Match, players: Player[]): LiveState {
  const lineup = buildPlan(match, players).startingLineup.assignments;
  return applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
}

describe("real-time recalculation (PRD §7.5)", () => {
  it("only schedules future windows (after the current elapsed time)", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 10 });
    let s = started(match, players);
    s = applyEvent(s, { type: "TICK", atSeconds: 22 * 60, deltaSeconds: 22 * 60 }); // 22 min in
    const plan = recalculate(match, players, s);
    for (const w of plan.windows) expect(w.atMinute * 60).toBeGreaterThan(s.elapsedSeconds);
  });

  it("absorbs an unplanned manual swap and still trends toward fair time", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 3 });
    let s = started(match, players);
    // Coach makes an unplanned change at 8 min: a manual swap not in any plan.
    s = applyEvent(s, { type: "TICK", atSeconds: 8 * 60, deltaSeconds: 8 * 60 });
    const offId = onFieldIds(s).find((id) => s.players[id]!.currentSlot !== "GK")!;
    const onId = benchIds(s)[0]!;
    s = applyEvent(s, {
      type: "SUB_APPLIED",
      atSeconds: 8 * 60,
      off: [offId],
      on: [{ playerId: onId, slot: s.players[offId]!.currentSlot! }],
      positionChanges: [],
    });
    // Recalc re-plans the remainder; predicted full-time fairness is still within tolerance.
    const plan = recalculate(match, players, s);
    expect(plan.predictedMaxAbsDebtSeconds).toBeLessThanOrEqual(match.fairnessToleranceMinutes * 60);
  });

  it("folds a skipped sub into the next recalculation (PRD §11)", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 8 });
    let s = started(match, players);
    // Tick straight past the first planned window (8 min) without acting on it.
    s = applyEvent(s, { type: "TICK", atSeconds: 12 * 60, deltaSeconds: 12 * 60 });
    const plan = recalculate(match, players, s);
    // The missed change isn't dropped — a window is scheduled for the remainder.
    expect(plan.windows.length).toBeGreaterThan(0);
    expect(plan.windows.every((w) => w.atMinute * 60 > s.elapsedSeconds)).toBe(true);
  });

  it("is deterministic and equivalent to re-running the planner from the same state", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const s = started(match, players);
    expect(recalculate(match, players, s)).toEqual(recalculate(match, players, s));
  });
});
