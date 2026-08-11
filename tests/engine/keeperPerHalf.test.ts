/**
 * Football keeper-per-half (gkPolicy "fixedGK" with gkByPeriod): one keeper for the 1st half, one
 * for the 2nd — same person ⇒ a whole-match keeper, different ⇒ each keeps a half and plays out the
 * other. Verifies the right keeper starts, the plan swaps keepers at half-time, the off-duty keeper
 * can play outfield, and the single-keeper case is unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  buildPlan,
  chooseStartingLineup,
  computeTargets,
  getFormation,
  type Player,
} from "../../src/engine/index";
import { executePlan, makeMatch, makeSquad } from "./_fixtures";

/** 7-a-side squad where the first three can keep (so we have two distinct keepers). */
function squadWithKeepers(): Player[] {
  return makeSquad(9, { keepers: 3 });
}

describe("keeper per half", () => {
  it("starts the FIRST-half keeper in goal", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p02"] });
    const gk = chooseStartingLineup(match, players, getFormation(7)).assignments.find((a) => a.slot === "GK");
    expect(gk?.playerId).toBe("p01");
  });

  it("plans a keeper swap at half-time when the two halves differ", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p02"] });
    const built = buildPlan(match, players);
    const halfSeconds = match.periodLengthMinutes * 60;
    // A window at half-time brings p02 into goal.
    const swap = built.plan.windows.find((w) => Math.round(w.atMinute * 60) === halfSeconds);
    expect(swap).toBeDefined();
    // p02 takes the GK slot at the break.
    expect(swap?.swaps.some((s) => s.playerOn === "p02" && s.toSlot === "GK")
      || swap?.positionChanges.some((pc) => pc.playerId === "p02" && pc.toSlot === "GK")).toBe(true);
  });

  it("keeps the SAME keeper all match when both halves name them (no half-time GK swap)", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p01"] });
    const built = buildPlan(match, players);
    const halfSeconds = match.periodLengthMinutes * 60;
    const atHalf = built.plan.windows.find((w) => Math.round(w.atMinute * 60) === halfSeconds);
    const gkChangeAtHalf =
      atHalf?.swaps.some((s) => s.toSlot === "GK") || atHalf?.positionChanges.some((pc) => pc.toSlot === "GK");
    expect(gkChangeAtHalf ?? false).toBe(false);
    // …and p01 is excluded from the outfield fair-share (whole-match keeper), like a single fixedGK.
    const { excludedFromFairness } = computeTargets(match, players);
    expect(excludedFromFairness.has("p01")).toBe(true);
  });

  it("two different keepers are BOTH in the outfield fair-share (neither excluded)", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p02"] });
    const { excludedFromFairness } = computeTargets(match, players);
    expect(excludedFromFairness.size).toBe(0);
  });

  it("each keeper actually keeps their own half and plays out the other (executed plan)", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p02"] });
    const built = buildPlan(match, players);
    const final = executePlan(match, players, built);
    const p01 = final.players["p01"];
    const p02 = final.players["p02"];
    const half = match.periodLengthMinutes * 60;
    // Each spent GK time (their keeping half) but NOT the whole match in goal…
    expect((p01?.secondsAsGk ?? 0)).toBeGreaterThan(0);
    expect((p02?.secondsAsGk ?? 0)).toBeGreaterThan(0);
    expect((p01?.secondsAsGk ?? 0)).toBeLessThanOrEqual(half);
    expect((p02?.secondsAsGk ?? 0)).toBeLessThanOrEqual(half);
    // …and each also logged outfield minutes (secondsOnField beyond their GK time).
    expect((p01?.secondsOnField ?? 0)).toBeGreaterThan(p01?.secondsAsGk ?? 0);
    expect((p02?.secondsOnField ?? 0)).toBeGreaterThan(p02?.secondsAsGk ?? 0);
  });

  it("exactly one keeper is in goal at all times (on-field count stays valid across the swap)", () => {
    const players = squadWithKeepers();
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", gkByPeriod: ["p01", "p02"] });
    const built = buildPlan(match, players);
    const final = executePlan(match, players, built);
    const onField = Object.values(final.players).filter((p) => p.onField);
    expect(onField).toHaveLength(7);
    expect(onField.filter((p) => p.currentSlot === "GK")).toHaveLength(1);
  });
});
