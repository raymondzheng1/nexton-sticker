/**
 * REGRESSION corpus for the short-handed dead end (QA sweep, 2026-08-17): a 9-a-side that kicked
 * off with eight could NEVER get back to nine. The engine only ever swapped like-for-like, so when
 * the ninth player arrived it benched a starter to get them on and the side stayed a player down —
 * then scheduled a conveyor belt of pointless changes. The empty slot is now filled first.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  computeTargets,
  initLiveState,
  planFromState,
  recommendSwaps,
  recommendationFromWindow,
  onFieldIds,
  type LiveState,
  type Player,
} from "../../src/engine/index";
import { vacantSlots } from "../../src/engine/candidates";
import { makeMatch, makeSquad } from "./_fixtures";

/** Nine players, one arriving late, 9-a-side 2×30: kicks off with eight and one empty slot. */
function shortSide() {
  const players = makeSquad(9).map((p, i): Player =>
    i === 8 ? { ...p, availability: "arrives-late", unavailableUntilMinute: 25 } : p,
  );
  const late = players[8]!;
  const match = makeMatch(9, players, { periods: 2, periodLengthMinutes: 30 });
  const { startingLineup } = buildPlan(match, players);
  let live: LiveState = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup: startingLineup.assignments,
  });
  live = applyEvent(live, { type: "TICK", atSeconds: 1200, deltaSeconds: 1200 });
  // The coach taps 🕑 Arrived at 20′ — exactly what markArrived does to the squad record.
  const arrived = players.map((p) => (p.id === late.id ? { ...p, availability: "available" as const, unavailableUntilMinute: undefined } : p));
  return { match, players: arrived, live, late };
}

describe("a short-handed side gets back to full strength", () => {
  it("kicks off with eight and one vacant slot", () => {
    const { match, live } = shortSide();
    expect(onFieldIds(live)).toHaveLength(8);
    expect(vacantSlots(match, live)).toHaveLength(1);
  });

  it("REGRESSION: the live recommender puts the arrival INTO the empty slot — nobody comes off", () => {
    const { match, players, live, late } = shortSide();
    const rec = recommendSwaps(match, players, live);
    const fill = rec.primary.find((s) => s.playerOn === late.id);
    expect(fill).toBeDefined();
    expect(fill?.playerOff).toBeNull();
    // …and applying the whole recommendation leaves nine on the pitch
    const after = applyEvent(live, {
      type: "SUB_APPLIED",
      atSeconds: live.elapsedSeconds,
      off: rec.primary.map((s) => s.playerOff).filter((id): id is string => id !== null),
      on: rec.primary.map((s) => ({ playerId: s.playerOn, slot: s.toSlot })),
      positionChanges: [],
    });
    expect(onFieldIds(after)).toHaveLength(9);
    expect(vacantSlots(match, after)).toHaveLength(0);
  });

  it("REGRESSION: the forward plan's first window is the fill, and a window built from it survives sanitising", () => {
    const { match, players, live, late } = shortSide();
    const plan = planFromState(match, players, live);
    const first = plan.windows[0];
    expect(first).toBeDefined();
    expect(first?.on).toContain(late.id);
    expect(first?.off).toHaveLength(0);
    const window = { atSeconds: Math.round((first?.atMinute ?? 0) * 60), off: first?.off ?? [], on: (first?.on ?? []).map((id, k) => ({ playerId: id, slot: first?.swaps[k]?.toSlot ?? "MC" })), positionChanges: [] };
    const fromWindow = recommendationFromWindow(match, players, live, window);
    expect(fromWindow.primary.some((s) => s.playerOn === late.id && s.playerOff === null)).toBe(true);
  });

  it("a full side has no vacancies and no fills", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const { startingLineup } = buildPlan(match, players);
    const live = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup: startingLineup.assignments });
    expect(vacantSlots(match, live)).toHaveLength(0);
    const rec = recommendSwaps(match, players, applyEvent(live, { type: "TICK", atSeconds: 900, deltaSeconds: 900 }));
    expect(rec.primary.every((s) => s.playerOff !== null)).toBe(true);
  });
});

describe("a fixed keeper who can't start (QA sweep, 2026-08-17)", () => {
  it("REGRESSION: kick-off falls back to a keeper who IS here instead of putting an absent one in goal", () => {
    const players = makeSquad(9).map((p, i): Player => ({
      ...p,
      canPlayGK: i < 2, // two keepers; the designated one is late
      ...(i === 0 ? { availability: "arrives-late" as const, unavailableUntilMinute: 15 } : {}),
    }));
    const match = makeMatch(9, players, { gkPolicy: "fixedGK", gkByPeriod: [players[0]!.id, players[0]!.id], fixedGkPlayerId: players[0]!.id });
    const { startingLineup } = buildPlan(match, players);
    const gk = startingLineup.assignments.find((a) => a.slot === "GK");
    expect(gk?.playerId).toBe(players[1]!.id);
    expect(startingLineup.assignments.some((a) => a.playerId === players[0]!.id)).toBe(false);
  });

  it("REGRESSION: the fairness verdict no longer throws when the designated keeper is not in the available squad", () => {
    const players = makeSquad(9).map((p, i): Player => ({ ...p, canPlayGK: i < 2 }));
    const match = makeMatch(9, players, { gkPolicy: "fixedGK", gkByPeriod: [players[0]!.id, players[0]!.id], fixedGkPlayerId: players[0]!.id, availableSquad: players.slice(1).map((p) => p.id) });
    expect(() => planFromState(match, players, initLiveState(match, players))).not.toThrow();
  });
});

describe("short-handed fairness targets are honest in every keeper policy", () => {
  const ON_PITCH = 8; // eight players on a 9-a-side: the pitch only ever holds eight
  const TOTAL = 2 * 30 * 60;
  for (const gkPolicy of ["countAsFieldTime", "rotateSeparately", "fixedGK"] as const) {
    it(`${gkPolicy}: targets add up to what the pitch can hold, not the formation's nine slots`, () => {
      const players = makeSquad(8).map((p, i): Player => ({ ...p, canPlayGK: i < 2 }));
      const match = makeMatch(9, players, {
        gkPolicy,
        ...(gkPolicy === "fixedGK" ? { gkByPeriod: [players[0]!.id, players[0]!.id], fixedGkPlayerId: players[0]!.id } : {}),
      });
      const { targetSeconds } = computeTargets(match, players);
      const sum = Object.values(targetSeconds).reduce((a, b) => a + b, 0);
      // Before the clamp every branch shared 9 slots' worth of seconds among 8 players: everyone
      // was "owed" more than the whole match and read as behind all game.
      expect(sum).toBeLessThanOrEqual(ON_PITCH * TOTAL + 1);
      expect(Object.values(targetSeconds).every((t) => t <= TOTAL + 1)).toBe(true);
    });
  }

  for (const gkPolicy of ["countAsFieldTime", "fixedGK"] as const) {
    it(`${gkPolicy}: eight players on a 9-a-side finish level, not "behind"`, () => {
      const players = makeSquad(8).map((p, i): Player => ({ ...p, canPlayGK: i < 2 }));
      const match = makeMatch(9, players, {
        gkPolicy,
        ...(gkPolicy === "fixedGK" ? { gkByPeriod: [players[0]!.id, players[0]!.id], fixedGkPlayerId: players[0]!.id } : {}),
      });
      const { plan } = buildPlan(match, players);
      expect(plan.predictedMaxAbsDebtSeconds).toBeLessThan(1);
    });
  }
  // rotateSeparately with no bench is inherently uneven (the two keepers' outfield time is a half
  // shorter than everyone else's) — that is the policy's nature, not a short-handed defect.
});
