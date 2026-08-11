import { describe, expect, it } from "vitest";
import { buildPlan, type Player } from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

/** Players all-eligible everywhere (so position fit ties and other factors decide). */
function flatSquad(size: number, keepers = 2): Player[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, "0")}`,
    name: `P${i + 1}`,
    eligiblePositions: ["DEF", "MID", "FWD"],
    preferredPositions: [],
    canPlayGK: i < keepers,
    minutesWeight: 1,
  }));
}

describe("buildPlan (PRD §7.3)", () => {
  it("returns a formation, a full starting lineup, and a sub plan", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const built = buildPlan(match, players);
    expect(built.formation.slots).toHaveLength(7);
    expect(built.startingLineup.assignments).toHaveLength(7);
    expect(built.startingLineup.bench).toHaveLength(3); // bench = available − onFieldCount
    // No player appears both on the pitch and the bench.
    const starters = new Set(built.startingLineup.assignments.map((a) => a.playerId));
    for (const b of built.startingLineup.bench) expect(starters.has(b)).toBe(false);
  });

  it("honours must-start (player guaranteed in the XI)", () => {
    const players = flatSquad(12);
    players[11] = { ...players[11]!, mustStart: true }; // p12 would otherwise likely sit
    const match = makeMatch(7, players);
    const ids = buildPlan(match, players).startingLineup.assignments.map((a) => a.playerId);
    expect(ids).toContain("p12");
  });

  it("ALWAYS ON (not in the rotation): starts, and no planned window ever takes them off", () => {
    const players = flatSquad(10);
    players[9] = { ...players[9]!, alwaysOn: true }; // p10 would otherwise likely sit
    const match = makeMatch(7, players);
    const built = buildPlan(match, players);
    // guaranteed starter…
    expect(built.startingLineup.assignments.map((a) => a.playerId)).toContain("p10");
    // …and never scheduled off across the whole plan
    for (const w of built.plan.windows) expect(w.off).not.toContain("p10");
    expect(built.plan.windows.length).toBeGreaterThan(0); // the rest still rotate around them
  });

  it('honours fixedGK (the chosen keeper starts in goal)', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { gkPolicy: "fixedGK", fixedGkPlayerId: "p03" });
    const gk = buildPlan(match, players).startingLineup.assignments.find((a) => a.slot === "GK");
    expect(gk?.playerId).toBe("p03");
  });

  it("breaks starting ties toward players owed minutes (season carry-forward)", () => {
    const players = flatSquad(6); // onFieldCount 5 ⇒ exactly one player sits
    players[5] = { ...players[5]!, carryForwardSeconds: 600 }; // p06 is owed 10 min
    const match = makeMatch(5, players);
    const ids = buildPlan(match, players).startingLineup.assignments.map((a) => a.playerId);
    expect(ids).toContain("p06"); // the owed player starts
  });

  it("REGRESSION: a SHORT game rotates through the bench instead of settling for one lopsided window", () => {
    // 6′ game, 5 on the field, 7 in the squad (fair share ≈ 4.3′). With the old fixed tolerance the
    // planner "met tolerance" with ONE window → three players played 6′ and four played 3′, and the
    // app called it fair. The scaled tolerance + total-debt tie-break must pick more windows.
    const players = flatSquad(7, 2);
    const match = makeMatch(5, players, { periods: 1, periodLengthMinutes: 6, minStintMinutes: 2 });
    const built = buildPlan(match, players);
    expect(built.plan.windows.length).toBeGreaterThanOrEqual(2);
    const sumAbs = Object.values(built.plan.predictedFinalDebtSeconds).reduce((s, d) => s + Math.abs(d), 0);
    expect(sumAbs).toBeLessThan(400); // one-window split totals ~617s of debt; rotating ≈ 207s
  });

  it('rotationStyle "interval" places windows at the interval cadence', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 10 });
    const plan = buildPlan(match, players).plan;
    expect(plan.windows.length).toBeGreaterThan(0);
    for (const w of plan.windows) expect(w.atMinute % 10).toBe(0);
  });

  it("STABILITY: long periods (>10′) schedule no change in the first 4 minutes of a period", () => {
    const players = makeSquad(10);
    // Interval cadence chosen to land INSIDE the hold: raw windows 13′, 26′ (1′ into H2), 39′.
    const match = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 13 }); // 2×25
    const plan = buildPlan(match, players).plan;
    expect(plan.windows.length).toBeGreaterThan(0);
    for (const w of plan.windows) {
      const offset = w.atMinute % 25;
      expect(offset === 0 || offset >= 4, `window ${w.atMinute}′ is ${offset}′ into a period`).toBe(true);
    }
    // the 26′ window was PUSHED to 29′ (4′ into the second half), not dropped
    expect(plan.windows.some((w) => w.atMinute === 29)).toBe(true);

    // continuous plans obey the hold too (2×25 default)
    const cont = buildPlan(makeMatch(7, players), players).plan;
    for (const w of cont.windows) {
      const offset = w.atMinute % 25;
      expect(offset === 0 || offset >= 4, `window ${w.atMinute}′ is ${offset}′ into a period`).toBe(true);
    }
  });

  it("STABILITY off (stabilityHold:false): even subbing lands a window inside the opening minutes", () => {
    const players = makeSquad(10);
    // Same cadence as the hold test, but the coach chose even-from-kickoff.
    const held = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 13 }); // 2×25
    const even = { ...held, stabilityHold: false };
    const heldWins = buildPlan(held, players).plan.windows.map((w) => w.atMinute);
    const evenWins = buildPlan(even, players).plan.windows.map((w) => w.atMinute);
    // With the hold, the 26′ raw window is pushed to 29′; without it, it stays at 26′ (1′ into H2).
    expect(heldWins).toContain(29);
    expect(heldWins).not.toContain(26);
    expect(evenWins).toContain(26);
    // And a window sits within 4′ of a period start — exactly what the hold used to forbid.
    expect(evenWins.some((m) => m % 25 > 0 && m % 25 < 4)).toBe(true);
  });

  it("STABILITY: short periods (≤10′) are exempt so rotation isn't strangled", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, {
      periods: 4,
      periodLengthMinutes: 10,
      rotationStyle: "interval",
      intervalMinutes: 12,
    });
    const plan = buildPlan(match, players).plan;
    // 12′ is 2′ into the second quarter — allowed because the periods are short.
    expect(plan.windows.some((w) => w.atMinute === 12)).toBe(true);
  });

  it('rotationStyle "period" only subs at period boundaries', () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "period" }); // 2×25 ⇒ boundary at 25
    const plan = buildPlan(match, players).plan;
    for (const w of plan.windows) expect(w.atMinute).toBe(25);
  });

  it("no bench (squad == onFieldCount): rotation disabled, everyone plays full, fairness perfect", () => {
    const players = makeSquad(7);
    const match = makeMatch(7, players);
    const plan = buildPlan(match, players).plan;
    expect(plan.windows).toHaveLength(0);
    expect(plan.predictedMaxAbsDebtSeconds).toBeCloseTo(0, 1);
    expect(plan.toleranceInfeasible).toBe(false);
  });

  it("derives bench size from onFieldCount for an arbitrary format (10v10)", () => {
    const players = makeSquad(14);
    const match = makeMatch(10, players);
    const built = buildPlan(match, players);
    expect(built.formation.slots).toHaveLength(10);
    expect(built.startingLineup.assignments).toHaveLength(10);
    expect(built.startingLineup.bench).toHaveLength(4);
  });
});
