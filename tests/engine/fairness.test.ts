import { describe, expect, it } from "vitest";
import {
  computeDebts,
  computeTargets,
  fairnessReport,
  initLiveState,
  totalMatchSeconds,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("fair-time targets (PRD §7.1)", () => {
  it("targets sum to total field-seconds and split evenly for equal weights", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const total = totalMatchSeconds(match); // 3000s
    const { targetSeconds } = computeTargets(match, players);
    expect(sum(Object.values(targetSeconds))).toBeCloseTo(7 * total, 5);
    for (const t of Object.values(targetSeconds)) expect(t).toBeCloseTo((7 * total) / 10, 5);
  });

  it("scales targets by minutesWeight (mixed weights still sum correctly)", () => {
    const players = makeSquad(10);
    players[0] = { ...players[0]!, minutesWeight: 0.5 };
    const match = makeMatch(7, players);
    const total = totalMatchSeconds(match);
    const { targetSeconds } = computeTargets(match, players);
    expect(sum(Object.values(targetSeconds))).toBeCloseTo(7 * total, 5);
    // The 0.5-weight player targets half of a full-weight player.
    expect(targetSeconds["p01"]! * 2).toBeCloseTo(targetSeconds["p02"]!, 5);
  });

  it('gkPolicy "fixedGK": GK targets the full match and is excluded from outfield fairness', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", fixedGkPlayerId: "p01" });
    const total = totalMatchSeconds(match);
    const { targetSeconds, excludedFromFairness } = computeTargets(match, players);
    expect(targetSeconds["p01"]).toBeCloseTo(total, 5);
    expect(excludedFromFairness.has("p01")).toBe(true);
    // The other 9 share the 6 outfield slots.
    expect(targetSeconds["p02"]).toBeCloseTo((6 * total) / 9, 5);
    expect(sum(Object.values(targetSeconds))).toBeCloseTo(7 * total, 5);
  });

  it('gkPolicy "rotateSeparately": fairness pool is outfield seconds only', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { gkPolicy: "rotateSeparately" });
    const total = totalMatchSeconds(match);
    const { targetSeconds } = computeTargets(match, players);
    expect(sum(Object.values(targetSeconds))).toBeCloseTo(6 * total, 5);
    for (const t of Object.values(targetSeconds)) expect(t).toBeCloseTo((6 * total) / 10, 5);
  });
});

describe("fairness debt (PRD §7.2)", () => {
  it("positive debt = under-played; negative = over-played", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const ls = initLiveState(match, players);
    ls.elapsedSeconds = 1500; // half time
    ls.players["p01"]!.secondsOnField = 1500; // played the whole first half (over)
    ls.players["p02"]!.secondsOnField = 0; // sat the whole first half (under)

    const rows = computeDebts(match, players, ls);
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    // expectedSoFar = 2100 * 1500/3000 = 1050
    expect(byId["p01"]!.debtSeconds).toBeCloseTo(1050 - 1500, 5); // −450
    expect(byId["p02"]!.debtSeconds).toBeCloseTo(1050 - 0, 5); // +1050
  });

  it("season carry-forward seeds debt (owed minutes start positive)", () => {
    const players = makeSquad(10);
    players[0] = { ...players[0]!, carryForwardSeconds: 300 };
    const match = makeMatch(7, players);
    const ls = initLiveState(match, players); // elapsed 0
    const rows = computeDebts(match, players, ls);
    expect(rows.find((r) => r.playerId === "p01")!.debtSeconds).toBeCloseTo(300, 5);
    expect(rows.find((r) => r.playerId === "p02")!.debtSeconds).toBeCloseTo(0, 5);
  });

  it('rotateSeparately excludes GK seconds from a player’s fairness total', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { gkPolicy: "rotateSeparately" });
    const ls = initLiveState(match, players);
    ls.elapsedSeconds = 1000;
    ls.players["p01"]!.secondsOnField = 1000;
    ls.players["p01"]!.secondsAsGk = 1000; // all of it as GK ⇒ zero outfield time counted
    const rows = computeDebts(match, players, ls);
    const p01 = rows.find((r) => r.playerId === "p01")!;
    // played (outfield) counts as 0, so debt = expectedSoFar (positive), not negative.
    expect(p01.playedSeconds).toBe(0);
    expect(p01.debtSeconds).toBeGreaterThan(0);
  });
});

describe("fairnessReport", () => {
  it("computes maxAbs and spread over eligible players", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const ls = initLiveState(match, players);
    const report = fairnessReport(match, players, ls);
    expect(report.totalSeconds).toBe(totalMatchSeconds(match));
    expect(report.maxAbsDebtSeconds).toBe(0); // nothing played yet, no carry-forward
    expect(report.spreadSeconds).toBe(0);
  });
});
