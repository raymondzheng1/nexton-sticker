import { describe, expect, it } from "vitest";
import {
  applyEvent,
  benchIds,
  initLiveState,
  onFieldIds,
  rebuildLiveState,
  type LineupAssignment,
  type MatchEvent,
} from "../../src/engine/index";
import { buildPlan } from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

function startedState() {
  const players = makeSquad(8);
  const match = makeMatch(5, players);
  const lineup: LineupAssignment[] = buildPlan(match, players).startingLineup.assignments;
  const state = applyEvent(initLiveState(match, players), {
    type: "MATCH_STARTED",
    atSeconds: 0,
    lineup,
  });
  return { players, match, lineup, state };
}

describe("clock + event reducer (PRD §6.5, §8.3)", () => {
  it("initial state is pre-match with everyone off the field", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const ls = initLiveState(match, players);
    expect(ls.status).toBe("pre-match");
    expect(onFieldIds(ls)).toHaveLength(0);
    expect(Object.keys(ls.players)).toHaveLength(8);
  });

  it("MATCH_STARTED places exactly onFieldCount players and the rest sit", () => {
    const { match, state } = startedState();
    expect(state.status).toBe("running");
    expect(onFieldIds(state)).toHaveLength(match.onFieldCount);
    expect(benchIds(state)).toHaveLength(8 - match.onFieldCount);
  });

  it("field time accrues ONLY while running; pause freezes every stint timer", () => {
    const { state } = startedState();
    const onId = onFieldIds(state)[0]!;

    let s = applyEvent(state, { type: "TICK", atSeconds: 60, deltaSeconds: 60 });
    expect(s.elapsedSeconds).toBe(60);
    expect(s.players[onId]!.secondsOnField).toBe(60);

    s = applyEvent(s, { type: "CLOCK_PAUSED", atSeconds: 60 });
    // a tick while paused is a no-op (clock frozen)
    s = applyEvent(s, { type: "TICK", atSeconds: 120, deltaSeconds: 60 });
    expect(s.elapsedSeconds).toBe(60);
    expect(s.players[onId]!.secondsOnField).toBe(60);

    s = applyEvent(s, { type: "CLOCK_RESUMED", atSeconds: 60 });
    s = applyEvent(s, { type: "TICK", atSeconds: 90, deltaSeconds: 30 });
    expect(s.elapsedSeconds).toBe(90);
    expect(s.players[onId]!.secondsOnField).toBe(90);
  });

  it("period transitions preserve accumulated seconds exactly", () => {
    const { state } = startedState();
    const onId = onFieldIds(state)[0]!;
    let s = applyEvent(state, { type: "TICK", atSeconds: 1500, deltaSeconds: 1500 });
    s = applyEvent(s, { type: "PERIOD_ENDED", atSeconds: 1500, period: 1 });
    expect(s.status).toBe("period-break");
    // No accrual across the break.
    s = applyEvent(s, { type: "TICK", atSeconds: 1500, deltaSeconds: 300 });
    expect(s.elapsedSeconds).toBe(1500);
    s = applyEvent(s, { type: "PERIOD_STARTED", atSeconds: 1500, period: 2 });
    expect(s.period).toBe(2);
    expect(s.status).toBe("running");
    s = applyEvent(s, { type: "TICK", atSeconds: 1560, deltaSeconds: 60 });
    expect(s.elapsedSeconds).toBe(1560);
    expect(s.players[onId]!.secondsOnField).toBe(1560);
    // A restart does NOT reset the stint (changed 2026-08-17). Resetting it re-protected the
    // whole pitch after every break — with a real rotation floor nobody could come off for most
    // of a short quarter, and the squad drifted apart. A player on for 25′ before the break is
    // due off, not freshly protected; the stint simply carries on.
    expect(s.players[onId]!.secondsThisStint).toBe(1560);
    // …while the BENCH comes out of the break fully rested, whatever the clock said before it.
    const benchId = Object.values(s.players).find((p) => !p.onField)!.playerId;
    expect(s.players[benchId]!.secondsThisRest).toBeGreaterThanOrEqual(15 * 60);
  });

  it("records WHERE each period started, so an early end can't stretch the next one", () => {
    const { state } = startedState();
    expect(state.periodStartedAtSeconds).toBe(0); // period 1 starts at kickoff, by definition

    // The ref calls the first half at 12:00 of a scheduled 25.
    let s = applyEvent(state, { type: "TICK", atSeconds: 720, deltaSeconds: 720 });
    s = applyEvent(s, { type: "PERIOD_ENDED", atSeconds: 720, period: 1 });
    expect(s.periodStartedAtSeconds).toBe(0); // the break belongs to the period that just ended

    s = applyEvent(s, { type: "PERIOD_STARTED", atSeconds: 720, period: 2 });
    expect(s.periodStartedAtSeconds).toBe(720);
    // Play on — the anchor is where the period BEGAN, not a running clock.
    s = applyEvent(s, { type: "TICK", atSeconds: 900, deltaSeconds: 180 });
    expect(s.periodStartedAtSeconds).toBe(720);
  });

  it("REGRESSION: the period anchor survives a crash restore, so no stored match needs migrating", () => {
    const players = makeSquad(8);
    const match = makeMatch(5, players);
    const lineup: LineupAssignment[] = buildPlan(match, players).startingLineup.assignments;
    // A log exactly as it is persisted — the anchor is nowhere in it; PERIOD_STARTED.atSeconds
    // already carries the truth, which is why the derived field needs no schema change.
    const log: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 720, deltaSeconds: 720 },
      { type: "PERIOD_ENDED", atSeconds: 720, period: 1 },
      { type: "PERIOD_STARTED", atSeconds: 720, period: 2 },
      { type: "TICK", atSeconds: 800, deltaSeconds: 80 },
    ];
    const rebuilt = rebuildLiveState(match, players, log);
    expect(rebuilt.period).toBe(2);
    expect(rebuilt.periodStartedAtSeconds).toBe(720);
    expect(rebuilt.elapsedSeconds).toBe(800);
  });

  it("tracks GK seconds separately", () => {
    const { state } = startedState();
    const gkId = Object.values(state.players).find((p) => p.currentSlot === "GK")!.playerId;
    const s = applyEvent(state, { type: "TICK", atSeconds: 100, deltaSeconds: 100 });
    expect(s.players[gkId]!.secondsAsGk).toBe(100);
  });

  it("SUB_APPLIED swaps players and resets stints", () => {
    const { state } = startedState();
    let s = applyEvent(state, { type: "TICK", atSeconds: 300, deltaSeconds: 300 });
    const offId = onFieldIds(s)[0]!;
    const offSlot = s.players[offId]!.currentSlot!;
    const onId = benchIds(s)[0]!;
    s = applyEvent(s, {
      type: "SUB_APPLIED",
      atSeconds: 300,
      off: [offId],
      on: [{ playerId: onId, slot: offSlot }],
      positionChanges: [],
    });
    expect(s.players[offId]!.onField).toBe(false);
    expect(s.players[offId]!.secondsThisStint).toBe(0);
    expect(s.players[onId]!.onField).toBe(true);
    expect(s.players[onId]!.currentSlot).toBe(offSlot);
  });

  it("rebuild from the event log reproduces state exactly (crash recovery + undo)", () => {
    const { players, match, lineup } = startedState();
    const events: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 600, deltaSeconds: 600 },
      {
        type: "SUB_APPLIED",
        atSeconds: 600,
        off: [lineup[1]!.playerId],
        on: [{ playerId: benchIds(initLiveStateFor(match, players))[0]!, slot: lineup[1]!.slot }],
        positionChanges: [],
      },
      { type: "TICK", atSeconds: 1200, deltaSeconds: 600 },
    ];
    const rebuilt = rebuildLiveState(match, players, events);
    // Folding manually yields the identical object (determinism).
    let manual = initLiveState(match, players);
    for (const e of events) manual = applyEvent(manual, e);
    expect(rebuilt).toEqual(manual);

    // Undo = drop the last event and refold.
    const undone = rebuildLiveState(match, players, events.slice(0, -1));
    expect(undone.elapsedSeconds).toBe(600);
  });

  it("RECOVERY: rebuild skips un-replayable events (corrupted/merged log) instead of throwing", () => {
    const { players, match, lineup } = startedState();
    const events: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 300, deltaSeconds: 300 },
      // A stray 2nd MATCH_STARTED (e.g. from a restart + cross-device merge) would throw in the
      // strict reducer — rebuild must skip it and keep going so the match still opens.
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      // A swap referencing a player not in the squad would also throw — must be skipped too.
      { type: "SUB_APPLIED", atSeconds: 360, off: ["ghost"], on: [{ playerId: "ghost", slot: lineup[0]!.slot }], positionChanges: [] },
      { type: "TICK", atSeconds: 600, deltaSeconds: 300 },
    ];
    const rebuilt = rebuildLiveState(match, players, events);
    expect(rebuilt.status).toBe("running"); // didn't brick
    expect(rebuilt.elapsedSeconds).toBe(600); // both valid ticks applied
    expect(onFieldIds(rebuilt)).toHaveLength(match.onFieldCount); // count intact
  });

  it("GOAL_SCORED tallies goals per player without touching minutes", () => {
    const { players, match, lineup } = startedState();
    const scorer = lineup[1]!.playerId;
    const events: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 300, deltaSeconds: 300 },
      { type: "GOAL_SCORED", atSeconds: 120, playerId: scorer },
      { type: "GOAL_SCORED", atSeconds: 250, playerId: scorer },
    ];
    const state = rebuildLiveState(match, players, events);
    expect(state.players[scorer]!.goals).toBe(2);
    expect(state.players[scorer]!.secondsOnField).toBe(300); // goals don't add minutes
    expect(state.players[lineup[2]!.playerId]!.goals).toBe(0);
  });

  it("tracks minutes PER POSITION (secondsBySlot) across repositioning — the report history", () => {
    const { players, match, lineup } = startedState();
    const a = lineup[1]!;
    const b = lineup[2]!;
    let s = applyEvent(initLiveStateFor(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
    s = applyEvent(s, { type: "TICK", atSeconds: 300, deltaSeconds: 300 });
    // coach repositions: a and b swap slots at 5:00
    s = applyEvent(s, {
      type: "SUB_APPLIED",
      atSeconds: 300,
      off: [],
      on: [],
      positionChanges: [
        { playerId: a.playerId, fromSlot: a.slot, toSlot: b.slot },
        { playerId: b.playerId, fromSlot: b.slot, toSlot: a.slot },
      ],
    });
    s = applyEvent(s, { type: "TICK", atSeconds: 720, deltaSeconds: 420 });
    // a: 300s in the original slot, 420s in b's slot; sums to secondsOnField
    expect(s.players[a.playerId]!.secondsBySlot[a.slot]).toBe(300);
    expect(s.players[a.playerId]!.secondsBySlot[b.slot]).toBe(420);
    expect(s.players[b.playerId]!.secondsBySlot[b.slot]).toBe(300);
    expect(s.players[b.playerId]!.secondsBySlot[a.slot]).toBe(420);
    const sum = Object.values(s.players[a.playerId]!.secondsBySlot).reduce((x, y) => x + (y ?? 0), 0);
    expect(sum).toBe(s.players[a.playerId]!.secondsOnField);
  });

  it("does not mutate the input state (immutability)", () => {
    const { state } = startedState();
    const snapshot = JSON.parse(JSON.stringify(state));
    applyEvent(state, { type: "TICK", atSeconds: 60, deltaSeconds: 60 });
    expect(state).toEqual(snapshot);
  });
});

function initLiveStateFor(match: ReturnType<typeof makeMatch>, players: ReturnType<typeof makeSquad>) {
  return initLiveState(match, players);
}
