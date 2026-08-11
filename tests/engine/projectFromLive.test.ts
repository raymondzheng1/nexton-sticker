/**
 * Projecting the rest of the match from where it actually is.
 *
 * This backs the live "Projected minutes" card. The pre-match card replays a hypothetical match from
 * the starting lineup; this one has to start from real minutes already on the clock, so the thing
 * that must never break is that MINUTES ALREADY PLAYED ARE CARRIED, not recomputed.
 */
import { describe, expect, it } from "vitest";
import { applyEvent, buildPlan, initLiveState, planFromLineup, projectFromLive } from "../../src/engine/index";
import { makeMatch, makeSquad, min } from "./_fixtures";

/** A match taken to `atSeconds` with the plan approved but no changes applied yet. */
function midMatch(atSeconds: number) {
  const players = makeSquad(12);
  const match = makeMatch(7, players, { periodLengthMinutes: 25 });
  const built = buildPlan(match, players);
  const lineup = built.startingLineup.assignments;
  let state = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });
  if (atSeconds > 0) {
    state = applyEvent(state, { type: "TICK", atSeconds, deltaSeconds: atSeconds });
  }
  return { match, players, state, windows: planFromLineup(match, players, lineup), lineup };
}

describe("projecting from the live state", () => {
  it("carries the minutes already played rather than recomputing them", () => {
    const { match, players, state, windows } = midMatch(min(10));
    const starter = Object.values(state.players).find((p) => p.onField)?.playerId as string;
    expect(state.players[starter]?.secondsOnField).toBe(min(10));

    const final = projectFromLive(match, players, state, windows);
    // Whatever the plan does from here, they cannot finish on LESS than they have already played.
    expect(final.players[starter]?.secondsOnField).toBeGreaterThanOrEqual(min(10));
  });

  it("adds up to the full match: every second on the field is accounted for", () => {
    const { match, players, state, windows } = midMatch(min(10));
    const final = projectFromLive(match, players, state, windows);
    const totalPlayed = Object.values(final.players).reduce((s, p) => s + p.secondsOnField, 0);
    // onFieldCount players on the pitch for the whole match — no more, no less.
    expect(totalPlayed).toBe(7 * min(50));
  });

  it("ignores changes already in the past — those are history, not projection", () => {
    const { match, players, state, windows } = midMatch(min(30));
    const past = windows.filter((w) => w.atSeconds <= min(30));
    expect(past.length).toBeGreaterThan(0); // the fixture must actually exercise this
    const withPast = projectFromLive(match, players, state, windows);
    const withoutPast = projectFromLive(
      match,
      players,
      state,
      windows.filter((w) => w.atSeconds > min(30)),
    );
    expect(withPast.players).toEqual(withoutPast.players);
  });

  it("projects through a break — a paused clock stops the present, not the rest of the match", () => {
    const { match, players, state, windows } = midMatch(min(25));
    const atBreak = applyEvent(state, { type: "PERIOD_ENDED", atSeconds: min(25), period: 1 });
    expect(atBreak.status).toBe("period-break");
    const final = projectFromLive(match, players, atBreak, windows);
    // Half time must not freeze the projection at half-time minutes.
    expect(final.elapsedSeconds).toBe(min(50));
    const totalPlayed = Object.values(final.players).reduce((s, p) => s + p.secondsOnField, 0);
    expect(totalPlayed).toBe(7 * min(50));
  });

  it("in added time, the minutes on the clock ARE the final ones", () => {
    const { match, players, state, windows } = midMatch(min(52)); // past a 2×25 full time
    const final = projectFromLive(match, players, state, windows);
    expect(final.elapsedSeconds).toBe(min(52));
    const starter = Object.values(state.players).find((p) => p.onField)?.playerId as string;
    expect(final.players[starter]?.secondsOnField).toBe(min(52));
  });

  it("a plan with nothing left to run leaves everyone where they are, plus the remaining clock", () => {
    const { match, players, state } = midMatch(min(10));
    const final = projectFromLive(match, players, state, []);
    const starter = Object.values(state.players).find((p) => p.onField)?.playerId as string;
    const benched = Object.values(state.players).find((p) => !p.onField)?.playerId as string;
    // No changes ⇒ the XI on the pitch plays the rest, the bench stays on it.
    expect(final.players[starter]?.secondsOnField).toBe(min(50));
    expect(final.players[benched]?.secondsOnField).toBe(0);
  });
});
