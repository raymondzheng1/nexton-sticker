/**
 * Persisted record types + Zod schemas (Harness §2.4 "Zod at every IO boundary").
 *
 * Records compose the PURE engine domain types with sync/record metadata (`RecordMeta`) — the
 * deliberate boundary from CLAUDE.md: the engine stays identity-agnostic; identity/sync fields live
 * here. The Zod schemas validate untrusted JSON at the IO edges (KV reads, file import). The
 * hand-written TS types are the source of truth; `parseAppSnapshot` is the one place where a Zod /
 * engine drift would fail to compile.
 */
import { z } from "zod";
import { SCHEMA_VERSION } from "../engine/index";
import type { LineupAssignment, Match, MatchEvent, PlannedWindow, Player, Sport } from "../engine/index";

// ── Sync/record metadata (the seam composed onto engine types) ──────────────

export interface RecordMeta {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete tombstone (Harness §5.1) — null when live. */
  deletedAt: string | null;
}

export type MatchStatus = "setup" | "live" | "completed";

export interface Team extends RecordMeta {
  name: string;
  ageGroup?: string;
  colour: string;
  /** The sport this team plays — drives positions, court, defaults, terms. Default football. */
  sport?: Sport;
  defaultOnFieldCount: number;
  roster: Player[];
  /**
   * Season carry-forward toggle (PRD §8.6). Absent/false ⇒ OFF — each match is balanced on its own
   * (per-game fairness is the default; season minutes are still tracked separately, computed on
   * read). true ⇒ season minutes seed the next match's targets.
   */
  seasonCarryForward?: boolean;
}

export interface SavedMatch extends RecordMeta {
  teamId: string;
  name: string;
  config: Match;
  /** Snapshot of the squad at match time — so historical insight survives later roster edits. */
  players: Player[];
  status: MatchStatus;
  /**
   * The coach's confirmed starting lineup (slot→player), set in the lineup editor before kickoff.
   * When present, kickoff uses this exact XI/formation instead of the engine's auto-pick (PRD §8.2).
   */
  startingLineup?: LineupAssignment[] | null;
  /** Append-only event log (engine events) powering undo, recalc, crash recovery, sync. */
  events: MatchEvent[];
  /**
   * Event-log generation. A RESTART (which wipes the log) bumps this. The sync merge uses it to keep
   * the append-only union safe across a restart: a newer generation REPLACES the older one's log
   * wholesale instead of interleaving a wiped log with the old one (which could produce an
   * un-replayable order). Absent ⇒ generation 0.
   */
  eventEpoch?: number;
  /**
   * The coach's reviewed/approved substitution plan (pre-match timeline). When present, the live
   * match uses it as the GUIDE: the next-change countdown + the suggested change follow these windows
   * (the engine still adapts/falls back if reality drifts). Absent ⇒ purely engine-driven.
   */
  subPlan?: PlannedWindow[] | null;
  startedAtISO?: string;
  endedAtISO?: string;
  /**
   * Wall-clock anchor for a running clock: "at `elapsedSeconds`, the wall clock read `wallClockISO`".
   * Lets the clock stay correct after navigating away / backgrounding / lock (the page can't run JS
   * while away, so on return we catch up by real elapsed time). null/absent ⇒ clock not running.
   */
  clockAnchor?: { elapsedSeconds: number; wallClockISO: string } | null;
}

export interface AppSnapshot {
  schemaVersion: number;
  ownerId: string;
  updatedAt: string;
  teams: Team[];
  matches: SavedMatch[];
}

// ── Zod schemas (IO validation) ─────────────────────────────────────────────

const zSlot = z.enum([
  // Football
  "GK", "DL", "DC", "DR", "DM", "ML", "MC", "MR", "AM", "FL", "FC", "FR",
  // Basketball
  "PG", "SG", "SF", "PF", "C",
]);
const zGroup = z.enum(["GK", "DEF", "MID", "FWD", "G", "F", "C"]);
const zSlotOrGroup = z.union([zSlot, zGroup]);
const zSport = z.enum(["football", "basketball"]);

export const zPlayer = z.object({
  id: z.string(),
  name: z.string(),
  squadNumber: z.number().int().optional(),
  eligiblePositions: z.array(zSlotOrGroup),
  preferredPositions: z.array(zSlotOrGroup),
  preferredSide: z.enum(["left", "centre", "right"]).optional(),
  canPlayGK: z.boolean(),
  minutesWeight: z.number(),
  mustStart: z.boolean().optional(),
  alwaysOn: z.boolean().optional(),
  availability: z.enum(["available", "unavailable", "arrives-late"]).optional(),
  unavailableUntilMinute: z.number().optional(),
  /** Retired mid-match: out from this minute on (see Player.availableUntilMinute). */
  availableUntilMinute: z.number().optional(),
  carryForwardSeconds: z.number().optional(),
});

export const zMatch = z.object({
  sport: zSport.optional(),
  onFieldCount: z.number().int(),
  formationName: z.string().optional(),
  periods: z.number().int(),
  periodLengthMinutes: z.number(),
  rolloverSubsAllowed: z.boolean(),
  gkPolicy: z.enum(["countAsFieldTime", "rotateSeparately", "fixedGK"]),
  fixedGkPlayerId: z.string().optional(),
  gkByPeriod: z.array(z.string()).optional(),
  fairnessToleranceMinutes: z.number(),
  rotationStyle: z.enum(["interval", "period", "continuous"]),
  availableSquad: z.array(z.string()),
  intervalMinutes: z.number().optional(),
  minStintMinutes: z.number().optional(),
  stabilityHold: z.boolean().optional(),
  /** How often the coach wants to sub, 1–5; absent ⇒ 3 = the engine's own answer. */
  subFrequency: z.number().optional(),
});

const zLineupAssignment = z.object({ slot: zSlot, playerId: z.string(), positionFit: z.number() });
const zPositionChange = z.object({ playerId: z.string(), fromSlot: zSlot, toSlot: zSlot });
const zOnEntry = z.object({ playerId: z.string(), slot: zSlot });

const zPlannedWindow = z.object({
  atSeconds: z.number(),
  off: z.array(z.string()),
  on: z.array(zOnEntry),
  positionChanges: z.array(zPositionChange),
});

export const zMatchEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MATCH_STARTED"), atSeconds: z.number(), wallClockISO: z.string().optional(), lineup: z.array(zLineupAssignment) }),
  z.object({ type: z.literal("TICK"), atSeconds: z.number(), deltaSeconds: z.number() }),
  z.object({ type: z.literal("CLOCK_PAUSED"), atSeconds: z.number(), wallClockISO: z.string().optional() }),
  z.object({ type: z.literal("CLOCK_RESUMED"), atSeconds: z.number(), wallClockISO: z.string().optional() }),
  z.object({ type: z.literal("PERIOD_ENDED"), atSeconds: z.number(), period: z.number(), wallClockISO: z.string().optional() }),
  z.object({ type: z.literal("PERIOD_STARTED"), atSeconds: z.number(), period: z.number(), wallClockISO: z.string().optional() }),
  z.object({ type: z.literal("SUB_APPLIED"), atSeconds: z.number(), wallClockISO: z.string().optional(), off: z.array(z.string()), on: z.array(zOnEntry), positionChanges: z.array(zPositionChange) }),
  z.object({ type: z.literal("PLAYER_LOCKED"), atSeconds: z.number(), playerId: z.string(), locked: z.boolean() }),
  z.object({ type: z.literal("PLAYER_PINNED"), atSeconds: z.number(), playerId: z.string(), slot: zSlot.nullable() }),
  z.object({ type: z.literal("SNOOZE_SET"), atSeconds: z.number(), untilSeconds: z.number() }),
  // `points` is what the score was worth (basketball 1/2/3); absent ⇒ 1. Adding an optional FIELD is
  // forward-safe — a device still running an older cached build parses the event and drops the key.
  // Adding a whole new event TYPE would not be: the discriminated union rejects an unknown `type`,
  // and one bad event fails the entire snapshot. That's why retirement lives on the player record.
  z.object({ type: z.literal("GOAL_SCORED"), atSeconds: z.number(), playerId: z.string(), points: z.number().int().optional(), wallClockISO: z.string().optional() }),
  z.object({ type: z.literal("MATCH_ENDED"), atSeconds: z.number(), wallClockISO: z.string().optional() }),
]);

const zRecordMeta = {
  id: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
};

export const zTeam = z.object({
  ...zRecordMeta,
  name: z.string(),
  ageGroup: z.string().optional(),
  colour: z.string(),
  sport: zSport.optional(),
  defaultOnFieldCount: z.number().int(),
  roster: z.array(zPlayer),
  /** Season carry-forward toggle (PRD §8.6). Absent ⇒ OFF (per-game fairness is the default). */
  seasonCarryForward: z.boolean().optional(),
});

export const zSavedMatch = z.object({
  ...zRecordMeta,
  teamId: z.string(),
  name: z.string(),
  config: zMatch,
  players: z.array(zPlayer),
  status: z.enum(["setup", "live", "completed"]),
  startingLineup: z.array(zLineupAssignment).nullable().optional(),
  events: z.array(zMatchEvent),
  eventEpoch: z.number().int().optional(),
  subPlan: z.array(zPlannedWindow).nullable().optional(),
  startedAtISO: z.string().optional(),
  endedAtISO: z.string().optional(),
  clockAnchor: z
    .object({ elapsedSeconds: z.number(), wallClockISO: z.string() })
    .nullable()
    .optional(),
});

export const zAppSnapshot = z.object({
  schemaVersion: z.number().int(),
  ownerId: z.string(),
  updatedAt: z.string(),
  teams: z.array(zTeam),
  matches: z.array(zSavedMatch),
});

/**
 * Parse + validate untrusted JSON into an {@link AppSnapshot}. The explicit return type is the
 * single drift guard: if the Zod schema ever diverges from the engine types, THIS line stops
 * compiling. Throws (loudly) on malformed input or an unreadable future schema version.
 */
export function parseAppSnapshot(data: unknown): AppSnapshot {
  const parsed = zAppSnapshot.parse(data);
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `snapshot schemaVersion ${parsed.schemaVersion} is newer than supported ${SCHEMA_VERSION} — update the app`,
    );
  }
  return parsed;
}

/** An empty snapshot for a fresh owner. */
export function emptySnapshot(ownerId: string, at: string): AppSnapshot {
  return { schemaVersion: SCHEMA_VERSION, ownerId, updatedAt: at, teams: [], matches: [] };
}
