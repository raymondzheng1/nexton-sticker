/**
 * Wall-clock seam for the STORE layer (PRD §12.2; Harness §4.4 "injectable clock").
 *
 * Unlike the pure engine (which never reads a clock), the store legitimately stamps records with
 * the real time. Routing "now" through one seam keeps record timestamps deterministic in tests
 * (`__setNowForTests`) — important because `updatedAt` drives sync's last-writer-wins merge.
 */
import { applyEvent, type LiveState } from "@/engine";
import type { SavedMatch } from "./schema";

let nowFn: () => string = () => new Date().toISOString();

/** Current time as an ISO-8601 string. */
export function now(): string {
  return nowFn();
}

/** Test-only: pin the clock (pass null to restore the real clock). */
export function __setNowForTests(fn: (() => string) | null): void {
  nowFn = fn ?? (() => new Date().toISOString());
}

export function periodLengthSeconds(match: SavedMatch): number {
  return match.config.periodLengthMinutes * 60;
}

export function totalSeconds(match: SavedMatch): number {
  return match.config.periods * periodLengthSeconds(match);
}

/**
 * Seconds played so far IN THE CURRENT PERIOD. `elapsedSeconds` accumulates across the whole match,
 * so the current quarter/half is what's left after subtracting where it began.
 *
 * Measured from `live.periodStartedAtSeconds`, NOT from `(period − 1) × periodLength`: the coach can
 * end a period early, after which the two disagree and only the first one is true.
 */
export function elapsedInPeriodSeconds(live: LiveState): number {
  return Math.max(0, live.elapsedSeconds - live.periodStartedAtSeconds);
}

/**
 * The match-clock second at which the current period is due to end: where it actually started, plus
 * one period's length. The FINAL period runs past this into added time (the coach ends it); every
 * earlier one auto-pauses here for the break.
 */
export function periodEndSeconds(match: SavedMatch, live: LiveState): number {
  return live.periodStartedAtSeconds + periodLengthSeconds(match);
}

/**
 * The match second at which REGULATION time is up — when the coach gets asked "end it, or play on
 * into added time?".
 *
 * Not simply {@link totalSeconds}: once a period has been ended early the clock lags the schedule
 * permanently, so what matters is when the FINAL period has run ITS length from where it really
 * started. End three quarters of a 4×15 early and a fixed 60:00 whistle would arrive minutes after
 * the game was actually over. Before the final period the scheduled total is still the answer — the
 * clock auto-breaks at every earlier boundary long before it's reached.
 */
export function regulationEndSeconds(match: SavedMatch, live: LiveState): number {
  return live.period >= match.config.periods ? periodEndSeconds(match, live) : totalSeconds(match);
}

/**
 * May the coach end the current period EARLY? Youth games finish a period early all the time — the
 * ref blows up, it's freezing, a team has to leave — and Pause alone leaves the match stuck
 * mid-period forever.
 *
 * Offered only while the clock is running, and NEVER in the final period: ending that early is
 * ending the match, which "End match" already does properly (full-time summary, season totals).
 * The rule lives here rather than inline in the screen so there is exactly one of it, and it can be
 * tested without a browser.
 */
export function canEndPeriodEarly(match: SavedMatch, live: LiveState): boolean {
  return live.status === "running" && live.period < match.config.periods;
}

/**
 * Seconds LEFT in the current period — the number a basketball scoreboard shows, and the one
 * everyone on the court is watching.
 *
 * Floored at zero on purpose: the final period deliberately runs past its length into added time
 * (the coach decides when to end it), and "−1:12 left" is nonsense. Once the period is used up it
 * reads 0:00 and stays there.
 */
export function remainingInPeriodSeconds(match: SavedMatch, live: LiveState): number {
  return Math.max(0, periodLengthSeconds(match) - elapsedInPeriodSeconds(live));
}

export interface ClockCatchUp {
  /** Live state advanced to real wall time (unchanged if there's nothing to add). */
  working: LiveState;
  /** Whole seconds added (0 if already current, paused, or no anchor). */
  delta: number;
  /** Real time crossed a NON-final period boundary while away — caller should break for half-time. */
  crossedPeriod: boolean;
}

/**
 * Wall-clock catch-up for the live match clock (#3). A web page can't tick while it's backgrounded
 * or you've navigated away, so elapsed time is the truth held by the persisted anchor
 * (`{ elapsedSeconds, wallClockISO }`), NOT the count of interval fires. Advance `live` to the real
 * elapsed time implied by that anchor at `nowMs`, capped at the current period boundary / full time
 * so we never skip half-time or overrun. Only runs while the clock is running with an anchor;
 * otherwise it's a no-op (delta 0). Pure (time injected) so it's deterministic + unit-testable.
 */
/**
 * Should the pinned "next suggested change" countdown target be kept (vs. re-derived from the plan)?
 * Keep it only when it belongs to THIS match and is still in the future — so the countdown stays
 * stable across a navigate-away→return instead of jumping (the continuous planner re-derives its
 * window grid from the current time on every recalc). Re-pin once it's reached or the match changes.
 */
export function shouldKeepNextChange(
  current: { atSeconds: number } | null,
  targetMatchId: string | null,
  matchId: string,
  elapsedSeconds: number,
): boolean {
  return targetMatchId === matchId && current !== null && current.atSeconds > elapsedSeconds;
}

export function wallClockCatchUp(live: LiveState, match: SavedMatch, nowMs: number): ClockCatchUp {
  let working = live;
  let delta = 0;
  let crossedPeriod = false;
  if (live.status === "running" && match.clockAnchor) {
    const anchorMs = Date.parse(match.clockAnchor.wallClockISO);
    if (!Number.isNaN(anchorMs)) {
      const trueElapsed = match.clockAnchor.elapsedSeconds + (nowMs - anchorMs) / 1000;
      const periodEnd = periodEndSeconds(match, live);
      const isFinalPeriod = live.period >= match.config.periods;
      // Earlier periods auto-pause at their boundary (half-time). The FINAL period rolls on PAST full
      // time into added time (the coach ends it manually, item 6) — but UNATTENDED catch-up is capped
      // at its own end plus half a period of added time: a match left running and reopened hours/days
      // later must not credit every on-field player with the whole gap (it would poison season
      // totals). Anchored to where the final period actually started, so ending an earlier period
      // early moves the cap with it instead of granting the lost minutes back as added time. While
      // the app is open and ticking (coach present), added time still rolls uncapped.
      const addedTimeCap = periodEnd + periodLengthSeconds(match) / 2;
      const target = isFinalPeriod ? Math.min(trueElapsed, addedTimeCap) : Math.min(trueElapsed, periodEnd);
      delta = Math.floor(target - live.elapsedSeconds);
      if (delta > 0) {
        working = applyEvent(live, { type: "TICK", atSeconds: live.elapsedSeconds + delta, deltaSeconds: delta });
      }
      crossedPeriod = !isFinalPeriod && trueElapsed >= periodEnd;
    }
  }
  return { working, delta, crossedPeriod };
}
