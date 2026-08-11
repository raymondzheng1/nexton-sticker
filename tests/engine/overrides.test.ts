import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  computeTargets,
  initLiveState,
  keepPlayerOn,
  onFieldIds,
  overrideTradeoffNote,
  pinPlayer,
  recalculate,
  restPlayerNow,
  setMustStart,
  setReducedMinutes,
  snoozeNextSub,
  totalMatchSeconds,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

function started(match: Match, players: Player[]): LiveState {
  const lineup = buildPlan(match, players).startingLineup.assignments;
  return applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
}

describe("manager overrides (PRD §7.6)", () => {
  it("keepPlayerOn locks a player — never suggested off, plays more, engine balances around them", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 3 });
    let s = started(match, players);
    const keyId = onFieldIds(s).find((id) => s.players[id]!.currentSlot !== "GK")!;
    s = applyEvent(s, keepPlayerOn(keyId, 0, true));
    expect(s.players[keyId]!.locked).toBe(true);

    const plan = recalculate(match, players, s);
    // The locked player is never scheduled off…
    for (const w of plan.windows) expect(w.off).not.toContain(keyId);
    // …and ends up over their fair share (played more than target ⇒ negative debt).
    expect(plan.predictedFinalDebtSeconds[keyId]!).toBeLessThan(0);
  });

  it("pinPlayer keeps a player in their slot (not moved, not subbed off)", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    let s = started(match, players);
    const pinId = onFieldIds(s).find((id) => s.players[id]!.currentSlot !== "GK")!;
    const slot = s.players[pinId]!.currentSlot!;
    s = applyEvent(s, pinPlayer(pinId, 0, slot));
    expect(s.players[pinId]!.pinnedSlot).toBe(slot);
    const plan = recalculate(match, players, s);
    for (const w of plan.windows) {
      expect(w.off).not.toContain(pinId);
      expect(w.positionChanges.find((pc) => pc.playerId === pinId)).toBeUndefined();
    }
  });

  it("snoozeNextSub delays the next window", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "interval", intervalMinutes: 5 });
    let s = started(match, players);
    s = applyEvent(s, { type: "TICK", atSeconds: 5 * 60, deltaSeconds: 5 * 60 });
    s = applyEvent(s, snoozeNextSub(5 * 60, 10)); // snooze 10 min ⇒ until 15:00
    const plan = recalculate(match, players, s);
    for (const w of plan.windows) expect(w.atMinute).toBeGreaterThanOrEqual(15);
  });

  it("restPlayerNow forces a player off and brings on the best replacement", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    let s = started(match, players);
    s = applyEvent(s, { type: "TICK", atSeconds: 5 * 60, deltaSeconds: 5 * 60 });
    const restId = onFieldIds(s).find((id) => s.players[id]!.currentSlot !== "GK")!;
    const ev = restPlayerNow(match, players, s, restId, 5 * 60);
    expect(ev.type).toBe("SUB_APPLIED");
    s = applyEvent(s, ev);
    expect(s.players[restId]!.onField).toBe(false);
    expect(onFieldIds(s)).toHaveLength(match.onFieldCount); // a replacement came on
  });

  it("setReducedMinutes scales the fairness target down (returns a new Player, additive)", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players);
    const fullTarget = computeTargets(match, players).targetSeconds["p02"]!;

    const reduced = players.map((p) => (p.id === "p02" ? setReducedMinutes(p, 0.5) : p));
    expect(players.find((p) => p.id === "p02")!.minutesWeight).toBe(1); // original untouched
    const reducedTarget = computeTargets(match, reduced).targetSeconds["p02"]!;
    expect(reducedTarget).toBeLessThan(fullTarget);
  });

  it("setMustStart guarantees a player in the XI", () => {
    const players = makeSquad(12).map((p, i) => (i === 11 ? setMustStart(p, true) : p));
    const match = makeMatch(7, players);
    const ids = buildPlan(match, players).startingLineup.assignments.map((a) => a.playerId);
    expect(ids).toContain("p12");
  });

  it("overrideTradeoffNote warns (non-blocking) when locks make equal time impossible", () => {
    const players = makeSquad(9); // small bench
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 2 });
    let s = started(match, players);
    // Lock every outfield + GK player on → the bench can never get minutes.
    for (const id of onFieldIds(s)) s = applyEvent(s, keepPlayerOn(id, 0, true));
    const note = overrideTradeoffNote(match, players, s);
    expect(note).toContain("short");
    // It is advisory only — the plan is still produced, never blocked.
    expect(recalculate(match, players, s)).toBeDefined();
  });

  it("returns no trade-off note when fairness is still achievable", () => {
    const players = makeSquad(10);
    const match = makeMatch(7, players, { rotationStyle: "continuous", fairnessToleranceMinutes: 3 });
    const s = started(match, players);
    expect(overrideTradeoffNote(match, players, s)).toBe("");
  });
});

describe("totalMatchSeconds helper", () => {
  it("computes periods × length", () => {
    const players = makeSquad(8);
    expect(totalMatchSeconds(makeMatch(5, players, { periods: 2, periodLengthMinutes: 25 }))).toBe(3000);
    expect(totalMatchSeconds(makeMatch(5, players, { periods: 4, periodLengthMinutes: 15 }))).toBe(3600);
  });
});
