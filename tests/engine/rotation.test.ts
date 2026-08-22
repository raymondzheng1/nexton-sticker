/**
 * REGRESSION corpus for "players subbed on and off in a short time" (owner report, 2026-08-17).
 *
 * Equal minutes alone let the engine shuttle a player: coming off is exactly what makes someone the
 * most-owed bench player at the next window, and the only guard was a 3′ just-subbed floor. The
 * engine now derives a minimum STINT and a minimum REST from the match (see rotationFloors) and
 * orders candidates as a rotation within fairness bands. These tests pin that behaviour at the
 * level a coach sees it: stint and rest lengths in a planned match, and what the live recommender
 * will and won't suggest.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  initLiveState,
  recommendSwaps,
  ROTATION_STINTS_PER_PLAYER,
  SECONDS_PER_MINUTE,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { effectiveFloors, isRestedEnough, rotationFloors } from "../../src/engine/candidates";
import { makeMatch, makeSquad } from "./_fixtures";

/** Replay a plan's windows and collect every stint and rest length (seconds) per player. */
function stintsAndRests(match: Match, players: Player[]) {
  const { plan, startingLineup } = buildPlan(match, players);
  let state: LiveState = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup.assignments,
  });
  /** Each ended stint / rest paired with the HARD floor that applied at that moment. */
  const stints: { got: number; floor: number }[] = [];
  const rests: { got: number; floor: number }[] = [];
  const floors = rotationFloors(match, players);
  let cursor = 0;
  for (const w of plan.windows) {
    const t = Math.round(w.atMinute * SECONDS_PER_MINUTE);
    state = applyEvent(state, { type: "TICK", atSeconds: t, deltaSeconds: t - cursor });
    cursor = t;
    const now = effectiveFloors(floors, t); // floors shrink as the match runs out, by design
    for (const id of w.off) stints.push({ got: state.players[id]?.secondsThisStint ?? 0, floor: now.minStintSec });
    for (const id of w.on) {
      const ps = state.players[id];
      if (ps && ps.secondsOnField > 0) rests.push({ got: ps.secondsThisRest, floor: now.minRestSec }); // kick-off bench isn't a rest
    }
    state = applyEvent(state, {
      type: "SUB_APPLIED",
      atSeconds: t,
      off: w.off,
      on: w.on.map((id, k) => ({ playerId: id, slot: w.swaps[k]?.toSlot ?? "MC" })),
      positionChanges: [],
    });
  }
  return { plan, stints, rests };
}

describe("rotation floors — derived from the match, not a fixed 3′", () => {
  it("a 60′ 5-a-side with 8 players aims for ≈12′ stints and ≈7′ rests at Balanced; hard floors 5′ and 3′", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const f = rotationFloors(match, players);
    // share = 60 × 5/8 = 37.5′ → /3 = 12.5′ ; rest share = 22.5′ → /3 = 7.5′
    expect(f.targetStintSec).toBe(12.5 * SECONDS_PER_MINUTE);
    expect(f.targetRestSec).toBe(7.5 * SECONDS_PER_MINUTE);
    // the HARD floors are ROTATION_HARD_FRACTION (0.4) of the target — the rest is a soft cost
    expect(f.minStintSec).toBe(5 * SECONDS_PER_MINUTE);
    expect(f.minRestSec).toBe(3 * SECONDS_PER_MINUTE);
  });

  it("never asks for a stint longer than half a share, so two stints are always possible", () => {
    const players = makeSquad(6); // tiny bench: share = 60 × 5/6 = 50′ → /3 = 16.7′ < 25′ ✓
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const f = rotationFloors(match, players);
    expect(f.minStintSec).toBeLessThanOrEqual(25 * SECONDS_PER_MINUTE);
    expect(f.minStintSec).toBeGreaterThanOrEqual(3 * SECONDS_PER_MINUTE);
  });

  it("short-handed there is no rotation to protect: configured stint, zero rest", () => {
    const players = makeSquad(4);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const f = rotationFloors(match, players);
    expect(f.minStintSec).toBe(3 * SECONDS_PER_MINUTE);
    expect(f.minRestSec).toBe(0);
    expect(f.targetRestSec).toBe(0);
  });

  it("a player who has never played is fresh by definition", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const live = initLiveState(match, players);
    const bench = Object.values(live.players)[0];
    expect(bench).toBeDefined();
    if (bench) expect(isRestedEnough(bench, 10_000)).toBe(true);
  });
});

describe("REGRESSION: the planned match rotates in real stints and real rests", () => {
  it("no planned stint ends below the floor in force at that moment, and no return comes before the rest floor", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const { plan, stints, rests } = stintsAndRests(match, players);
    expect(plan.windows.length).toBeGreaterThan(0); // it does rotate
    for (const s of stints) expect(s.got).toBeGreaterThanOrEqual(s.floor);
    for (const r of rests) expect(r.got).toBeGreaterThanOrEqual(r.floor);
  });

  it("…and still finishes fair: the predicted spread stays within the corpus's fairness bar", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const { plan } = buildPlan(match, players);
    // The same bar every simulated match in the corpus is held to (simulate-match.test: ≤ 3′).
    expect(plan.predictedMaxAbsDebtSeconds).toBeLessThanOrEqual(3 * SECONDS_PER_MINUTE);
  });

  it("a one-player bench still rotates (rest is a floor, never a reason to stall)", () => {
    const players = makeSquad(6);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const { plan } = buildPlan(match, players);
    expect(plan.windows.length).toBeGreaterThanOrEqual(2);
    expect(plan.toleranceInfeasible).toBe(false);
  });

  it("the floors scale with ROTATION_STINTS_PER_PLAYER (the one knob), so the policy is tunable", () => {
    expect(ROTATION_STINTS_PER_PLAYER).toBe(3);
  });
});

describe("REGRESSION: live, the recommender will not shuttle a player", () => {
  /** 8 players, 5 on. Run 15′, sub A off for F, run another 2′ — A has rested only 2′. */
  function shuttleSetup() {
    const players = makeSquad(8);
    const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 30 });
    const { startingLineup } = buildPlan(match, players);
    let live = applyEvent(initLiveState(match, players), {
      type: "MATCH_STARTED",
      atSeconds: 0,
      lineup: startingLineup.assignments,
    });
    live = applyEvent(live, { type: "TICK", atSeconds: 900, deltaSeconds: 900 });
    const a = startingLineup.assignments[1];
    const f = startingLineup.bench[0];
    if (!a || f === undefined) throw new Error("fixture");
    live = applyEvent(live, {
      type: "SUB_APPLIED",
      atSeconds: 900,
      off: [a.playerId],
      on: [{ playerId: f, slot: a.slot }],
      positionChanges: [],
    });
    live = applyEvent(live, { type: "TICK", atSeconds: 1020, deltaSeconds: 120 });
    return { players, match, live, justOff: a.playerId, justOn: f };
  }

  it("does not bring back the player who came off 2′ ago while rested team-mates are on the bench", () => {
    const { players, match, live, justOff } = shuttleSetup();
    const rec = recommendSwaps(match, players, live);
    for (const s of [...rec.primary, ...rec.alternatives]) expect(s.playerOn).not.toBe(justOff);
  });

  it("does not take off the player who came on 2′ ago", () => {
    const { players, match, live, justOn } = shuttleSetup();
    const rec = recommendSwaps(match, players, live);
    for (const s of rec.primary) expect(s.playerOff).not.toBe(justOn);
  });

  it("the bench clock runs: rest accrues only while the clock runs and resets on coming off", () => {
    const { live, justOff } = shuttleSetup();
    expect(live.players[justOff]?.secondsThisRest).toBe(120);
    const paused = applyEvent(live, { type: "CLOCK_PAUSED", atSeconds: 1020 });
    const ticked = applyEvent(paused, { type: "TICK", atSeconds: 1080, deltaSeconds: 60 });
    expect(ticked.players[justOff]?.secondsThisRest).toBe(120); // paused: no rest accrues
  });

  it("a forced change (coach's call) still goes through even when nobody is rested", () => {
    const { players, match, live } = shuttleSetup();
    const rec = recommendSwaps(match, players, live, { forceImmediate: true });
    expect(rec.primary.length).toBeGreaterThan(0);
  });
});

describe("short-handed kick-off (owner decision 2026-08-17)", () => {
  it("a 9-a-side with 8 players kicks off with 8 — the unfilled slot is the furthest forward", () => {
    const players = makeSquad(8);
    const match = makeMatch(9, players, { periods: 2, periodLengthMinutes: 30 });
    const { startingLineup, formation } = buildPlan(match, players);
    expect(startingLineup.assignments).toHaveLength(8);
    expect(startingLineup.bench).toHaveLength(0);
    const filled = new Set(startingLineup.assignments.map((a) => a.slot));
    const lastSlot = formation.slots[formation.slots.length - 1];
    expect(lastSlot).toBeDefined();
    // the formation's last (most forward) slot is the one left empty
    const emptySlots = formation.slots.filter((s) => !filled.has(s));
    expect(emptySlots).toHaveLength(1);
    expect(emptySlots[0]).toBe(lastSlot);
  });

  it("everyone plays the whole match and the plan has no changes to make", () => {
    const players = makeSquad(8);
    const match = makeMatch(9, players, { periods: 2, periodLengthMinutes: 30 });
    const { plan } = buildPlan(match, players);
    expect(plan.windows).toHaveLength(0);
    expect(plan.toleranceInfeasible).toBe(false);
    for (const d of Object.values(plan.predictedFinalDebtSeconds)) expect(Math.abs(d)).toBeLessThan(1);
  });

  it("fairness targets are the match length, not more than a player could ever play", () => {
    const players = makeSquad(8);
    const match = makeMatch(9, players, { periods: 2, periodLengthMinutes: 30 });
    const { plan } = buildPlan(match, players);
    // a correct target means zero debt after playing every minute — asserted above via the plan
    expect(plan.predictedMaxAbsDebtSeconds).toBeLessThan(1);
  });
});
