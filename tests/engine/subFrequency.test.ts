/**
 * Sub-frequency slider (`Match.subFrequency`) — the coach's rotation dial.
 *
 * Each test is named after the failure it prevents. The load-bearing one is the FIRST: level 3 (and
 * an absent value) must plan exactly as the engine did before this setting existed, because real
 * matches are stored mid-season and a silent change of plan would be a change to someone's game.
 */
import { describe, expect, it } from "vitest";
import { buildPlan, DEFAULT_SUB_FREQUENCY, SUB_FREQUENCY_LEVELS, subFrequencyMultiplier } from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

/** Window count for a squad/format at a given level. */
function windowsAt(level: number | undefined, squadSize = 14, onFieldCount = 9): number {
  const players = makeSquad(squadSize);
  const match = makeMatch(onFieldCount, players, level === undefined ? {} : { subFrequency: level });
  return buildPlan(match, players).plan.windows.length;
}

describe("sub frequency", () => {
  it("an absent level plans identically to level 3 (stored matches must not change)", () => {
    const players = makeSquad(14);
    const absent = buildPlan(makeMatch(9, players), players).plan;
    const explicit = buildPlan(makeMatch(9, players, { subFrequency: DEFAULT_SUB_FREQUENCY }), players).plan;
    expect(explicit.windows).toEqual(absent.windows);
    expect(explicit.predictedFinalDebtSeconds).toEqual(absent.predictedFinalDebtSeconds);
  });

  it("the slider moves the plan across its whole range, not just the bottom half", () => {
    // The failure this guards against is real and was hit during development: the minimum-stint cap
    // made levels 3, 4 and 5 produce identical plans, so the top half of the slider did nothing at
    // all. Checked across formats because the cap binds differently for each.
    //
    // NOT asserted: five strictly distinct counts. A squad has a physical ceiling — 12 players over
    // 50 minutes cannot support more than about 17 changes however hard the slider is pushed — so
    // the top notches legitimately saturate. Four distinct plans and a rising range is the honest
    // guarantee, and it still fails loudly if a whole half of the slider goes dead.
    for (const [squad, onField] of [[16, 11], [14, 9], [12, 7], [8, 5]] as const) {
      const counts = [1, 2, 3, 4, 5].map((level) => windowsAt(level, squad, onField));
      const label = `${squad}-player ${onField}-a-side (got ${counts.join("/")})`;
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i], `level ${i + 1} plans fewer changes than level ${i} for ${label}`).toBeGreaterThanOrEqual(
          counts[i - 1] as number,
        );
      }
      expect(counts[4], `the top of the slider adds nothing for ${label}`).toBeGreaterThan(counts[2] as number);
      expect(counts[2], `the bottom of the slider removes nothing for ${label}`).toBeGreaterThan(counts[0] as number);
      expect(new Set(counts).size, `too few distinct plans for ${label}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("asking for fewer changes never removes substitution altogether", () => {
    // "Less often" is not "never": a coach at the bottom of the slider still rotates.
    for (const squad of [11, 12, 14, 16]) {
      expect(windowsAt(1, squad)).toBeGreaterThan(0);
    }
  });

  it("every planned window is a real change, never an empty slot", () => {
    // A scheduled window with nobody eligible to come off produces nothing. If the planner counted
    // those as changes, the slider's own summary ("6 changes") would lie to the coach.
    for (const level of [1, 2, 3, 4, 5]) {
      const players = makeSquad(14);
      const plan = buildPlan(makeMatch(9, players, { subFrequency: level }), players).plan;
      for (const w of plan.windows) {
        expect(w.swaps.length + w.positionChanges.length).toBeGreaterThan(0);
      }
    }
  });

  it("fewer changes costs fairness, and the cost is visible rather than hidden", () => {
    const players = makeSquad(14);
    const spread = [1, 2, 3].map(
      (level) => buildPlan(makeMatch(9, players, { subFrequency: level }), players).plan.predictedMaxAbsDebtSeconds,
    );
    // Rotating less can never make the squad FAIRER — that's the honest trade the slider makes, and
    // the plan reports it (predictedMaxAbsDebtSeconds drives the projected-minutes card).
    expect(spread[0]).toBeGreaterThanOrEqual(spread[1] as number);
    expect(spread[1]).toBeGreaterThanOrEqual(spread[2] as number);
  });

  it("no level ever strands a player — even the extremes stay inside a sane band", () => {
    const players = makeSquad(14);
    const totalSeconds = 50 * 60;
    for (const level of [1, 2, 3, 4, 5]) {
      const plan = buildPlan(makeMatch(9, players, { subFrequency: level }), players).plan;
      // Within a fifth of the match of their fair share, at the very worst. The dial trades fairness
      // at the margin; it does not abandon it.
      expect(plan.predictedMaxAbsDebtSeconds).toBeLessThan(0.2 * totalSeconds);
    }
  });

  it("an out-of-range or corrupted level falls back to balanced instead of a wild plan", () => {
    expect(subFrequencyMultiplier(undefined)).toBe(1);
    expect(subFrequencyMultiplier(0)).toBe(1);
    expect(subFrequencyMultiplier(99)).toBe(1);
    expect(subFrequencyMultiplier(Number.NaN)).toBe(1);
    expect(subFrequencyMultiplier(DEFAULT_SUB_FREQUENCY)).toBe(1);
    expect(SUB_FREQUENCY_LEVELS).toHaveLength(5);
  });

  it("interval rotation tightens and loosens its cadence with the level", () => {
    const players = makeSquad(14);
    const opts = { rotationStyle: "interval" as const, intervalMinutes: 10 };
    const fewer = buildPlan(makeMatch(9, players, { ...opts, subFrequency: 1 }), players).plan.windows.length;
    const balanced = buildPlan(makeMatch(9, players, { ...opts, subFrequency: 3 }), players).plan.windows.length;
    const more = buildPlan(makeMatch(9, players, { ...opts, subFrequency: 5 }), players).plan.windows.length;
    expect(fewer).toBeLessThan(balanced);
    expect(more).toBeGreaterThan(balanced);
  });

  it("a short game with no bench plans no changes at any level (nobody to bring on)", () => {
    const players = makeSquad(7); // exactly the on-field count
    for (const level of [1, 3, 5]) {
      expect(buildPlan(makeMatch(7, players, { subFrequency: level }), players).plan.windows).toHaveLength(0);
    }
  });
});
