import { describe, expect, it } from "vitest";
import { buildPlan, fairnessReport } from "../../src/engine/index";
import { executePlan, makeMatch, makeSquad } from "./_fixtures";

/** Format → squad size (on-field + a realistic bench). */
const SCENARIOS: { onFieldCount: number; squad: number }[] = [
  { onFieldCount: 5, squad: 8 },
  { onFieldCount: 7, squad: 10 },
  { onFieldCount: 9, squad: 13 },
  { onFieldCount: 10, squad: 14 },
  { onFieldCount: 11, squad: 16 },
];

describe("simulated full match finishes within tolerance (continuous)", () => {
  for (const { onFieldCount, squad } of SCENARIOS) {
    it(`${onFieldCount}v${onFieldCount} with ${squad} players`, () => {
      const players = makeSquad(squad);
      const match = makeMatch(onFieldCount, players, {
        rotationStyle: "continuous",
        fairnessToleranceMinutes: 3,
      });
      const built = buildPlan(match, players);
      const tolSec = match.fairnessToleranceMinutes * 60;

      // The planner predicts within tolerance...
      expect(built.plan.predictedMaxAbsDebtSeconds).toBeLessThanOrEqual(tolSec);
      expect(built.plan.toleranceInfeasible).toBe(false);

      // ...and executing the plan through the real reducer reproduces it.
      const finalState = executePlan(match, players, built);
      const report = fairnessReport(match, players, finalState);
      expect(report.maxAbsDebtSeconds).toBeLessThanOrEqual(tolSec);
      // The independent execution must agree with the planner's prediction.
      expect(Math.abs(report.maxAbsDebtSeconds - built.plan.predictedMaxAbsDebtSeconds)).toBeLessThan(1);
    });
  }
});

describe("each rotation style executes consistently with its prediction", () => {
  for (const rotationStyle of ["interval", "period", "continuous"] as const) {
    it(`7v7 — ${rotationStyle}`, () => {
      const players = makeSquad(10);
      const match = makeMatch(7, players, {
        rotationStyle,
        intervalMinutes: 6,
        fairnessToleranceMinutes: 5,
      });
      const built = buildPlan(match, players);
      const report = fairnessReport(match, players, executePlan(match, players, built));
      // Executing the plan through the real reducer reproduces the planner's prediction exactly —
      // the property that makes recalculation trustworthy (PRD §7.5).
      expect(Math.abs(report.maxAbsDebtSeconds - built.plan.predictedMaxAbsDebtSeconds)).toBeLessThan(1);
    });
  }
});

describe("fixedGK: the keeper is excluded, outfield finishes within tolerance", () => {
  it("9v9 with a fixed keeper", () => {
    const players = makeSquad(13);
    const match = makeMatch(9, players, {
      gkPolicy: "fixedGK",
      fixedGkPlayerId: "p01",
      rotationStyle: "continuous",
      fairnessToleranceMinutes: 3,
    });
    const built = buildPlan(match, players);
    const report = fairnessReport(match, players, executePlan(match, players, built));
    // The fixed keeper is not part of the outfield fairness pool…
    expect(report.rows.find((r) => r.playerId === "p01")!.eligible).toBe(false);
    // …and the outfield players finish within tolerance.
    expect(report.maxAbsDebtSeconds).toBeLessThanOrEqual(3 * 60);
  });
});
