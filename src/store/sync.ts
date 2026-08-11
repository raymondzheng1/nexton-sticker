/**
 * Two-layer cross-device sync (PRD §12.2; Harness §18.2). The local IndexedDB layer is the instant
 * offline working store; the cloud KV layer is the source of truth across devices. Sync = pull both
 * snapshots for an owner, MERGE, write the merged result back to both.
 *
 * Merge policy (single-user, multi-device):
 *  - Teams & match metadata: **last-writer-wins by `updatedAt`** (tombstones are just a newer state,
 *    so a newer delete wins and a newer edit revives — no record silently disappears otherwise).
 *  - Match **event logs: monotone union** — append-only, never lose events (§18.2 anti-shrink).
 * Concurrently *editing the same live match on two devices at once* is out of scope (you run a
 * match on one device); that case falls back to last-writer-wins on the whole match.
 */
import { SCHEMA_VERSION } from "../engine/index";
import type { MatchEvent } from "../engine/index";
import { now } from "./clock";
import type { KeyValueStore } from "./keyValueStore";
import { snapshotKey } from "./repository";
import {
  emptySnapshot,
  parseAppSnapshot,
  type AppSnapshot,
  type RecordMeta,
  type SavedMatch,
} from "./schema";

function pickNewer<T extends { updatedAt: string }>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b; // ties keep `a` (the first arg) — deterministic
}

/** Merge two id-keyed record lists by last-writer-wins; output sorted by id (deterministic). */
function mergeRecords<T extends RecordMeta>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) {
    const existing = map.get(r.id);
    map.set(r.id, existing ? pickNewer(existing, r) : r);
  }
  return [...map.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

const eventKey = (e: MatchEvent): string => JSON.stringify(e);

function isPrefix(short: MatchEvent[], long: MatchEvent[]): boolean {
  if (short.length > long.length) return false;
  for (let i = 0; i < short.length; i++) {
    if (eventKey(short[i] as MatchEvent) !== eventKey(long[i] as MatchEvent)) return false;
  }
  return true;
}

/**
 * Monotone event-log merge for ONE generation of a match. An event log is causally ordered (it must
 * replay through the reducer), so we never interleave two logs by time — that can yield an
 * un-replayable order (e.g. two MATCH_STARTED). Instead:
 *  - if one log extends the other (the common single-device case), keep the LONGER (anti-shrink);
 *  - if they genuinely diverged (out-of-scope: the same match played on two devices at once), keep
 *    the LONGER coherent log rather than a Frankenstein union.
 * Cross-RESTART safety is handled one level up by the event epoch (see {@link mergeMatch}).
 */
export function mergeEvents(a: MatchEvent[], b: MatchEvent[]): MatchEvent[] {
  if (isPrefix(a, b)) return b;
  if (isPrefix(b, a)) return a;
  return a.length >= b.length ? a : b;
}

const epochOf = (m: SavedMatch): number => m.eventEpoch ?? 0;

/**
 * Merge two copies of the SAME match. A RESTART bumps `eventEpoch` and wipes the log, so a newer
 * generation REPLACES the older one wholesale — never resurrecting or interleaving a deliberately
 * wiped log. Within one generation, metadata is last-writer-wins and the event log uses the monotone
 * {@link mergeEvents}. This is the permanent guarantee that a synced log is always replayable.
 */
function mergeMatch(a: SavedMatch, b: SavedMatch): SavedMatch {
  if (epochOf(a) !== epochOf(b)) return epochOf(a) > epochOf(b) ? a : b;
  return { ...pickNewer(a, b), events: mergeEvents(a.events, b.events) };
}

function mergeMatches(a: SavedMatch[], b: SavedMatch[]): SavedMatch[] {
  const map = new Map<string, SavedMatch>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) {
    const existing = map.get(m.id);
    map.set(m.id, existing ? mergeMatch(existing, m) : m);
  }
  return [...map.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Merge two snapshots for the SAME owner. Throws on a cross-owner merge (loud — restamp first). */
export function mergeSnapshots(a: AppSnapshot, b: AppSnapshot): AppSnapshot {
  if (a.ownerId !== b.ownerId) {
    throw new Error(`cannot merge snapshots from different owners: ${a.ownerId} vs ${b.ownerId}`);
  }
  return {
    schemaVersion: Math.max(a.schemaVersion, b.schemaVersion, SCHEMA_VERSION),
    ownerId: a.ownerId,
    updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt,
    teams: mergeRecords(a.teams, b.teams),
    matches: mergeMatches(a.matches, b.matches),
  };
}

export async function loadSnapshotFrom(store: KeyValueStore, ownerId: string): Promise<AppSnapshot> {
  const raw = await store.get(snapshotKey(ownerId));
  return raw === null ? emptySnapshot(ownerId, now()) : parseAppSnapshot(JSON.parse(raw));
}

export async function saveSnapshotTo(store: KeyValueStore, snapshot: AppSnapshot): Promise<void> {
  await store.set(snapshotKey(snapshot.ownerId), JSON.stringify(snapshot));
}

/**
 * Sync one owner's data between a local and a remote {@link KeyValueStore}: pull both, merge, write
 * the merged snapshot back to both. Returns the merged snapshot. Safe to call repeatedly (the merge
 * is idempotent once both sides agree).
 */
export async function syncNow(
  local: KeyValueStore,
  remote: KeyValueStore,
  ownerId: string,
): Promise<AppSnapshot> {
  const [localSnap, remoteSnap] = await Promise.all([
    loadSnapshotFrom(local, ownerId),
    loadSnapshotFrom(remote, ownerId),
  ]);
  const merged = mergeSnapshots(localSnap, remoteSnap);
  await Promise.all([saveSnapshotTo(local, merged), saveSnapshotTo(remote, merged)]);
  return merged;
}
