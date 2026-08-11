/**
 * Sport configuration — the single place the UI reads sport-specific labels, defaults, position
 * groups, and surface kind. The fairness ENGINE is sport-agnostic; this only drives presentation +
 * sensible match defaults. Football is the default everywhere `sport` is absent (backward-compatible).
 */
import type { PositionGroup, PositionSlot, Sport } from "@/engine";

export interface SportConfig {
  id: Sport;
  label: string;
  /** Default players on the field/court for a new team/match. */
  defaultOnFieldCount: number;
  defaultPeriods: number;
  defaultPeriodLengthMinutes: number;
  /** Football has a goalkeeper; basketball does not (hides the GK controls + policy). */
  hasGoalkeeper: boolean;
  /** Pitch vs court — selects the surface graphic + token bands in <Pitch>. */
  surface: "pitch" | "court";
  /** "Pitch" / "Court" — used in headings and the live "X-a-side" line. */
  surfaceLabel: string;
  /** "on the pitch" / "on court". */
  onSurfaceLabel: string;
  /** "Kick off" / "Tip off". */
  startLabel: string;
  /** "Half" / "Quarter" — period noun. */
  periodLabel: string;
  /** Mid-game break heading: "Half time" / "Quarter break". */
  breakLabel: string;
  /** End-of-game heading: "Full time" / "Final". */
  endLabel: string;
  /** "-a-side" / "-on-court" — the format suffix. */
  formatSuffix: string;
  /**
   * Show time REMAINING in the current period alongside time elapsed.
   *
   * Football is timed upward — a coach and a referee both talk in minutes played ("he came off on
   * 62"), so elapsed alone is right. Basketball's game clock runs DOWN within each quarter or half,
   * and that's the number everyone on the court is watching. Elapsed still leads in both, because
   * the app's whole subject is minutes PLAYED; this adds the countdown next to it rather than
   * replacing it.
   */
  clockCountsDown: boolean;
  /** Emoji marking a score in tokens, totals and reports: ⚽ / 🏀. */
  scoreIcon: string;
  /** Button/toast noun for one score: "Goal" / "Score". */
  scoreLabel: string;
  /** Column + tile heading for the running total: "Goals" / "Points". */
  scoreTotalLabel: string;
  /** Card heading for who scored: "Goal scorers" / "Scorers". */
  scorersLabel: string;
  /**
   * What one score can be worth. Football has a single value, so logging stays one tap; basketball
   * needs the coach to say which — a free throw, a field goal, or from three.
   */
  scoreOptions: number[];
  /**
   * Outfield/court position categories for the squad editor (excludes GK; that's a separate toggle).
   * `value` is stored in the player's eligiblePositions — a GROUP (covers a whole line) or a specific
   * SLOT (e.g. the holding/attacking-mid roles DM/AM). `chip` is the short button text; `label` the
   * full name for screen readers + help text.
   */
  positionGroups: { value: PositionSlot | PositionGroup; chip: string; label: string }[];
  /**
   * Slots a selected on-field player can be MOVED to live ("Move to" picker). Excludes GK — keeper
   * changes go through a swap with the keeper (or the GK policy), never a casual reposition.
   */
  moveTargets: PositionSlot[];
}

export const SPORTS: Record<Sport, SportConfig> = {
  football: {
    id: "football",
    label: "Football",
    defaultOnFieldCount: 7,
    defaultPeriods: 2,
    defaultPeriodLengthMinutes: 30,
    hasGoalkeeper: true,
    surface: "pitch",
    surfaceLabel: "Pitch",
    onSurfaceLabel: "on the pitch",
    startLabel: "Kick off",
    periodLabel: "Half",
    breakLabel: "Half time",
    endLabel: "Full time",
    formatSuffix: "-a-side",
    clockCountsDown: false,
    scoreIcon: "⚽",
    scoreLabel: "Goal",
    scoreTotalLabel: "Goals",
    scorersLabel: "Goal scorers",
    scoreOptions: [1],
    positionGroups: [
      { value: "DEF", chip: "DEF", label: "Defense" },
      { value: "DM", chip: "CDM", label: "Defensive mid (CDM)" },
      { value: "MID", chip: "MID", label: "Midfield" },
      { value: "AM", chip: "CAM", label: "Attacking mid (CAM)" },
      { value: "FWD", chip: "ATT", label: "Attack" },
    ],
    moveTargets: ["DL", "DC", "DR", "DM", "ML", "MC", "MR", "AM", "FL", "FC", "FR"],
  },
  basketball: {
    id: "basketball",
    label: "Basketball",
    defaultOnFieldCount: 5,
    defaultPeriods: 2,
    defaultPeriodLengthMinutes: 18,
    hasGoalkeeper: false,
    surface: "court",
    surfaceLabel: "Court",
    onSurfaceLabel: "on court",
    startLabel: "Tip off",
    // Default is two 18′ periods (coach-adjustable to quarters at setup), so the neutral noun.
    periodLabel: "Period",
    breakLabel: "Period break",
    endLabel: "Final",
    formatSuffix: "-on-court",
    clockCountsDown: true,
    scoreIcon: "🏀",
    scoreLabel: "Score",
    scoreTotalLabel: "Points",
    scorersLabel: "Scorers",
    // Free throw · field goal · from three.
    scoreOptions: [1, 2, 3],
    positionGroups: [
      { value: "G", chip: "Guard", label: "Guard" },
      { value: "F", chip: "Forward", label: "Forward" },
      { value: "C", chip: "Centre", label: "Centre" },
    ],
    moveTargets: ["PG", "SG", "SF", "PF", "C"],
  },
};

/** Resolve the config for a (possibly undefined) sport — defaults to football. */
export function sportOf(sport: Sport | undefined | null): SportConfig {
  return SPORTS[sport ?? "football"];
}

/**
 * Full, lay-parent-friendly position names for reports (slot codes are coach shorthand). Slots are
 * unique across sports, so one map serves both.
 */
const SLOT_FULL_NAMES: Record<string, string> = {
  GK: "Goalkeeper",
  DL: "Left back",
  DC: "Centre back",
  DR: "Right back",
  DM: "Defensive mid",
  ML: "Left mid",
  MC: "Centre mid",
  MR: "Right mid",
  AM: "Attacking mid",
  FL: "Left wing",
  FC: "Striker",
  FR: "Right wing",
  PG: "Point guard",
  SG: "Shooting guard",
  SF: "Small forward",
  PF: "Power forward",
  C: "Centre",
};

/** "MC" → "Centre mid" (falls back to the code for anything unknown). */
export function slotFullName(slot: string): string {
  return SLOT_FULL_NAMES[slot] ?? slot;
}

/**
 * Coach shorthand for a slot chip. The engine's holding/attacking-mid slots are DM/AM internally but
 * every coach writes them CDM/CAM, so that's what the UI says — everywhere, without exception.
 */
export function slotShortName(slot: string): string {
  return slot === "DM" ? "CDM" : slot === "AM" ? "CAM" : slot;
}
