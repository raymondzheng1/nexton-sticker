/**
 * Retiring a player mid-match (`Player.availableUntilMinute`) — the mirror image of a late arrival.
 *
 * The fairness question is the whole feature: when someone goes off injured at minute 20 of 60, the
 * minutes they can no longer play have to land on the players who CAN play them. If they didn't,
 * every remaining player would be chasing a target the match can no longer supply, and the app would
 * end up telling a coach nobody got their fair share when in fact everybody did.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  computeTargets,
  initLiveState,
  isBenchEligibleNow,
  isRetiredAt,
  isStartableAtKickoff,
  recommendSwaps,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad, min } from "./_fixtures";

describe("retiring a player mid-match", () => {
  it("hands the minutes they can no longer play to everyone still on", () => {
    const players = makeSquad(16);
    const match = makeMatch(11, players, { periodLengthMinutes: 30 }); // 2 × 30′ = 60′
    const before = computeTargets(match, players).targetSeconds;

    // p16 goes off at minute 20 of 60 — a third of the match.
    const retired: Player[] = players.map((p) =>
      p.id === "p16" ? { ...p, availableUntilMinute: 20 } : p,
    );
    const after = computeTargets(match, retired).targetSeconds;

    // Their own target shrinks to roughly the third of the game they were available for…
    expect(after["p16"]).toBeLessThan((before["p16"] as number) * 0.45);
    // …and everyone else's rises to absorb it.
    for (const id of ["p01", "p08", "p15"]) {
      expect(after[id]).toBeGreaterThan(before[id] as number);
    }
    // Total field-seconds are conserved: nobody is asked to play time that doesn't exist.
    const total = Object.values(after).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(11 * min(60), 0);
  });

  it("is never suggested on again once they're out", () => {
    const players = makeSquad(14).map((p) => (p.id === "p14" ? { ...p, availableUntilMinute: 20 } : p));
    const match = makeMatch(9, players, { periodLengthMinutes: 30 });
    const built = buildPlan(match, players);
    // Take the match to minute 30, past their retirement.
    let state = applyEvent(initLiveState(match, players), {
      type: "MATCH_STARTED",
      atSeconds: 0,
      lineup: built.startingLineup.assignments,
    });
    state = applyEvent(state, { type: "TICK", atSeconds: min(30), deltaSeconds: min(30) });

    const retiree = players.find((p) => p.id === "p14") as Player;
    expect(isRetiredAt(retiree, min(30))).toBe(true);
    expect(isBenchEligibleNow(match, retiree, min(30))).toBe(false);

    const rec = recommendSwaps(match, players, state, { forceImmediate: true });
    expect(rec.primary.map((s) => s.playerOn)).not.toContain("p14");
    expect(rec.alternatives.map((s) => s.playerOn)).not.toContain("p14");
  });

  it("never appears in a plan window after their minute", () => {
    const players = makeSquad(14).map((p) => (p.id === "p14" ? { ...p, availableUntilMinute: 20 } : p));
    const match = makeMatch(9, players, { periodLengthMinutes: 30 });
    const plan = buildPlan(match, players).plan;
    for (const w of plan.windows) {
      if (w.atMinute >= 20) expect(w.on).not.toContain("p14");
    }
  });

  it("clearing the mark puts them straight back in the rotation, owed the minutes they missed", () => {
    // Un-retire is a plain clear, not a second availability window: they're a full squad member
    // again, their zero minutes read as debt, and the engine catches them up (the same call the
    // coach made for late arrivals).
    const players = makeSquad(14);
    const match = makeMatch(9, players, { periodLengthMinutes: 30 });
    const out = players.map((p) => (p.id === "p14" ? { ...p, availableUntilMinute: 20 } : p));
    const back = out.map((p) => (p.id === "p14" ? { ...p, availableUntilMinute: undefined } : p));

    expect(computeTargets(match, back).targetSeconds["p14"]).toBeCloseTo(
      computeTargets(match, players).targetSeconds["p14"] as number,
      0,
    );
    expect(isBenchEligibleNow(match, back[13] as Player, min(30))).toBe(true);
  });

  it("someone marked out before kick-off can't be in the starting lineup", () => {
    const players = makeSquad(14);
    const out = { ...(players[13] as Player), availableUntilMinute: 0 };
    expect(isStartableAtKickoff(out)).toBe(false);
    expect(isStartableAtKickoff(players[13] as Player)).toBe(true);
  });

  it("their unfixable head start never makes the squad look unfair", () => {
    // A player pulled off at 20′ was ON the pitch for all 20, so they finish AHEAD of their
    // pro-rated share. Nothing the coach does can undo that. Counting it in the verdict pinned
    // predictedMaxAbsDebtSeconds above tolerance for the rest of the match, which (a) told the
    // coach the squad couldn't be balanced when everyone still playing was level and (b) stopped
    // the continuous planner ever hitting its early return, so it re-ran its whole search on
    // every commit for the rest of the game.
    const players = makeSquad(16).map((p) => (p.id === "p16" ? { ...p, availableUntilMinute: 20 } : p));
    const match = makeMatch(11, players, { periodLengthMinutes: 30 });
    const { excludedFromFairness } = computeTargets(match, players);
    expect(excludedFromFairness.has("p16")).toBe(true);

    const plan = buildPlan(match, players).plan;
    expect(plan.predictedMaxAbsDebtSeconds).toBeLessThanOrEqual(
      match.fairnessToleranceMinutes * 60,
    );
    expect(plan.toleranceInfeasible).toBe(false);
  });

  it("the keeper nominated for the second half is not dragged back on after being retired", () => {
    // forceGk pushes the designated keeper into goal at each period break. With no availability
    // check it would sub a player who had left the match back onto the pitch.
    const players = makeSquad(14, { keepers: 2 }).map((p) =>
      p.id === "p02" ? { ...p, availableUntilMinute: 20 } : p,
    );
    const match = makeMatch(9, players, {
      periodLengthMinutes: 30,
      gkPolicy: "fixedGK",
      gkByPeriod: ["p01", "p02"], // p02 keeps the second half — but is retired at 20′
    });
    const plan = buildPlan(match, players).plan;
    for (const w of plan.windows) {
      expect(w.on, `window at ${w.atMinute}′ brought a retired keeper on`).not.toContain("p02");
    }
  });

  it("a retirement doesn't apply retroactively to earlier moments in the match", () => {
    // Plans and reports replay past states; a player retired at 20′ was perfectly available at 10′.
    const retiree = { ...(makeSquad(14)[13] as Player), availableUntilMinute: 20 };
    expect(isRetiredAt(retiree, min(10))).toBe(false);
    expect(isRetiredAt(retiree, min(20))).toBe(true);
    expect(isRetiredAt(retiree, min(21))).toBe(true);
  });
});
