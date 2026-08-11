/**
 * Fairness-status system (design handoff §"Status system — colour-blind-safe").
 *
 * State is NEVER encoded by colour alone: every status carries hue + glyph + ring-shape + label,
 * so it reads across all colour-vision types and in bright sun. Derived from the engine's fairness
 * debt (seconds): debt = expectedSoFar − actual, so a positive debt means the player is BEHIND on
 * minutes (needs to come on), negative means they're AHEAD (give a rest).
 */

export type TokenStatus = "under" | "on" | "over";

/** TOL = 4 minutes either side of fair share counts as "on target" (handoff §Status). */
export const STATUS_TOL_SECONDS = 240;

/**
 * Display tolerance scaled to the MATCH LENGTH: 10% of scheduled time, clamped to [30s, 4min].
 * A fixed 4-minute band is right for a standard 40–60′ game but absurd for a short one (a 6′
 * game would call a 6′-vs-3′ split "100% fair"). Standard games are unchanged (cap = 240s).
 */
export function statusTolFor(totalMatchSeconds: number): number {
  return Math.max(30, Math.min(STATUS_TOL_SECONDS, Math.round(totalMatchSeconds * 0.1)));
}

export function statusFor(debtSeconds: number, tolSeconds: number = STATUS_TOL_SECONDS): TokenStatus {
  if (debtSeconds >= tolSeconds) return "under"; // behind fair share → needs minutes
  if (debtSeconds <= -tolSeconds) return "over"; // ahead of fair share → give a rest
  return "on";
}

export interface StatusMeta {
  /** Long label for aria + sheets. */
  label: string;
  /** Short label for tight chips. */
  short: string;
  /** Redundant non-colour encoding. */
  glyph: string;
  /** CSS custom-property reference for the status hue. */
  token: string;
}

export const STATUS_META: Record<TokenStatus, StatusMeta> = {
  under: { label: "Needs minutes", short: "Needs", glyph: "▲", token: "var(--st-under)" },
  on: { label: "On target", short: "On", glyph: "✓", token: "var(--st-on)" },
  over: { label: "Give a rest", short: "Rest", glyph: "▼", token: "var(--st-over)" },
};

/**
 * The presentational view-model a {@link PlayerToken} renders. Identity-light by design — first
 * names only, the numbered disc is the identity (handoff §Privacy). All time is in seconds; the
 * token converts to whole minutes for display.
 */
export interface TokenPlayer {
  id: string;
  name: string;
  /** Squad number, or initials when no number is set. */
  label: string;
  /** Current pitch slot (e.g. "MC", "GK"); null when on the bench. */
  position: string | null;
  isGK: boolean;
  locked: boolean;
  secondsOnField: number;
  /** Fair share of minutes by now, in seconds (engine: secondsOnField + debtSeconds). */
  fairSeconds: number;
  status: TokenStatus;
  /**
   * What this player has scored this match, in the sport's own unit — football goals, basketball
   * POINTS (so a single three-pointer shows as 3). Shown as a small badge; 0 ⇒ hidden.
   */
  score?: number;
  /** Badge emoji for a score: ⚽ football, 🏀 basketball. Defaults to ⚽. */
  scoreIcon?: string;
  /** 🕑 late player who hasn't arrived yet (bench only) — shown as a clock on the disc. */
  pendingArrival?: boolean;
}
