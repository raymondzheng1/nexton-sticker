/**
 * NextOn Rotation Engine — domain types (PRD §6).
 *
 * These are the PURE, identity-agnostic shapes the engine reasons over. They carry NO
 * persistence/sync metadata (ownerId, createdAt, updatedAt, deletedAt, schemaVersion) — that
 * lives in the store layer (`src/store/`, Phase 2) which composes these with a `RecordMeta`
 * type. The engine knows nothing about users, accounts, or sync (PRD §12.2). All time is in
 * SECONDS and is injected, never read from a clock — this is what makes the engine
 * deterministic and unit-testable (CLAUDE.md invariants #5, #7).
 */

// ── Sport ───────────────────────────────────────────────────────────────────

/** The game a team/match is for. Football is the default; basketball reuses the same fairness
 * engine with its own position taxonomy, court layout, and terminology. */
export type Sport = "football" | "basketball";

// ── Position taxonomy (§6.1) ────────────────────────────────────────────────

/**
 * Coarse position groups. The engine prefers like-for-like, then same group, then adjacent.
 * Football: GK · DEF · MID · FWD. Basketball: G (guard) · F (forward) · C (center). The two sets are
 * kept contiguous in the adjacency order (positions.ts) so within-sport adjacency is correct and
 * cross-sport pairs (never queried, since a match is single-sport) don't matter.
 */
export type PositionGroup = "GK" | "DEF" | "MID" | "FWD" | "G" | "F" | "C";

/** Specific slots. Each belongs to exactly one {@link PositionGroup}. */
export type PositionSlot =
  // Football
  | "GK"
  | "DL"
  | "DC"
  | "DR"
  | "DM"
  | "ML"
  | "MC"
  | "MR"
  | "AM"
  | "FL"
  | "FC"
  | "FR"
  // Basketball (PG/SG guards · SF/PF forwards · C center)
  | "PG"
  | "SG"
  | "SF"
  | "PF"
  | "C";

/**
 * A formation: an ordered list of slots that sums to the on-field count.
 * `slots.length` MUST equal `match.onFieldCount` (enforced in the engine; CLAUDE.md invariant #1).
 */
export interface Formation {
  /** Stable id, e.g. "7-2-3-1" (onFieldCount-then-shape) for the library; "gen-10-3-3-3" generated. */
  id: string;
  /** Human label, e.g. "2-3-1". */
  name: string;
  /** Players per side this formation is for (incl. GK). */
  onFieldCount: number;
  /** Ordered slots; length === onFieldCount. */
  slots: PositionSlot[];
  /** True when produced by the generator (no curated entry existed). */
  generated: boolean;
}

// ── Player (§6.3) ───────────────────────────────────────────────────────────

export type Availability = "available" | "unavailable" | "arrives-late";

/**
 * A player as the engine sees them. `eligiblePositions` may contain slots and/or groups
 * (a player eligible for the group "DEF" can play any DEF slot).
 */
export interface Player {
  id: string;
  name: string;
  squadNumber?: number;
  /** Slots and/or groups the player can play. */
  eligiblePositions: (PositionSlot | PositionGroup)[];
  /** Ordered preference (slots and/or groups); earlier = more preferred. */
  preferredPositions: (PositionSlot | PositionGroup)[];
  /**
   * Preferred side of the pitch — used to slot the player on the correct flank WITHIN a line
   * (e.g. a left-back goes to DL, not DR). Undefined ⇒ no preference (any side). Refines, never
   * gates: it only nudges the column choice among slots the player can already play.
   */
  preferredSide?: "left" | "centre" | "right";
  canPlayGK: boolean;
  /** Fairness share multiplier, 0.0–1.0 (default 1.0). 0.5 ⇒ expects half the standard minutes. */
  minutesWeight: number;
  // ── per-match flags (overrides; §7.6) ──
  mustStart?: boolean;
  /**
   * NOT part of the rotation (e.g. the keeper, the captain): guaranteed to start and NEVER planned
   * or suggested off — the live state initialises them locked (keep-on, invariant #3); the coach
   * can still Release them during the match. Fairness distributes the remaining minutes around them.
   */
  alwaysOn?: boolean;
  availability?: Availability;
  /** Minute (from kickoff) before which an arrives-late player is unavailable. */
  unavailableUntilMinute?: number;
  /**
   * Minute (from kickoff) from which the player is OUT for the rest of the match — the coach
   * "retired" them mid-game (injury, fouled out, had to leave). The mirror image of
   * {@link unavailableUntilMinute}: their fair share is pro-rated to the window they were actually
   * available for, so the minutes they can no longer play redistribute to everyone still on.
   * They're never suggested on again while it's set; clearing it brings them back into the rotation.
   */
  availableUntilMinute?: number;
  /**
   * Season carry-forward seed in SECONDS (PRD §8.6, §11). Positive = owed minutes from prior
   * matches (should start / play more this match); negative = played extra previously. Added to
   * the player's debt so the engine balances ACROSS matches. Optional; defaults to 0.
   */
  carryForwardSeconds?: number;
}

// ── Match config (§6.4) ─────────────────────────────────────────────────────

export type GkPolicy = "countAsFieldTime" | "rotateSeparately" | "fixedGK";
export type RotationStyle = "interval" | "period" | "continuous";

/** Tactical shape bias used to suggest a formation (PRD §6.1 — coach picks the big picture). */
export type FormationStyle = "defensive" | "balanced" | "attacking" | "aggressive";

export interface Match {
  /** The sport — drives the position taxonomy, formation set, and court layout. Default football. */
  sport?: Sport;
  /** Players per side — ANY integer ≥ 1 (e.g. 5, 7, 9, 10, 11). The single source of truth. */
  onFieldCount: number;
  /** Formation name to resolve from the library, or undefined to auto-pick/generate. */
  formationName?: string;
  /** Number of periods (e.g. 2 halves, 4 quarters). */
  periods: number;
  /** Length of each period, in minutes. */
  periodLengthMinutes: number;
  /** Rolling subs vs fixed windows. */
  rolloverSubsAllowed: boolean;
  gkPolicy: GkPolicy;
  /** Required only when gkPolicy === "fixedGK": the player who keeps for the whole match. */
  fixedGkPlayerId?: string;
  /**
   * gkPolicy === "fixedGK", per-period keepers (football): the designated keeper for each period,
   * index 0 = first half. Same id in every slot ⇒ one keeper the whole match (identical to
   * `fixedGkPlayerId`). Different ids ⇒ the keeper is swapped at each period break, and each keeper
   * plays outfield (in the fair rotation) during the periods they don't keep. When present it takes
   * precedence over `fixedGkPlayerId`. Absent ⇒ falls back to `fixedGkPlayerId` for all periods.
   */
  gkByPeriod?: string[];
  /** Target end-of-match spread, in minutes (default 2). */
  fairnessToleranceMinutes: number;
  rotationStyle: RotationStyle;
  /** Player ids available for this match (the available squad). */
  availableSquad: string[];
  /**
   * For rotationStyle === "interval": minutes between sub windows. Optional; the engine derives a
   * sensible default from onFieldCount when omitted.
   */
  intervalMinutes?: number;
  /** Minimum stint before a player may be suggested off (just-subbed protection; default 3). */
  minStintMinutes?: number;
  /**
   * "Settle-in" hold: with periods longer than 10′, don't SCHEDULE a change in the opening 4 minutes
   * of each period (steadier start). Absent/true ⇒ the hold is on (default). false ⇒ the planner subs
   * at even intervals from the first minute (the coach's "equal time regardless of the early minutes"
   * option). The coach can always hand-place a change anywhere either way.
   */
  stabilityHold?: boolean;
  /**
   * How OFTEN the coach wants to substitute, as a level 1–5 (see `SUB_FREQUENCY_LEVELS`):
   * 1 = fewest changes / longest stints … 3 = balanced (the fairest plan with the least churn) …
   * 5 = most changes / shortest stints. Absent ⇒ 3, which is exactly the engine's own answer, so
   * every stored match plans identically to before this setting existed.
   *
   * It is a preference, not a promise: fairness is still computed and REPORTED at every level, so
   * choosing fewer changes visibly widens the projected spread rather than silently degrading it.
   */
  subFrequency?: number;
}

// ── Live state (§6.5) ───────────────────────────────────────────────────────

export type ClockStatus = "pre-match" | "running" | "paused" | "period-break" | "full-time";

/** Per-player mutable live state. All accumulators are in SECONDS. */
export interface PlayerLiveState {
  playerId: string;
  onField: boolean;
  /** Current slot if on field, else null. */
  currentSlot: PositionSlot | null;
  /** Total field seconds accrued (only while the clock runs). */
  secondsOnField: number;
  /** Subset of secondsOnField spent in the GK slot (for gkPolicy === "rotateSeparately"). */
  secondsAsGk: number;
  /**
   * Field seconds broken down by the slot occupied while they accrued — the per-position history
   * behind player performance reports. Sums to secondsOnField. Derived purely from the event log,
   * so it works retroactively for every stored match.
   */
  secondsBySlot: Partial<Record<PositionSlot, number>>;
  /** Seconds in the current uninterrupted stint (resets on sub on/off). */
  secondsThisStint: number;
  /** Coach marked this player as a key player / keep-on — never suggested off (§7.6). */
  locked: boolean;
  /** Coach pinned this player to a slot — the engine won't move them (§7.6). */
  pinnedSlot: PositionSlot | null;
  /** Scoring EVENTS credited to this player (football goals; basketball baskets made). */
  goals: number;
  /**
   * Points scored — the sum of each scoring event's value. Football scores are worth 1, so
   * `points === goals` there; basketball counts 1 (free throw), 2, or 3 per basket. Never affects
   * fairness or minutes.
   */
  points: number;
}

export interface LiveState {
  status: ClockStatus;
  /** 1-based current period. */
  period: number;
  /** Total elapsed match seconds (sum across periods; only advances while running). */
  elapsedSeconds: number;
  /**
   * Elapsed match seconds at which the CURRENT period actually kicked off.
   *
   * Periods are NOT uniform. A coach can end one early — the ref blows up, it's freezing, a team has
   * to leave — so "where are we in this period?" cannot be derived from `(period − 1) × periodLength`
   * the way it used to be: end half 1 at 12:00 of a 4×15 and that formula still puts half 2's whistle
   * at 30:00, giving it 18 minutes. This is the missing truth; the boundary is
   * `periodStartedAtSeconds + periodLength`, full stop.
   *
   * DERIVED, never persisted. `LiveState` is only ever produced by folding the event log
   * (`rebuildLiveState`); the store saves `SavedMatch.events`, not this state (see
   * `src/store/schema.ts` — there is no LiveState schema). The log already carries the truth in
   * `PERIOD_STARTED.atSeconds`, so every match stored before this field existed replays into a state
   * that has it: no schema change, no migration.
   */
  periodStartedAtSeconds: number;
  /** Per-player live state, keyed by player id. */
  players: Record<string, PlayerLiveState>;
  /** Minute (from kickoff) until which the engine should not suggest the next sub (snooze; §7.6). */
  snoozedUntilSeconds?: number;
}

// ── Plan & recommendation outputs (§7.3–7.4) ────────────────────────────────

/** A single off↔on pairing, optionally with a slot change. */
export interface Swap {
  /** Player coming off (or null for a pure position change of `playerOn`). */
  playerOff: string | null;
  /** Player coming on (from bench). */
  playerOn: string;
  /** The slot `playerOn` will occupy. */
  toSlot: PositionSlot;
  /** Debt (seconds) of the off-going player at the moment of the swap (negative = over-played). */
  offDebtSeconds: number;
  /** Debt (seconds) of the on-coming player (positive = under-played). */
  onDebtSeconds: number;
  /** Position-fit score of `playerOn` in `toSlot` (0..1, higher = better). */
  positionFit: number;
}

/** A chained position change applied alongside a batch (e.g. move an on-field MID to DEF). */
export interface PositionChange {
  playerId: string;
  fromSlot: PositionSlot;
  toSlot: PositionSlot;
}

/** One scheduled change window in the forward plan. */
export interface SubWindow {
  /** Minute from kickoff at which the window occurs. */
  atMinute: number;
  off: string[];
  on: string[];
  swaps: Swap[];
  positionChanges: PositionChange[];
}

export interface SubPlan {
  windows: SubWindow[];
  /** Predicted per-player debt (seconds) at full time, if the plan runs as scheduled. */
  predictedFinalDebtSeconds: Record<string, number>;
  /** Predicted end-of-match max |debt| in seconds across fairness-eligible players. */
  predictedMaxAbsDebtSeconds: number;
  /**
   * True when the engine could not get predicted spread within tolerance given the constraints
   * (e.g. no bench, locks, too-coarse a rotation cadence). Advisory — never blocks (§11).
   */
  toleranceInfeasible: boolean;
}

/**
 * A coach-editable, persisted planned change — the storage/edit shape of a {@link SubWindow}, in the
 * same form as a SUB_APPLIED event so it can be folded into a live state directly. Times are SECONDS
 * from kickoff. This is what the pre-match plan timeline edits and what the live match follows as a
 * guide.
 */
export interface PlannedWindow {
  /** Seconds from kickoff at which the change happens. */
  atSeconds: number;
  /** Players coming off. */
  off: string[];
  /** Players coming on, each with the slot they take. */
  on: { playerId: string; slot: PositionSlot }[];
  /** On-field position changes applied alongside the swap. */
  positionChanges: PositionChange[];
}

/** A recommended swap batch for the next window (advisory; §7.4). */
export interface Recommendation {
  atMinute: number;
  /** The primary recommended batch (1 swap for a single sub, N for a multi-sub). */
  primary: Swap[];
  /** 1–2 alternative single swaps the coach can pick instead. */
  alternatives: Swap[];
  positionChanges: PositionChange[];
  /** Advisory note when honouring constraints makes equal time impossible (§7.6). Empty if none. */
  note: string;
}

// ── Starting lineup (§7.3) ──────────────────────────────────────────────────

export interface LineupAssignment {
  slot: PositionSlot;
  playerId: string;
  positionFit: number;
}

export interface StartingLineup {
  assignments: LineupAssignment[];
  /** Player ids on the bench at kickoff. */
  bench: string[];
}

// ── Event log (§6.5) ────────────────────────────────────────────────────────

/**
 * Append-only events. Every event carries `atSeconds` = elapsed match seconds when it occurred,
 * so the log replays deterministically (rebuild for crash recovery). `wallClockISO` is an
 * optional audit stamp supplied by the caller (the engine never reads a clock itself).
 */
export type MatchEvent =
  | { type: "MATCH_STARTED"; atSeconds: number; wallClockISO?: string; lineup: LineupAssignment[] }
  | { type: "TICK"; atSeconds: number; deltaSeconds: number }
  | { type: "CLOCK_PAUSED"; atSeconds: number; wallClockISO?: string }
  | { type: "CLOCK_RESUMED"; atSeconds: number; wallClockISO?: string }
  | { type: "PERIOD_ENDED"; atSeconds: number; period: number; wallClockISO?: string }
  | { type: "PERIOD_STARTED"; atSeconds: number; period: number; wallClockISO?: string }
  | {
      type: "SUB_APPLIED";
      atSeconds: number;
      wallClockISO?: string;
      off: string[];
      on: { playerId: string; slot: PositionSlot }[];
      positionChanges: PositionChange[];
    }
  | { type: "PLAYER_LOCKED"; atSeconds: number; playerId: string; locked: boolean }
  | { type: "PLAYER_PINNED"; atSeconds: number; playerId: string; slot: PositionSlot | null }
  | { type: "SNOOZE_SET"; atSeconds: number; untilSeconds: number }
  // A score. `points` is what it was worth (basketball 1/2/3); absent ⇒ 1, so every football goal
  // and every already-stored basket still counts as one point. Kept as GOAL_SCORED deliberately:
  // renaming the event would make stored logs — and any snapshot synced to a device still running
  // an older cached build — fail the discriminated-union parse outright.
  | { type: "GOAL_SCORED"; atSeconds: number; playerId: string; points?: number; wallClockISO?: string }
  | { type: "MATCH_ENDED"; atSeconds: number; wallClockISO?: string };

export type MatchEventType = MatchEvent["type"];
