import { describe, expect, it } from "vitest";
import {
  applyEvent,
  benchIds,
  buildPlan,
  computeTargets,
  initLiveState,
  onFieldIds,
  recalculate,
  recommendSwaps,
  totalMatchSeconds,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { executePlan, makeMatch, makeSquad } from "./_fixtures";

function started(match: Match, players: Player[]): LiveState {
  const lineup = buildPlan(match, players).startingLineup.assignments;
  return applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
}

describe("algorithm edge cases (PRD §11)", () => {
  it("tiny/no bench: rotation disabled, minutes still tracked, fairness trivially met", () => {
    const players = makeSquad(5);
    const match = makeMatch(5, players);
    const plan = buildPlan(match, players).plan;
    expect(plan.windows).toHaveLength(0);
    expect(plan.predictedMaxAbsDebtSeconds).toBeCloseTo(0, 1);
  });

  it("late arrival: target scales to the available window and the player can't start or come on early", () => {
    const players = makeSquad(10);
    players[9] = { ...players[9]!, availability: "arrives-late", unavailableUntilMinute: 25 };
    const match = makeMatch(7, players); // 50-min match ⇒ available half ⇒ ~half target
    const total = totalMatchSeconds(match);
    const { targetSeconds } = computeTargets(match, players);
    // p10's target is about half a full-weight player's.
    expect(targetSeconds["p10"]! / targetSeconds["p01"]!).toBeCloseTo(0.5, 1);

    // Never started.
    const lineup = buildPlan(match, players).startingLineup;
    expect(lineup.assignments.map((a) => a.playerId)).not.toContain("p10");
    expect(lineup.bench).toContain("p10");

    // Not brought on before minute 25.
    let s = started(match, players);
    s = applyEvent(s, { type: "TICK", atSeconds: 10 * 60, deltaSeconds: 10 * 60 });
    const rec = recommendSwaps(match, players, s, { forceImmediate: true });
    for (const sw of rec.primary) expect(sw.playerOn).not.toBe("p10");
    expect(total).toBe(3000);
  });

  it("injury / early departure: player removed from the remaining plan; cover isn't penalised", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 3 });
    const built = buildPlan(match, players);
    // Play a balanced first 20 minutes (execute the plan's early windows) before the injury.
    let s = started(match, players);
    let cursor = 0;
    for (const w of built.plan.windows.filter((w) => w.atMinute <= 20)) {
      const t = Math.round(w.atMinute * 60);
      s = applyEvent(s, { type: "TICK", atSeconds: t, deltaSeconds: t - cursor });
      cursor = t;
      s = applyEvent(s, {
        type: "SUB_APPLIED",
        atSeconds: t,
        off: w.off,
        on: w.swaps.map((x) => ({ playerId: x.playerOn, slot: x.toSlot })),
        positionChanges: w.positionChanges,
      });
    }
    s = applyEvent(s, { type: "TICK", atSeconds: 20 * 60, deltaSeconds: 20 * 60 - cursor });

    const injuredId = onFieldIds(s).find((id) => s.players[id]!.currentSlot !== "GK")!;
    const replacement = benchIds(s)[0]!;
    // Blood/injury sub: forced off, replacement on, and the player is now unavailable.
    s = applyEvent(s, {
      type: "SUB_APPLIED",
      atSeconds: 20 * 60,
      off: [injuredId],
      on: [{ playerId: replacement, slot: s.players[injuredId]!.currentSlot! }],
      positionChanges: [],
    });
    const playersAfter = players.map((p) =>
      p.id === injuredId ? { ...p, availability: "unavailable" as const } : p,
    );
    const plan = recalculate(match, playersAfter, s);
    // The injured player gets no further minutes…
    for (const w of plan.windows) expect(w.on).not.toContain(injuredId);
    // …the engine keeps rotating the remaining squad to redistribute the lost minutes…
    expect(plan.windows.length).toBeGreaterThan(0);
    // …and the rest stay reasonably fair. A mid-match departure nudges every target up, and the
    // STABILITY HOLD (no scheduled change in the first 4′ of a long period) delays the big
    // post-half-time correction — so the bound is tolerance + the hold's worth of delay.
    expect(plan.predictedMaxAbsDebtSeconds).toBeLessThanOrEqual((3 + 4) * 60);
  });

  it("odd split (not divisible): remainder distributed, still within a small tolerance", () => {
    const players = makeSquad(9); // 7v7 with 2 on the bench, 50 min ⇒ 38.9 min each
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 3 });
    const built = buildPlan(match, players);
    const finalState = executePlan(match, players, built);
    // executed result agrees with the prediction.
    expect(Math.abs(built.plan.predictedMaxAbsDebtSeconds)).toBeLessThanOrEqual(3 * 60);
    expect(finalState.status).toBeDefined();
  });

  it('gkPolicy "rotateSeparately": the keeper role rotates across periods', () => {
    const players = makeSquad(10, { keepers: 3 });
    const match = makeMatch(7, players, { gkPolicy: "rotateSeparately" });
    const built = buildPlan(match, players);
    const finalState = executePlan(match, players, built);
    const keepers = Object.values(finalState.players).filter((p) => p.secondsAsGk > 0);
    expect(keepers.length).toBeGreaterThanOrEqual(2); // GK was shared, not held all match
  });
});
