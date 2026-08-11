/**
 * Late-arrival + mid-match squad-addition regressions (coach feedback 2026-07-18):
 *  1. a player marked 🕑 Late must NEVER appear in the starting lineup,
 *  2. "arrived" re-anchors their window — eligible immediately, fair share pro-rated from the REAL
 *     arrival minute (before or after the estimate),
 *  3. a player added to the squad mid-match must not break the event-log replay.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  chooseStartingLineup,
  computeTargets,
  fairnessReport,
  getFormation,
  initLiveState,
  isBenchEligibleNow,
  isStartableAtKickoff,
  rebuildLiveState,
  recalculate,
  type MatchEvent,
  type Player,
  type SubPlan,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

const involves = (plan: SubPlan, id: string): boolean =>
  plan.windows.some((w) => w.off.includes(id) || w.swaps.some((s) => s.playerOn === id));

const late = (p: Player, untilMinute: number): Player => ({
  ...p,
  availability: "arrives-late",
  unavailableUntilMinute: untilMinute,
});

describe("late player never in the starting line-up", () => {
  it("isStartableAtKickoff: false for arrives-late with a future minute, true once re-anchored to 0", () => {
    const p = makeSquad(1)[0]!;
    expect(isStartableAtKickoff(p)).toBe(true);
    expect(isStartableAtKickoff(late(p, 25))).toBe(false);
    expect(isStartableAtKickoff(late(p, 0))).toBe(true); // arrived before kickoff
    expect(isStartableAtKickoff({ ...p, availability: "unavailable" })).toBe(false);
  });

  it("chooseStartingLineup excludes every late-marked player from the XI", () => {
    const players = makeSquad(9);
    // p08, p09 arrive at HT (not the keepers — someone must be able to start in goal).
    const withLate = players.map((p, i) => (i >= 7 ? late(p, 25) : p));
    const match = makeMatch(7, withLate);
    const ids = chooseStartingLineup(match, withLate, getFormation(7)).assignments.map((a) => a.playerId);
    expect(ids).not.toContain("p08");
    expect(ids).not.toContain("p09");
    expect(ids).toHaveLength(7);
  });
});

describe("arrival re-anchors the availability window", () => {
  it("bench-eligible immediately once the window is set to the real arrival minute", () => {
    const players = makeSquad(8);
    const match = makeMatch(7, players);
    const estimated = late(players[7]!, 25);
    const nowSec = 12 * 60; // they turned up at 12′, well before the half-time estimate
    expect(isBenchEligibleNow(match, estimated, nowSec)).toBe(false);
    const arrived = late(players[7]!, 12); // what markArrived writes
    expect(isBenchEligibleNow(match, arrived, nowSec)).toBe(true);
  });

  it("fair-share target is pro-rated from the REAL arrival, not the estimate", () => {
    const players = makeSquad(8);
    const match = makeMatch(7, players); // 2×25′
    const atEstimate = computeTargets(match, players.map((p, i) => (i === 7 ? late(p, 25) : p)));
    const atActual = computeTargets(match, players.map((p, i) => (i === 7 ? late(p, 10) : p)));
    const tEstimate = atEstimate.targetSeconds["p08"] ?? 0;
    const tActual = atActual.targetSeconds["p08"] ?? 0;
    // Arriving at 10′ leaves a bigger available window than arriving at 25′ ⇒ bigger fair share.
    expect(tActual).toBeGreaterThan(tEstimate);
    expect(tEstimate).toBeGreaterThan(0);
  });
});

describe("marking arrived = equal time, catch up (coach rule: 10 min late = 10 min on the bench)", () => {
  it("an arrived (available) player targets the FULL equal share, not the pro-rated late window", () => {
    const players = makeSquad(8);
    const match = makeMatch(7, players); // 2×25
    // markArrived flips the player to plain "available"; a still-late player stays pro-rated.
    const arrived = computeTargets(match, players); // p08 now available like everyone else
    const stillLate = computeTargets(match, players.map((p, i) => (i === 7 ? late(p, 10) : p)));
    const tArrived = arrived.targetSeconds["p08"] ?? 0;
    const tLate = stillLate.targetSeconds["p08"] ?? 0;
    expect(tArrived).toBeGreaterThan(tLate); // equal share beats the pro-rated window
    // …and it's the SAME target as a full-time player (equal whole-game share).
    expect(tArrived).toBeCloseTo(arrived.targetSeconds["p01"] ?? 0, 5);
  });

  it("a late arrival sitting the opening minutes is BEHIND, so the plan catches them up", () => {
    const players = makeSquad(9); // 7 field + 2 bench
    const match = makeMatch(7, players); // 2×25
    const lineup = chooseStartingLineup(match, players, getFormation(7)).assignments;
    const starterIds = new Set(lineup.map((a) => a.playerId));
    const benchId = players.find((p) => !starterIds.has(p.id))!.id; // stands in for the late arrival
    let state = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    state = applyEvent(state, { type: "TICK", atSeconds: 600, deltaSeconds: 600 }); // 10′ played
    // As a full-share available player who's played 0′, they read as under fair share (positive debt).
    const row = fairnessReport(match, players, state).rows.find((r) => r.playerId === benchId);
    expect((row?.debtSeconds ?? 0)).toBeGreaterThan(0);
    // …and the re-plan schedules them on to catch up.
    expect(involves(recalculate(match, players, state), benchId)).toBe(true);
  });
});

describe("the plan never counts on a player who hasn't arrived", () => {
  it("pre-match plan schedules NO window involving a 🕑 late player (we don't know when they'll come)", () => {
    const players = makeSquad(10);
    const withLate = players.map((p) => (p.id === "p10" ? late(p, 25) : p)); // estimate: half time
    const match = makeMatch(7, withLate);
    const built = buildPlan(match, withLate);
    // The old behaviour planned them IN at their estimate (a window at ~25′) — now nothing counts
    // on them, and the present players still rotate among themselves.
    expect(involves(built.plan, "p10")).toBe(false);
    expect(built.plan.windows.length).toBeGreaterThan(0);
  });

  it("marking them arrived re-plans them straight into the rotation", () => {
    const players = makeSquad(10);
    const asLate = (until: number): Player[] => players.map((p) => (p.id === "p10" ? late(p, until) : p));
    const match = makeMatch(7, asLate(25));
    const lineup = chooseStartingLineup(match, asLate(25), getFormation(7)).assignments;
    let state = applyEvent(initLiveState(match, asLate(25)), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    state = applyEvent(state, { type: "TICK", atSeconds: 600, deltaSeconds: 600 }); // 10′ in
    // Still absent (estimate 25′): the re-plan must not involve them — not even after 25′.
    expect(involves(recalculate(match, asLate(25), state), "p10")).toBe(false);
    // They walk up at 10′ and the coach taps Arrived (window re-anchored to 10) → the very next
    // re-plan brings them into the rotation.
    expect(involves(recalculate(match, asLate(10), state), "p10")).toBe(true);
  });

  it("re-planning while PAUSED still plans the remaining match (the arrival-at-pause wipe-out)", () => {
    // Coaches pause before dealing with an arrival. A paused state used to simulate a future where
    // no time accrues → "no changes needed" → an EMPTY plan persisted as the guide. The planner now
    // projects the future as if play resumes.
    const players = makeSquad(10);
    const match = makeMatch(7, players, { periodLengthMinutes: 30 });
    const lineup = chooseStartingLineup(match, players, getFormation(7)).assignments;
    let state = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    state = applyEvent(state, { type: "TICK", atSeconds: 120, deltaSeconds: 120 });
    state = applyEvent(state, { type: "CLOCK_PAUSED", atSeconds: 120 });
    const paused = recalculate(match, players, state);
    expect(paused.windows.length).toBeGreaterThan(0);
  });
});

describe("add player mid-match", () => {
  it("replaying the log against the AMENDED squad keeps every prior event and benches the newcomer", () => {
    const players = makeSquad(9);
    const match = makeMatch(7, players);
    const lineup = chooseStartingLineup(match, players, getFormation(7)).assignments;
    const events: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 600, deltaSeconds: 600 },
    ];
    const joined: Player = {
      ...makeSquad(1)[0]!,
      id: "surprise",
      name: "Surprise",
      availability: "arrives-late",
      unavailableUntilMinute: 10,
    };
    // What addPlayerToMatch writes: the newcomer joins BOTH the players list and availableSquad —
    // config.availableSquad is the engine's squad source of truth; players alone is not enough.
    const amended = { ...match, availableSquad: [...match.availableSquad, joined.id] };
    const rebuilt = rebuildLiveState(amended, [...players, joined], events);
    const entry = rebuilt.players["surprise"];
    expect(entry).toBeDefined();
    expect(entry?.onField).toBe(false);
    expect(entry?.secondsOnField).toBe(0);
    // …and they're immediately eligible to come on (their window is the join minute).
    expect(isBenchEligibleNow(match, joined, 600)).toBe(true);
    // The original XI's minutes are untouched by the amendment.
    const starter = rebuilt.players[lineup[0]!.playerId];
    expect(starter?.secondsOnField).toBe(600);
  });
});
