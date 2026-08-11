import { describe, expect, it } from "vitest";
import {
  applyEvent,
  benchIds,
  buildPlan,
  initLiveState,
  onFieldIds,
  recommendSwaps,
  swapScore,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

/** A running match state, `elapsedMin` minutes in, with the recommended XI on the field. */
function runningState(match: Match, players: Player[], elapsedMin: number): LiveState {
  const lineup = buildPlan(match, players).startingLineup.assignments;
  let s = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
  const sec = elapsedMin * 60;
  if (sec > 0) s = applyEvent(s, { type: "TICK", atSeconds: sec, deltaSeconds: sec });
  return s;
}

describe("recommendSwaps (PRD §7.4) — advisory", () => {
  it("suggests bringing an over-played player OFF for an under-played player ON", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6); // bench has sat 6 min, starters over
    const rec = recommendSwaps(match, players, state);
    expect(rec.primary.length).toBeGreaterThan(0);
    const first = rec.primary[0]!;
    expect(onFieldIds(state)).toContain(first.playerOff);
    expect(benchIds(state)).toContain(first.playerOn);
    expect(first.onDebtSeconds).toBeGreaterThan(0); // incoming is under-played
    expect(first.offDebtSeconds).toBeLessThan(0); // outgoing is over-played
  });

  it("is purely advisory — it does not mutate the live state", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const snapshot = JSON.parse(JSON.stringify(state));
    recommendSwaps(match, players, state);
    expect(state).toEqual(snapshot);
  });

  it("supports a multi-substitution batch (2+ swaps at once)", () => {
    const players = makeSquad(8); // bench of 3
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const rec = recommendSwaps(match, players, state);
    expect(rec.primary.length).toBeGreaterThanOrEqual(2);
    // No player appears twice across the batch.
    const off = rec.primary.map((s) => s.playerOff);
    const on = rec.primary.map((s) => s.playerOn);
    expect(new Set(off).size).toBe(off.length);
    expect(new Set(on).size).toBe(on.length);
  });

  it("respects maxSwaps (single-sub mode)", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const rec = recommendSwaps(match, players, state, { maxSwaps: 1 });
    expect(rec.primary).toHaveLength(1);
  });

  it("NEVER suggests a locked key player OFF (PRD §7.6)", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const lockedId = onFieldIds(state)[0]!;
    state.players[lockedId]!.locked = true;
    const rec = recommendSwaps(match, players, state);
    for (const s of [...rec.primary, ...rec.alternatives]) expect(s.playerOff).not.toBe(lockedId);
  });

  it("never suggests a pinned player OFF", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const pinnedId = onFieldIds(state)[0]!;
    state.players[pinnedId]!.pinnedSlot = state.players[pinnedId]!.currentSlot;
    const rec = recommendSwaps(match, players, state);
    for (const s of rec.primary) expect(s.playerOff).not.toBe(pinnedId);
  });

  it("just-subbed protection: won't pull a fresh player unless the coach forces it", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players, { minStintMinutes: 3 });
    const state = runningState(match, players, 1); // only 1 min in → everyone fresh
    expect(recommendSwaps(match, players, state).primary).toHaveLength(0);
    // forceImmediate overrides the protection.
    expect(recommendSwaps(match, players, state, { forceImmediate: true }).primary.length).toBeGreaterThan(0);
  });

  it("offers 1–2 alternatives for the primary off-slot", () => {
    const players = makeSquad(9); // bench of 4 ⇒ alternatives exist
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const rec = recommendSwaps(match, players, state);
    expect(rec.alternatives.length).toBeGreaterThan(0);
    expect(rec.alternatives.length).toBeLessThanOrEqual(2);
  });
});

describe("swapScore (PRD §7.4 weighting)", () => {
  it("rewards bringing on a more-owed player", () => {
    expect(swapScore(10, -5, 1, 0)).toBeGreaterThan(swapScore(2, -5, 1, 0));
  });
  it("rewards taking off a more over-played player (more-negative offGoing debt)", () => {
    expect(swapScore(5, -10, 1, 0)).toBeGreaterThan(swapScore(5, -1, 1, 0));
  });
  it("penalises pulling someone with too short a stint", () => {
    expect(swapScore(5, -5, 1, 0)).toBeGreaterThan(swapScore(5, -5, 1, 2));
  });
});

describe("recommendSwaps forceOff (coach taps a player → Sub off → review, PRD §7.4/§7.6)", () => {
  it("suggests a replacement for exactly the forced-off player, even early (bypasses just-subbed)", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 1); // only 1 min in — normally too fresh to pull
    const offId = onFieldIds(state).find((id) => state.players[id]!.currentSlot !== "GK")!;

    const rec = recommendSwaps(match, players, state, { forceOff: [offId] });
    expect(rec.primary).toHaveLength(1);
    expect(rec.primary[0]!.playerOff).toBe(offId);
    expect(benchIds(state)).toContain(rec.primary[0]!.playerOn);
    // LIKE-FOR-LIKE: the incoming player takes the EXACT vacated slot — never a preference-driven
    // reshuffle (no positionChanges). Preferred position is suggestion-only.
    expect(rec.primary[0]!.toSlot).toBe(state.players[offId]!.currentSlot);
    expect(rec.positionChanges).toHaveLength(0);
  });

  it("never reshuffles on-field players — every suggested sub is like-for-like (no positionChanges)", () => {
    // Narrow eligibility so the best bench pick fits the vacated slot poorly; previously the engine
    // would chain-move an on-field player. Now the incoming simply takes the vacated slot.
    const players = makeSquad(10, { broad: false }); // each eligible for ONE group only
    const match = makeMatch(7, players);
    const state = runningState(match, players, 8);
    const rec = recommendSwaps(match, players, state, { forceImmediate: true });
    expect(rec.positionChanges).toHaveLength(0);
    for (const s of rec.primary) {
      const off = state.players[s.playerOff ?? ""];
      expect(s.toSlot).toBe(off?.currentSlot); // incoming inherits the off player's slot exactly
    }
  });

  it("can force multiple players off at once (batch)", () => {
    const players = makeSquad(9);
    const match = makeMatch(5, players);
    const state = runningState(match, players, 6);
    const offIds = onFieldIds(state).filter((id) => state.players[id]!.currentSlot !== "GK").slice(0, 2);
    const rec = recommendSwaps(match, players, state, { forceOff: offIds });
    expect(rec.primary.length).toBe(2);
    expect(rec.primary.map((s) => s.playerOff).sort()).toEqual([...offIds].sort());
  });
});
