/**
 * A match that finished SHORT — every period ended early — must still report fair minutes.
 *
 * The end-period-early feature makes this an everyday case rather than a curiosity: youth games get
 * cut short constantly. The claim under test is that fairness self-corrects without any special
 * handling, because `computeDebts` scales the yardstick with the clock:
 *
 *     expectedSoFar(p) = target(p) × (elapsed / total)
 *
 * so a game abandoned at 48′ of a planned 60′ measures everyone against 80% of their target, and
 * Σ expectedSoFar still equals the field-seconds actually played. These tests prove BOTH halves of
 * that — the arithmetic identity and the end-to-end verdict — because a feature that quietly
 * misreports fairness would be worse than no feature.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildPlan,
  fairnessReport,
  initLiveState,
  recommendSwaps,
  type LiveState,
  type Match,
  type Player,
} from "../../src/engine/index";
import { makeMatch, makeSquad } from "./_fixtures";

/** How often the coach glances at the app and takes whatever change it offers. */
const CHECK_EVERY_SECONDS = 30;

/**
 * Play a whole match through the REAL reducer with a coach who accepts every suggestion, ending
 * each period after `playSecondsPerPeriod` instead of at its scheduled length. `playSecondsPerPeriod
 * === periodLength` is an ordinary full match, which is what the control case uses.
 */
function playMatch(match: Match, players: Player[], playSecondsPerPeriod: number): LiveState {
  const lineup = buildPlan(match, players).startingLineup.assignments;
  let state = applyEvent(initLiveState(match, players), { type: "MATCH_STARTED", atSeconds: 0, lineup });

  for (let period = 1; period <= match.periods; period++) {
    const endsAt = state.periodStartedAtSeconds + playSecondsPerPeriod;
    while (state.elapsedSeconds < endsAt) {
      const to = Math.min(endsAt, state.elapsedSeconds + CHECK_EVERY_SECONDS);
      state = applyEvent(state, { type: "TICK", atSeconds: to, deltaSeconds: to - state.elapsedSeconds });
      const rec = recommendSwaps(match, players, state);
      if (rec.primary.length > 0) {
        state = applyEvent(state, {
          type: "SUB_APPLIED",
          atSeconds: state.elapsedSeconds,
          off: rec.primary.map((s) => s.playerOff).filter((id): id is string => id !== null),
          on: rec.primary.map((s) => ({ playerId: s.playerOn, slot: s.toSlot })),
          positionChanges: rec.positionChanges,
        });
      }
    }
    if (period < match.periods) {
      state = applyEvent(state, { type: "PERIOD_ENDED", atSeconds: state.elapsedSeconds, period });
      state = applyEvent(state, { type: "PERIOD_STARTED", atSeconds: state.elapsedSeconds, period: period + 1 });
    }
  }
  return state;
}

describe("fairness after a SHORT match (every period ended early)", () => {
  const players = makeSquad(10);
  // 4 × 15′ = 60′ planned. Each quarter is called at 12:00, so the game really ends at 48′ — the
  // exact scenario in the claim.
  const match = makeMatch(7, players, {
    periods: 4,
    periodLengthMinutes: 15,
    fairnessToleranceMinutes: 3,
  });
  const tolSeconds = match.fairnessToleranceMinutes * 60;
  const short = playMatch(match, players, 12 * 60);
  const report = fairnessReport(match, players, short);

  it("the match really did finish short", () => {
    expect(short.elapsedSeconds).toBe(48 * 60);
    expect(short.elapsedSeconds).toBeLessThan(match.periods * match.periodLengthMinutes * 60);
  });

  it("Σ expectedSoFar equals onFieldCount × the time ACTUALLY played, not the planned total", () => {
    const sumExpected = report.rows.reduce((s, r) => s + r.expectedSoFarSeconds, 0);
    expect(sumExpected).toBeCloseTo(match.onFieldCount * short.elapsedSeconds, 6);
    // Stated the other way round: the yardstick shrank to 80% of a full game (48′ of 60′), so it
    // is NOT the planned figure.
    expect(sumExpected).toBeLessThan(match.onFieldCount * match.periods * match.periodLengthMinutes * 60);
  });

  it("…and that is exactly the field-seconds the squad actually accrued, so total debt is zero", () => {
    const sumPlayed = report.rows.reduce((s, r) => s + r.playedSeconds, 0);
    const sumDebt = report.rows.reduce((s, r) => s + r.debtSeconds, 0);
    expect(sumPlayed).toBe(match.onFieldCount * short.elapsedSeconds);
    expect(sumDebt).toBeCloseTo(0, 6);
  });

  it("every player is measured against 80% of their full-match target", () => {
    for (const row of report.rows) {
      expect(row.expectedSoFarSeconds).toBeCloseTo(row.targetSeconds * 0.8, 6);
    }
  });

  it("the squad still finishes within tolerance — a short game is no less fair than a full one", () => {
    expect(report.maxAbsDebtSeconds).toBeLessThanOrEqual(tolSeconds);
    expect(report.spreadSeconds).toBeLessThanOrEqual(tolSeconds);

    // Control: the same squad, same plan, playing every period out in full. The short match must not
    // be materially worse — that's what "self-corrects" has to mean to be worth anything.
    const full = fairnessReport(match, players, playMatch(match, players, 15 * 60));
    expect(report.spreadSeconds).toBeLessThanOrEqual(full.spreadSeconds + 60);
  });
});
