/**
 * Engine defaults — the single source of truth for tunable constants (Harness §3.3).
 * Import these; never re-type a literal that lives here.
 */

export const SECONDS_PER_MINUTE = 60;

/** Default fairness tolerance (minutes) when a match doesn't set one (PRD §6.4). */
export const DEFAULT_FAIRNESS_TOLERANCE_MINUTES = 2;

/** Just-subbed protection: don't suggest pulling a player on < this many minutes (PRD §11). */
export const DEFAULT_MIN_STINT_MINUTES = 3;

/** Default player fairness-share multiplier (PRD §6.3). */
export const DEFAULT_MINUTES_WEIGHT = 1;

/** The implicit local owner id for v1 (single-user, no auth — PRD §12.2). */
export const LOCAL_OWNER_ID = "local";

/** Current persisted-schema version (store layer; bump on any record-shape change — Harness §5). */
export const SCHEMA_VERSION = 1;

/**
 * `swapScore` weights (PRD §7.4). All in consistent units after debt is normalised to minutes:
 *   swapScore = w1*onComingDebt − w2*offGoingDebtIfKept + w3*positionFit
 *             − w4*stintTooShortPenalty − w5*overrideViolationPenalty
 */
export const SWAP_WEIGHTS = {
  /** reward bringing on the most-owed player */
  onComingDebt: 1.0,
  /** reward taking off the most over-played (offGoing debt is negative ⇒ subtracting rewards it) */
  offGoingDebt: 1.0,
  /** like-for-like preference (positionFit is 0..1, scaled to be comparable to minutes of debt) */
  positionFit: 4.0,
  /** penalty for yanking someone who just came on */
  stintTooShort: 8.0,
  /** penalty for violating a soft override (hard overrides are filtered out before scoring) */
  overrideViolation: 50.0,
} as const;

/**
 * Hysteresis margin (minutes): in the forward plan, only swap when the incoming player's debt
 * exceeds the outgoing player's debt by at least this much, to avoid churn near equilibrium.
 */
export const PLAN_SWAP_HYSTERESIS_MINUTES = 0.5;

/** Continuous-style planning: hard cap on number of sub windows (sanity / battery). */
export const MAX_PLAN_WINDOWS = 40;

/**
 * Sub-frequency levels (`Match.subFrequency`, 1–5). Each level is a MULTIPLIER on however many
 * changes the engine would choose on its own — so the knob scales with the match, the squad and the
 * bench instead of imposing a fixed cadence that would be absurd for a 6′ game and timid for a 90′
 * one. Level 3 is exactly 1.0: absent/3 must plan byte-identically to before this setting existed.
 *
 * Steps are multiplicative rather than "fewest → maximum possible" so each notch is a noticeable but
 * proportionate move, and the slider stays monotonic for every squad size.
 */
export const SUB_FREQUENCY_LEVELS = [0.45, 0.7, 1, 1.3, 1.7] as const;

/** Balanced — the engine's own answer (fairest plan with the least churn). */
export const DEFAULT_SUB_FREQUENCY = 3;

/**
 * Resolve a (possibly absent or out-of-range) level to its multiplier. Anything unrecognised falls
 * back to balanced, so a corrupted or future value can never produce a wild plan.
 */
export function subFrequencyMultiplier(level: number | undefined): number {
  const idx = Math.round(level ?? DEFAULT_SUB_FREQUENCY) - 1;
  return SUB_FREQUENCY_LEVELS[idx] ?? 1;
}

/**
 * How much the minimum-stint floor relaxes at the top of the slider.
 *
 * This matters more than it looks. The engine's balanced plan is often ALREADY close to the most
 * windows the stint floor permits (`floor(remaining / minStint) − 1`), so without relaxing the floor
 * levels 3, 4 and 5 all hit the cap and produce the same plan — a slider whose top half does
 * nothing. And it is the honest reading of the control: asking for more changes IS asking for
 * shorter stints. Levels 1–3 leave the coach's setting untouched.
 */
export function subFrequencyMinStintScale(level: number | undefined): number {
  const l = Math.round(level ?? DEFAULT_SUB_FREQUENCY);
  if (l >= 5) return 0.6;
  if (l === 4) return 0.8;
  return 1;
}

/**
 * Never rotate players in stints shorter than this, however hard the coach pushes the slider — under
 * two minutes a "stint" stops being playing time and starts being a queue.
 */
export const MIN_STINT_FLOOR_MINUTES = 2;

/**
 * Rotation quality (2026-08-17). Equal minutes alone let the engine shuttle a player on and off in
 * a few minutes: coming off is exactly what makes someone the most-owed player at the next window,
 * and the only guard was a 3-minute just-subbed floor. Coaches want everyone FRESH (properly
 * rested) and WARM (a real run on the pitch), so the engine derives a minimum stint and a minimum
 * rest from the match itself: each player's fair share of field time is split into about this
 * many stints, and their time off the pitch into about as many rests. 3 is the Balanced answer:
 * a 60-minute 5-a-side with 8 players gives roughly 12-minute stints and 7-minute rests; the
 * sub-frequency slider shortens both at levels 4-5 (see subFrequencyMinStintScale).
 */
export const ROTATION_STINTS_PER_PLAYER = 3;

/**
 * How the derived targets are enforced. The HARD floor is this fraction of the target: below it
 * the engine will not end a stint or a rest on its own (a forced change by the coach still can).
 * Above it the target is a SOFT cost (see ROTATION_SOFT_WEIGHT). Making the whole target hard was
 * tried first and failed the fairness corpus outright — matches that met tolerance stopped meeting
 * it, a one-player bench stalled, and the live recommender went silent early in a match because
 * nobody had been on "long enough". 0.5 then left 8-player plans just outside a 2′ tolerance and
 * a quarter-by-quarter short match 30s over a 3′ one; 0.4 meets both with margin while still
 * giving a 60′ 5-a-side with 8 players 5′ stints and 3′ rests as HARD floors (the soft cost and
 * the rotation ordering do the rest). Measured, not guessed. Fairness leads; rotation shapes it.
 */
export const ROTATION_HARD_FRACTION = 0.4;

/**
 * Debt-seconds of cost per second a swap cuts a stint or a rest short of its target, tapering to
 * zero as the match runs out (late balancing must never be blocked). A swap happens only when the
 * fairness gain exceeds hysteresis PLUS this cost — so a 20-second advantage no longer pulls a
 * player who has been on for five minutes, but a five-minute advantage still does.
 */
export const ROTATION_SOFT_WEIGHT = 0.35;

/** A rest shorter than this isn't a rest. Floor for the derived minimum rest. */
export const MIN_REST_FLOOR_SECONDS = 60;

/**
 * What a period break is worth as rest to the bench: enough to clear any rest floor the engine
 * derives (the largest realistic floor is a few minutes), so everyone comes out of a break fresh.
 */
export const BREAK_REST_CREDIT_SECONDS = 15 * 60;

/**
 * Default interval (minutes) between sub windows for rotationStyle === "interval", by on-field
 * count band (PRD §7.3). NOTE: these are TIME intervals, not on-field counts — the on-field
 * invariant (CLAUDE.md #1) forbids hard-coding the PLAYER count, not rotation cadence.
 */
export function defaultIntervalMinutes(onFieldCount: number): number {
  if (onFieldCount <= 7) return 7;
  if (onFieldCount <= 9) return 9;
  return 11;
}
