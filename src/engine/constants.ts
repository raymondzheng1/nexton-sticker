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
 * Default interval (minutes) between sub windows for rotationStyle === "interval", by on-field
 * count band (PRD §7.3). NOTE: these are TIME intervals, not on-field counts — the on-field
 * invariant (CLAUDE.md #1) forbids hard-coding the PLAYER count, not rotation cadence.
 */
export function defaultIntervalMinutes(onFieldCount: number): number {
  if (onFieldCount <= 7) return 7;
  if (onFieldCount <= 9) return 9;
  return 11;
}
