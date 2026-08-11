import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  computeTargets,
  getFormation,
  initLiveState,
  onFieldIds,
  recalculate,
  recommendSwaps,
  totalMatchSeconds,
  type GkPolicy,
  type Match,
  type Player,
  type PositionGroup,
  type PositionSlot,
  type RotationStyle,
} from "../../src/engine/index";

/** Deterministic LCG so the property test is reproducible (no Math.random — engine invariant #5). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const GROUPS: PositionGroup[] = ["DEF", "MID", "FWD"];
const ROTATIONS: RotationStyle[] = ["interval", "period", "continuous"];

function randomSquad(rand: () => number, size: number): Player[] {
  return Array.from({ length: size }, (_, i) => {
    const g = GROUPS[Math.floor(rand() * GROUPS.length)] as PositionGroup;
    const g2 = GROUPS[Math.floor(rand() * GROUPS.length)] as PositionGroup;
    const elig: (PositionSlot | PositionGroup)[] = [g, g2];
    return {
      id: `p${String(i + 1).padStart(2, "0")}`,
      name: `P${i + 1}`,
      eligiblePositions: elig,
      preferredPositions: [g],
      canPlayGK: i < 2 || rand() < 0.2,
      minutesWeight: rand() < 0.2 ? 0.5 : 1,
    };
  });
}

describe("property-based: random squads/formats never violate the core invariants (PRD §13)", () => {
  it("100 random matches: plans build, fairness math is exact, flags are consistent, no throws", () => {
    const rand = lcg(20260613);
    for (let iter = 0; iter < 100; iter++) {
      const onFieldCount = 3 + Math.floor(rand() * 10); // 3..12
      const bench = Math.floor(rand() * 7); // 0..6
      const squad = onFieldCount + bench;
      const players = randomSquad(rand, squad);
      const gkPolicy: GkPolicy = (["countAsFieldTime", "rotateSeparately"] as GkPolicy[])[
        Math.floor(rand() * 2)
      ] as GkPolicy;
      const match: Match = {
        onFieldCount,
        periods: 1 + Math.floor(rand() * 3),
        periodLengthMinutes: 10 + Math.floor(rand() * 20),
        rolloverSubsAllowed: true,
        gkPolicy,
        fairnessToleranceMinutes: 2 + Math.floor(rand() * 3),
        rotationStyle: ROTATIONS[Math.floor(rand() * ROTATIONS.length)] as RotationStyle,
        availableSquad: players.map((p) => p.id),
        minStintMinutes: 3,
      };

      // CORE INVARIANT: the formation always has exactly onFieldCount slots (CLAUDE.md #1).
      expect(getFormation(onFieldCount).slots.length).toBe(onFieldCount);

      // Fairness math is exact: targets sum to the field-seconds the policy allocates.
      const total = totalMatchSeconds(match);
      const { targetSeconds } = computeTargets(match, players);
      const sum = Object.values(targetSeconds).reduce((a, b) => a + b, 0);
      const expectedSlots = gkPolicy === "rotateSeparately" ? onFieldCount - 1 : onFieldCount;
      expect(sum).toBeCloseTo(expectedSlots * total, 3);

      // Plans build without throwing, and the infeasible flag is consistent with the prediction.
      const built = buildPlan(match, players);
      const tolSec = match.fairnessToleranceMinutes * 60;
      expect(built.plan.toleranceInfeasible).toBe(built.plan.predictedMaxAbsDebtSeconds > tolSec);

      // Live recommendation + recalculation never throw on a random mid-match state.
      const lineup = built.startingLineup.assignments;
      let s = applyEvent(initLiveState(match, players), {
        type: "MATCH_STARTED",
        atSeconds: 0,
        lineup,
      });
      const half = Math.floor(total / 2);
      s = applyEvent(s, { type: "TICK", atSeconds: half, deltaSeconds: half });
      const rec = recommendSwaps(match, players, s);
      // No suggestion ever pulls a player who isn't actually on the field.
      const onField = new Set(onFieldIds(s));
      for (const sw of rec.primary) expect(onField.has(sw.playerOff ?? "")).toBe(true);
      expect(() => recalculate(match, players, s)).not.toThrow();
    }
  });
});
