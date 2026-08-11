/**
 * Regression: "live clock pauses when I leave the page / background the app" (#3 follow-up).
 *
 * A web page can't tick while it's backgrounded or you've navigated away. The clock's truth is the
 * persisted wall-clock anchor, not the count of interval fires — so on reopen/refocus we must snap
 * elapsed up to REAL time. These pin `wallClockCatchUp`, the pure seam behind both `open()` and the
 * new `resync()` visibility handler.
 */
import { describe, expect, it } from "vitest";
import { applyEvent, buildPlan, initLiveState, type LineupAssignment, type Match, type Player } from "../../src/engine/index";
import {
  canEndPeriodEarly,
  elapsedInPeriodSeconds,
  periodEndSeconds,
  regulationEndSeconds,
  remainingInPeriodSeconds,
  shouldKeepNextChange,
  wallClockCatchUp,
} from "../../src/store/clock";
import type { SavedMatch } from "../../src/store/schema";
import { makeMatch, makeSquad } from "../engine/_fixtures";

const T0 = Date.parse("2026-06-14T00:00:00.000Z");

function runningLive(config: Match, players: Player[], elapsedSeconds: number) {
  const lineup: LineupAssignment[] = buildPlan(config, players).startingLineup.assignments;
  let live = applyEvent(initLiveState(config, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
  if (elapsedSeconds > 0) {
    live = applyEvent(live, { type: "TICK", atSeconds: elapsedSeconds, deltaSeconds: elapsedSeconds });
  }
  return live;
}

function savedMatch(config: Match, players: Player[], anchor: SavedMatch["clockAnchor"]): SavedMatch {
  return {
    id: "m1",
    ownerId: "local",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    deletedAt: null,
    teamId: "t1",
    name: "Test match",
    config,
    players,
    status: "live",
    events: [],
    clockAnchor: anchor,
  };
}

describe("wall-clock catch-up — the away-clock keeps running (#3)", () => {
  it("snaps elapsed up to real time when reopened after being away", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players); // periods 2 × 25min
    const live = runningLive(config, players, 60); // page last persisted 1:00
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    // 200s of real time have passed since kickoff while the page was away.
    const { working, delta, crossedPeriod } = wallClockCatchUp(live, match, T0 + 200_000);

    expect(delta).toBe(140); // 200 true − 60 persisted
    expect(working.elapsedSeconds).toBe(200);
    expect(crossedPeriod).toBe(false);
  });

  it("accrued on-field time advances for players still on the pitch", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players);
    const live = runningLive(config, players, 60);
    const onId = Object.values(live.players).find((p) => p.onField)!.playerId;
    const before = live.players[onId]!.secondsOnField;
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    const { working } = wallClockCatchUp(live, match, T0 + 200_000);
    expect(working.players[onId]!.secondsOnField).toBe(before + 140);
  });

  it("does NOT skip half-time: catch-up is capped at a non-final period boundary", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players); // 2 × 1500s; period 1 ends at 1500s
    const live = runningLive(config, players, 60);
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    // away well past half-time (30 min of real time)
    const { working, crossedPeriod } = wallClockCatchUp(live, match, T0 + 1800_000);

    expect(working.elapsedSeconds).toBe(1500); // capped at the period boundary
    expect(crossedPeriod).toBe(true);
  });

  it("rolls past full time in the FINAL period (added time, not auto-ended)", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players, { periods: 1 }); // total 1500s, period 1 is final
    const live = runningLive(config, players, 60);
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    // away 100s past the final whistle → clock keeps rolling, NOT capped at the total
    const { working, crossedPeriod } = wallClockCatchUp(live, match, T0 + 1600_000);

    expect(working.elapsedSeconds).toBe(1600); // rolled into added time
    expect(crossedPeriod).toBe(false);
  });

  it("REGRESSION: an ABANDONED match (app closed for hours mid-final-period) is capped, not credited", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players, { periods: 1 }); // total 1500s, period 1 is final
    const live = runningLive(config, players, 60);
    const onId = Object.values(live.players).find((p) => p.onField)!.playerId;
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    // Coach closed the app and came back 20 HOURS later. Unattended catch-up must stop at
    // total + half a period of added time (1500 + 750), not credit 20h of minutes to the XI
    // (which would poison season totals).
    const { working, crossedPeriod } = wallClockCatchUp(live, match, T0 + 20 * 3600_000);
    expect(working.elapsedSeconds).toBe(2250);
    expect(working.players[onId]!.secondsOnField).toBe(2250);
    expect(crossedPeriod).toBe(false);

    // …and once at the cap, reopening again later adds nothing more.
    const again = wallClockCatchUp(working, match, T0 + 40 * 3600_000);
    expect(again.delta).toBe(0);
    expect(again.working.elapsedSeconds).toBe(2250);
  });

  it("no anchor (paused/frozen) → clock does not advance", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players);
    const live = runningLive(config, players, 60);
    const match = savedMatch(config, players, null);

    const { working, delta } = wallClockCatchUp(live, match, T0 + 200_000);
    expect(delta).toBe(0);
    expect(working.elapsedSeconds).toBe(60);
    expect(working).toBe(live);
  });

  it("a paused clock is not advanced even if an anchor lingers", () => {
    const players = makeSquad(8);
    const config = makeMatch(5, players);
    const paused = applyEvent(runningLive(config, players, 60), { type: "CLOCK_PAUSED", atSeconds: 60 });
    const match = savedMatch(config, players, { elapsedSeconds: 0, wallClockISO: new Date(T0).toISOString() });

    const { delta, working } = wallClockCatchUp(paused, match, T0 + 200_000);
    expect(delta).toBe(0);
    expect(working.elapsedSeconds).toBe(60);
  });
});

describe("next-change countdown stays pinned across leave/return (#3 follow-up)", () => {
  const target = { atSeconds: 840 }; // a change planned at 14:00

  it("keeps the same target when returning to the same match before it's reached", () => {
    // away → elapsed jumped from 5:00 to 11:00, still before the 14:00 target → KEEP (don't re-plan)
    expect(shouldKeepNextChange(target, "m1", "m1", 660)).toBe(true);
  });

  it("re-pins once the target has been reached", () => {
    expect(shouldKeepNextChange(target, "m1", "m1", 840)).toBe(false); // exactly reached
    expect(shouldKeepNextChange(target, "m1", "m1", 900)).toBe(false); // passed
  });

  it("re-pins when opening a different match", () => {
    expect(shouldKeepNextChange(target, "m1", "m2", 100)).toBe(false);
  });

  it("re-pins when there is no target yet (e.g. fresh reload)", () => {
    expect(shouldKeepNextChange(null, null, "m1", 100)).toBe(false);
  });
});

/**
 * Basketball's game clock counts DOWN inside each period, so the live screen shows time remaining
 * alongside time played. The arithmetic is trivial; the edge cases are not — `elapsedSeconds`
 * accumulates across the whole match, and the final period deliberately runs past its length.
 */
describe("time remaining in the period (basketball's countdown)", () => {
  const players = makeSquad(8);
  // 2 x 18' basketball — the app's default for the sport.
  const config = makeMatch(5, players, { sport: "basketball", periods: 2, periodLengthMinutes: 18 });
  const match = savedMatch(config, players, null);
  // Every case in THIS block models uniform periods (nothing ended early), so period n begins one
  // full period length after n−1. The early-end block below sets the anchor explicitly instead.
  const at = (elapsedSeconds: number, period: number) => ({
    ...runningLive(config, players, 0),
    elapsedSeconds,
    period,
    periodStartedAtSeconds: (period - 1) * 18 * 60,
  });

  it("counts down from the full period at tip off", () => {
    expect(remainingInPeriodSeconds(match, at(0, 1))).toBe(18 * 60);
  });

  it("counts down within the first period", () => {
    expect(remainingInPeriodSeconds(match, at(5 * 60, 1))).toBe(13 * 60);
  });

  it("resets for the second period instead of counting the whole match", () => {
    // THE ONE THAT MATTERS: elapsedSeconds is cumulative, so 20' elapsed in period 2 is only 2'
    // into that period — 16' left, not the -2' a naive `total - elapsed` would give.
    expect(elapsedInPeriodSeconds(at(20 * 60, 2))).toBe(2 * 60);
    expect(remainingInPeriodSeconds(match, at(20 * 60, 2))).toBe(16 * 60);
  });

  it("reads 0:00 at the end of a period, not a negative", () => {
    expect(remainingInPeriodSeconds(match, at(18 * 60, 1))).toBe(0);
  });

  it("stays at 0:00 in added time — the final period runs on until the coach ends it", () => {
    expect(remainingInPeriodSeconds(match, at(38 * 60, 2))).toBe(0);
    expect(remainingInPeriodSeconds(match, at(45 * 60, 2))).toBe(0);
  });

  it("never goes negative if a stored state has a period ahead of the clock", () => {
    // Defensive: a merged or recovered log could pair a high period with a low elapsed.
    expect(elapsedInPeriodSeconds(at(60, 2))).toBe(0);
    expect(remainingInPeriodSeconds(match, at(60, 2))).toBe(18 * 60);
  });
});

/**
 * Youth periods finish early all the time — the ref blows up, it's freezing, a team has to leave.
 * Everything downstream of the clock used to anchor "where are we in this period?" to
 * `(period − 1) × periodLength`, which silently assumes every period ran its full length. End the
 * first quarter of a 4×15 at 12:00 and that formula still put quarter 2's whistle at the fixed 30:00
 * mark — an 18-minute quarter. `LiveState.periodStartedAtSeconds` is the missing truth these pin.
 */
describe("a period ended EARLY does not stretch the next one", () => {
  const players = makeSquad(8);
  const quarters = makeMatch(5, players, { periods: 4, periodLengthMinutes: 15 });
  const quartersMatch = savedMatch(quarters, players, null);

  /** Kick off, play `seconds`, blow the whistle early, restart the next period from right there. */
  function endedEarlyAt(config: typeof quarters, seconds: number, period: number) {
    const played = applyEvent(runningLive(config, players, seconds), {
      type: "PERIOD_ENDED",
      atSeconds: seconds,
      period,
    });
    return applyEvent(played, { type: "PERIOD_STARTED", atSeconds: seconds, period: period + 1 });
  }

  it("REGRESSION: period 2's whistle is a full period after the RESTART, not at the fixed 2×15′ mark", () => {
    const live = endedEarlyAt(quarters, 12 * 60, 1); // ref blew up at 12:00 of a 15′ quarter
    expect(live.periodStartedAtSeconds).toBe(12 * 60);
    // The bug: `live.period * periodLength` = 30:00, which would have run quarter 2 for 18 minutes.
    expect(periodEndSeconds(quartersMatch, live)).toBe(27 * 60);
    // …and nothing of quarter 2 has been played yet at the moment it restarts.
    expect(elapsedInPeriodSeconds(live)).toBe(0);
    expect(remainingInPeriodSeconds(quartersMatch, live)).toBe(15 * 60);
  });

  it("REGRESSION: the period countdown is right after an early end (basketball's scoreboard)", () => {
    const bball = makeMatch(5, players, { sport: "basketball", periods: 2, periodLengthMinutes: 18 });
    const bballMatch = savedMatch(bball, players, null);
    // Period 1 called at 11:00 of 18; period 2 tips off there and runs its own 18.
    let live = endedEarlyAt(bball, 11 * 60, 1);
    live = applyEvent(live, { type: "TICK", atSeconds: 15 * 60, deltaSeconds: 4 * 60 });
    // 4:00 into period 2 ⇒ 14:00 left. Anchored to the schedule it read 15:00 elapsed of a 36′ game
    // = "period 2 is 15 minutes old", showing 3:00 left with 14 still to play.
    expect(elapsedInPeriodSeconds(live)).toBe(4 * 60);
    expect(remainingInPeriodSeconds(bballMatch, live)).toBe(14 * 60);
  });

  it("REGRESSION: wallClockCatchUp caps at the REAL boundary after an early end, not the scheduled one", () => {
    const live = endedEarlyAt(quarters, 12 * 60, 1);
    // Quarter 2 restarted at 12:00 with the wall clock at T0; the coach then walked away for an hour.
    const match = savedMatch(quarters, players, {
      elapsedSeconds: 12 * 60,
      wallClockISO: new Date(T0).toISOString(),
    });

    const { working, crossedPeriod } = wallClockCatchUp(live, match, T0 + 3600_000);

    // Capped at quarter 2's real end (12:00 + 15:00), NOT the scheduled 30:00 — which would have
    // credited every player on the pitch with 3 minutes they never played.
    expect(working.elapsedSeconds).toBe(27 * 60);
    expect(crossedPeriod).toBe(true);
  });

  it("REGRESSION: the abandoned-match added-time cap moves with the final period", () => {
    const halves = makeMatch(5, players, { periods: 2, periodLengthMinutes: 15 });
    const live = endedEarlyAt(halves, 10 * 60, 1); // first half called at 10:00
    const match = savedMatch(halves, players, {
      elapsedSeconds: 10 * 60,
      wallClockISO: new Date(T0).toISOString(),
    });

    // App left open overnight in the final period: capped at that period's end + half a period of
    // added time (10:00 + 15:00 + 7:30), not the scheduled 30:00 + 7:30 — the 5 lost minutes of the
    // first half must not come back as added time in the second.
    const { working } = wallClockCatchUp(live, match, T0 + 20 * 3600_000);
    expect(working.elapsedSeconds).toBe(32.5 * 60);
  });

  it("REGRESSION: regulation time is up when the FINAL period has run its length, not at the scheduled total", () => {
    const halves = makeMatch(5, players, { periods: 2, periodLengthMinutes: 15 });
    const halvesMatch = savedMatch(halves, players, null);
    const live = endedEarlyAt(halves, 10 * 60, 1);
    // Second half started at 10:00, so the final whistle is due at 25:00 — asking the coach "play on
    // into added time?" at the scheduled 30:00 would arrive five minutes after the game was over.
    expect(regulationEndSeconds(halvesMatch, live)).toBe(25 * 60);
    // Before the final period the scheduled total still answers it (the clock auto-breaks first).
    expect(regulationEndSeconds(halvesMatch, runningLive(halves, players, 60))).toBe(30 * 60);
  });

  it("REGRESSION: accrued minutes are untouched by ending a period early and restarting", () => {
    const before = runningLive(quarters, players, 12 * 60);
    const after = endedEarlyAt(quarters, 12 * 60, 1);
    for (const p of Object.values(before.players)) {
      const then = after.players[p.playerId]!;
      expect(then.secondsOnField).toBe(p.secondsOnField);
      expect(then.secondsAsGk).toBe(p.secondsAsGk);
      expect(then.secondsBySlot).toEqual(p.secondsBySlot);
      expect(then.onField).toBe(p.onField);
    }
    expect(after.elapsedSeconds).toBe(before.elapsedSeconds);
  });
});

/**
 * The end-period control's visibility rule, tested where the UI can't be: in the FINAL period there
 * must be no such action, because ending the last period early IS ending the match and "End match"
 * already does that properly (full-time summary, season totals).
 */
describe("who may end a period early", () => {
  const players = makeSquad(8);
  const quarters = makeMatch(5, players, { periods: 4, periodLengthMinutes: 15 });
  const match = savedMatch(quarters, players, null);
  const inPeriod = (period: number) => ({ ...runningLive(quarters, players, 60), period });

  it("offered in every period but the last", () => {
    expect(canEndPeriodEarly(match, inPeriod(1))).toBe(true);
    expect(canEndPeriodEarly(match, inPeriod(2))).toBe(true);
    expect(canEndPeriodEarly(match, inPeriod(3))).toBe(true);
  });

  it("REGRESSION: never offered in the FINAL period — that's what End match is for", () => {
    expect(canEndPeriodEarly(match, inPeriod(4))).toBe(false);
    // A single-period game is all final period.
    const onePeriod = makeMatch(5, players, { periods: 1, periodLengthMinutes: 15 });
    expect(canEndPeriodEarly(savedMatch(onePeriod, players, null), runningLive(onePeriod, players, 60))).toBe(false);
  });

  it("not offered unless the clock is running (pre-match, paused, at the break, full time)", () => {
    const running = inPeriod(1);
    for (const status of ["pre-match", "paused", "period-break", "full-time"] as const) {
      expect(canEndPeriodEarly(match, { ...running, status })).toBe(false);
    }
  });
});
