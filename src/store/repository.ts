/**
 * The persistence layer all reads/writes route through (PRD §12.2; Harness §3.1). It is
 * identity-aware (ownerId-scoped) and storage-agnostic (any {@link KeyValueStore}), so the engine
 * and UI never touch storage directly and a future cloud backend is a drop-in.
 *
 * Model: one {@link AppSnapshot} document per owner (small data; matches the "one JSON doc per
 * capability code" KV layout). Mutations are additive + soft-delete (tombstones) so a future sync
 * can merge (Harness §5.1). The append-only event log per match powers undo, recalculation, and
 * crash-safe restore (rebuilt via the pure engine).
 */
import { rebuildLiveState } from "../engine/index";
import type { LineupAssignment, LiveState, Match, MatchEvent, PlannedWindow, Player, Sport } from "../engine/index";
import { now } from "./clock";
import { getOwnerId } from "./identity";
import { newId } from "./ids";
import type { KeyValueStore } from "./keyValueStore";
import {
  emptySnapshot,
  parseAppSnapshot,
  type AppSnapshot,
  type MatchStatus,
  type SavedMatch,
  type Team,
} from "./schema";

const KEY_PREFIX = "nexton:v1:snapshot:";
export function snapshotKey(ownerId: string): string {
  return `${KEY_PREFIX}${ownerId}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface TeamInput {
  /** Provide to update an existing team (or to import with a known id); omit to create. */
  id?: string;
  name: string;
  ageGroup?: string;
  colour: string;
  /** Sport (default football); drives positions, court, defaults. */
  sport?: Sport;
  defaultOnFieldCount: number;
  roster: Player[];
  /** Season carry-forward toggle; omit ⇒ OFF (per-game fairness is the default). */
  seasonCarryForward?: boolean;
}

export interface CreateMatchInput {
  teamId: string;
  name: string;
  config: Match;
  /** Squad snapshot for this match (so historical insight survives later roster edits). */
  players: Player[];
  status?: MatchStatus;
  /** Coach's confirmed starting XI (from the lineup editor); kickoff uses it verbatim. */
  startingLineup?: LineupAssignment[] | null;
}

export interface MatchPatch {
  name?: string;
  config?: Match;
  status?: MatchStatus;
  clockAnchor?: { elapsedSeconds: number; wallClockISO: string } | null;
  /** The coach's approved substitution plan (pre-match timeline) — the live guide. */
  subPlan?: PlannedWindow[] | null;
  /**
   * Amend the match-squad snapshot: a 🕑 late player's ACTUAL arrival minute, or a surprise arrival
   * added mid-match. The event log stays untouched — players are an input to the replay, so a
   * rebuild stays deterministic against the amended squad.
   */
  players?: Player[];
}

export interface Repository {
  loadSnapshot(): Promise<AppSnapshot>;
  listTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  saveTeam(input: TeamInput): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  listMatches(teamId?: string): Promise<SavedMatch[]>;
  getMatch(id: string): Promise<SavedMatch | null>;
  createMatch(input: CreateMatchInput): Promise<SavedMatch>;
  updateMatch(id: string, patch: MatchPatch): Promise<SavedMatch>;
  deleteMatch(id: string): Promise<void>;
  /** Clear a delete tombstone (deletes are never erasures). Null if the id is unknown. */
  restoreMatch(id: string): Promise<SavedMatch | null>;
  /** Tombstoned matches, newest deletion first. */
  listDeletedMatches(teamId?: string): Promise<SavedMatch[]>;
  appendEvent(matchId: string, event: MatchEvent): Promise<SavedMatch>;
  /** Clear the event log + clock back to pre-match (keeps config, squad, and the confirmed XI). */
  resetMatch(id: string): Promise<SavedMatch>;
  getLiveState(matchId: string): Promise<LiveState>;
}

export class SnapshotRepository implements Repository {
  private cache: AppSnapshot | null = null;
  private cachedOwnerId: string | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly ownerIdFn: () => string = getOwnerId,
  ) {}

  // ── snapshot lifecycle ────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<AppSnapshot> {
    const ownerId = this.ownerIdFn();
    if (this.cache && this.cachedOwnerId === ownerId) return this.cache;
    const raw = await this.store.get(snapshotKey(ownerId));
    this.cache = raw === null ? emptySnapshot(ownerId, now()) : parseAppSnapshot(JSON.parse(raw));
    this.cachedOwnerId = ownerId;
    return this.cache;
  }

  /** Force a reload from storage (e.g. after an external sync wrote the snapshot). */
  async loadSnapshot(): Promise<AppSnapshot> {
    this.cache = null;
    return clone(await this.ensureLoaded());
  }

  private async persist(snapshot: AppSnapshot): Promise<void> {
    snapshot.updatedAt = now();
    await this.store.set(snapshotKey(snapshot.ownerId), JSON.stringify(snapshot));
  }

  // ── teams ─────────────────────────────────────────────────────────────────

  async listTeams(): Promise<Team[]> {
    const snap = await this.ensureLoaded();
    return snap.teams.filter((t) => t.deletedAt === null).map(clone);
  }

  async getTeam(id: string): Promise<Team | null> {
    const snap = await this.ensureLoaded();
    const team = snap.teams.find((t) => t.id === id && t.deletedAt === null);
    return team ? clone(team) : null;
  }

  async saveTeam(input: TeamInput): Promise<Team> {
    const snap = await this.ensureLoaded();
    const at = now();
    const existing = input.id ? snap.teams.find((t) => t.id === input.id) : undefined;
    if (existing) {
      existing.name = input.name;
      existing.ageGroup = input.ageGroup;
      existing.colour = input.colour;
      existing.sport = input.sport;
      existing.defaultOnFieldCount = input.defaultOnFieldCount;
      existing.roster = input.roster;
      existing.seasonCarryForward = input.seasonCarryForward;
      existing.deletedAt = null; // saving revives a tombstoned team
      existing.updatedAt = at;
      await this.persist(snap);
      return clone(existing);
    }
    const team: Team = {
      id: input.id ?? newId(),
      ownerId: snap.ownerId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      name: input.name,
      ageGroup: input.ageGroup,
      colour: input.colour,
      sport: input.sport,
      defaultOnFieldCount: input.defaultOnFieldCount,
      roster: input.roster,
      seasonCarryForward: input.seasonCarryForward,
    };
    snap.teams.push(team);
    await this.persist(snap);
    return clone(team);
  }

  async deleteTeam(id: string): Promise<void> {
    const snap = await this.ensureLoaded();
    const team = snap.teams.find((t) => t.id === id);
    if (!team || team.deletedAt !== null) return; // idempotent
    team.deletedAt = now();
    team.updatedAt = team.deletedAt;
    await this.persist(snap);
  }

  // ── matches ───────────────────────────────────────────────────────────────

  async listMatches(teamId?: string): Promise<SavedMatch[]> {
    const snap = await this.ensureLoaded();
    return snap.matches
      .filter((m) => m.deletedAt === null && (teamId === undefined || m.teamId === teamId))
      .map(clone);
  }

  async getMatch(id: string): Promise<SavedMatch | null> {
    const snap = await this.ensureLoaded();
    const match = snap.matches.find((m) => m.id === id && m.deletedAt === null);
    return match ? clone(match) : null;
  }

  async createMatch(input: CreateMatchInput): Promise<SavedMatch> {
    const snap = await this.ensureLoaded();
    const at = now();
    const match: SavedMatch = {
      id: newId(),
      ownerId: snap.ownerId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      teamId: input.teamId,
      name: input.name,
      config: input.config,
      players: input.players,
      status: input.status ?? "setup",
      startingLineup: input.startingLineup ?? null,
      events: [],
      eventEpoch: 0,
    };
    snap.matches.push(match);
    await this.persist(snap);
    return clone(match);
  }

  async updateMatch(id: string, patch: MatchPatch): Promise<SavedMatch> {
    const snap = await this.ensureLoaded();
    const match = this.requireMatch(snap, id);
    if (patch.name !== undefined) match.name = patch.name;
    if (patch.config !== undefined) match.config = patch.config;
    if (patch.status !== undefined) match.status = patch.status;
    if (patch.clockAnchor !== undefined) match.clockAnchor = patch.clockAnchor;
    if (patch.subPlan !== undefined) match.subPlan = patch.subPlan;
    if (patch.players !== undefined) match.players = patch.players;
    match.updatedAt = now();
    await this.persist(snap);
    return clone(match);
  }

  async deleteMatch(id: string): Promise<void> {
    const snap = await this.ensureLoaded();
    const match = snap.matches.find((m) => m.id === id);
    if (!match || match.deletedAt !== null) return;
    match.deletedAt = now();
    match.updatedAt = match.deletedAt;
    await this.persist(snap);
  }

  /**
   * Undo a delete. Deletion here has always been a TOMBSTONE (deletedAt), never an erasure — every
   * event, minute and score stays in the snapshot — so restoring is just clearing the stamp. Added
   * after a coach mis-tapped ✕ on a LIVE match from the team page (2026-08-16): the ✕ sat 2px from
   * the row you tap to reopen, the native confirm was reflex-dismissed, and the match "vanished"
   * mid-game with no way back even though nothing was actually lost. `updatedAt` bumps so the
   * restore wins last-writer-wins on sync.
   */
  async restoreMatch(id: string): Promise<SavedMatch | null> {
    const snap = await this.ensureLoaded();
    const match = snap.matches.find((m) => m.id === id);
    if (!match || match.deletedAt === null) return match ? clone(match) : null;
    match.deletedAt = null;
    match.updatedAt = now();
    await this.persist(snap);
    return clone(match);
  }

  /** Recently deleted matches (newest deletion first) — the recovery bin the team page shows. */
  async listDeletedMatches(teamId?: string): Promise<SavedMatch[]> {
    const snap = await this.ensureLoaded();
    return snap.matches
      .filter((m) => m.deletedAt !== null && (teamId === undefined || m.teamId === teamId))
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
      .map(clone);
  }

  async appendEvent(matchId: string, event: MatchEvent): Promise<SavedMatch> {
    const snap = await this.ensureLoaded();
    const match = this.requireMatch(snap, matchId);
    match.events.push(event);
    if (event.type === "MATCH_STARTED") {
      match.status = "live";
      match.startedAtISO ??= now();
    } else if (event.type === "MATCH_ENDED") {
      match.status = "completed";
      match.endedAtISO = now();
    }
    match.updatedAt = now();
    await this.persist(snap);
    return clone(match);
  }

  async resetMatch(id: string): Promise<SavedMatch> {
    const snap = await this.ensureLoaded();
    const match = this.requireMatch(snap, id);
    match.events = [];
    // Bump the event-log generation so a cross-device sync REPLACES the old log instead of resurrecting
    // it (the wipe is intentional — see mergeMatch in sync.ts).
    match.eventEpoch = (match.eventEpoch ?? 0) + 1;
    match.status = "setup";
    match.clockAnchor = null;
    delete match.startedAtISO;
    delete match.endedAtISO;
    match.updatedAt = now();
    await this.persist(snap);
    return clone(match);
  }

  async getLiveState(matchId: string): Promise<LiveState> {
    const snap = await this.ensureLoaded();
    const match = this.requireMatch(snap, matchId);
    // Crash-safe restore: the live state is a pure fold of the event log (Harness §1.2).
    return rebuildLiveState(match.config, match.players, match.events);
  }

  private requireMatch(snap: AppSnapshot, id: string): SavedMatch {
    const match = snap.matches.find((m) => m.id === id && m.deletedAt === null);
    if (!match) throw new Error(`match not found: ${id}`);
    return match;
  }
}
