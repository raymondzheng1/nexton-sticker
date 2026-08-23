/**
 * 🧤 marks who is PREFERRED in goal — it is not a licence (owner decision 2026-08-23: "allow me
 * to select any player to be goalie at the setup and during the game"). A squad with nobody marked
 * used to be unable to form a plan under any policy; a designated non-keeper is honoured.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  initLiveState,
  replanFromLive,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

describe("anyone can keep goal", () => {
  it("REGRESSION: a squad with nobody marked 🧤 still forms a plan under every policy", () => {
    const players = makeSquad(9, { keepers: 0 });
    for (const gkPolicy of ["countAsFieldTime", "rotateSeparately"] as const) {
      const match = makeMatch(7, players, { gkPolicy });
      const { startingLineup } = buildPlan(match, players);
      expect(startingLineup.assignments.some((a) => a.slot === "GK")).toBe(true);
      expect(startingLineup.assignments).toHaveLength(7);
    }
  });

  it("fixedGK honours a designated keeper who is NOT marked 🧤", () => {
    const players = makeSquad(9, { keepers: 2 });
    const outfielder = players[5]!;
    const match = makeMatch(7, players, {
      gkPolicy: "fixedGK",
      gkByPeriod: [outfielder.id, outfielder.id],
      fixedGkPlayerId: outfielder.id,
    });
    const { startingLineup } = buildPlan(match, players);
    expect(startingLineup.assignments.find((a) => a.slot === "GK")?.playerId).toBe(outfielder.id);
  });

  it("a marked keeper is still PREFERRED when one is available", () => {
    const players = makeSquad(9, { keepers: 1 });
    const match = makeMatch(7, players, { gkPolicy: "countAsFieldTime" });
    const { startingLineup } = buildPlan(match, players);
    expect(startingLineup.assignments.find((a) => a.slot === "GK")?.playerId).toBe(players[0]!.id);
  });

  it("rotateSeparately with nobody marked rotates the gloves through the squad at the break", () => {
    const players = makeSquad(8, { keepers: 0 });
    const match = makeMatch(7, players, { gkPolicy: "rotateSeparately", periods: 2, periodLengthMinutes: 20 });
    const { startingLineup, plan } = buildPlan(match, players);
    const firstGk = startingLineup.assignments.find((a) => a.slot === "GK")?.playerId;
    const boundary = plan.windows.find((w) => w.atMinute === 20);
    expect(boundary).toBeDefined();
    const gkChange = boundary?.swaps.find((s) => s.toSlot === "GK") ?? boundary?.positionChanges.find((c) => c.toSlot === "GK");
    expect(gkChange).toBeDefined();
    const nextGk = "playerOn" in (gkChange ?? {}) ? (gkChange as { playerOn: string }).playerOn : (gkChange as { playerId: string }).playerId;
    expect(nextGk).not.toBe(firstGk);
  });
});

describe("the guide re-plans from an EMPTY guide (owner report, 2026-08-23)", () => {
  it("REGRESSION: a short side that fills up mid-match gets a full remaining plan, not nothing", () => {
    // 9-a-side with eight: the pre-match guide is empty ("No changes planned").
    const players = makeSquad(10).map((p, i): Player =>
      i >= 8 ? { ...p, availability: "arrives-late", unavailableUntilMinute: 40 } : p,
    );
    const match = makeMatch(9, players, { periods: 2, periodLengthMinutes: 30 });
    const { startingLineup, plan } = buildPlan(match, players);
    expect(plan.windows).toHaveLength(0);
    let live = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup: startingLineup.assignments });
    live = applyEvent(live, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
    // Two late players arrive at 10′ (what markArrived does to the squad record).
    const arrived = players.map((p) => (p.availability === "arrives-late" ? { ...p, availability: "available" as const, unavailableUntilMinute: undefined } : p));
    const guide = replanFromLive(match, arrived, live, []);
    expect(guide.length).toBeGreaterThan(1); // the whole remaining plan, not one change
    // …and the first thing it does is fill the empty slot with one of the arrivals.
    const arrivals = new Set(players.filter((p) => p.availability === "arrives-late").map((p) => p.id));
    expect(guide[0]?.on.some((o) => arrivals.has(o.playerId))).toBe(true);
  });
});
