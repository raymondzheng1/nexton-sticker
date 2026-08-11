/**
 * Portable JSON export/import of ALL local data (Harness §2.3). This is both the v1 user backup and
 * the seam that later uploads a user's data into a multi-user backend (PRD §12.2). Import validates
 * with Zod and refuses an unreadable future schema version — loud, never silent (Harness §7.1).
 */
import { parseAppSnapshot, type AppSnapshot } from "./schema";

/** Serialise the whole snapshot to pretty JSON (the downloadable backup file). */
export function exportSnapshotJson(snapshot: AppSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** Parse + validate a backup file back into a snapshot (throws on malformed / too-new data). */
export function importSnapshotJson(json: string): AppSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (cause) {
    throw new Error("import failed: not valid JSON", { cause });
  }
  return parseAppSnapshot(data);
}

/**
 * Re-stamp a snapshot (and every record in it) with a new owner id — used when claiming data created
 * offline under the local owner into a capability code, or when importing someone else's export into
 * your own identity. Returns a NEW snapshot (does not mutate the input).
 */
export function withOwner(snapshot: AppSnapshot, ownerId: string): AppSnapshot {
  return {
    ...snapshot,
    ownerId,
    teams: snapshot.teams.map((t) => ({ ...t, ownerId })),
    matches: snapshot.matches.map((m) => ({ ...m, ownerId })),
  };
}
