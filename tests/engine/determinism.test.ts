import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  initLiveState,
  recalculate,
  recommendSwaps,
  type Match,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

const FORMATS = [5, 7, 9, 10, 11];

describe("determinism — same inputs → same outputs (PRD §13)", () => {
  for (const onFieldCount of FORMATS) {
    it(`${onFieldCount}v${onFieldCount}: buildPlan is reproducible`, () => {
      const players = makeSquad(onFieldCount + 4);
      const match = makeMatch(onFieldCount, players);
      expect(buildPlan(match, players)).toEqual(buildPlan(match, players));
    });
  }

  it("recommendSwaps and recalculate are reproducible", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const lineup = buildPlan(match, players).startingLineup.assignments;
    let s = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    s = applyEvent(s, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
    expect(recommendSwaps(match, players, s)).toEqual(recommendSwaps(match, players, s));
    expect(recalculate(match, players, s)).toEqual(recalculate(match, players, s));
  });

  it("does not depend on player array ordering for fairness math", () => {
    const players = makeSquad(10);
    const match: Match = makeMatch(7, players);
    const shuffled: Player[] = [...players].reverse();
    // Same available squad, reversed array → identical plan windows/fairness (id-stable tie-breaks).
    const a = buildPlan(match, players).plan.predictedMaxAbsDebtSeconds;
    const b = buildPlan(match, shuffled).plan.predictedMaxAbsDebtSeconds;
    expect(a).toBeCloseTo(b, 5);
  });
});
