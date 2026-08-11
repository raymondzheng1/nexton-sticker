/**
 * NextOn store layer — public API (Phase 2). Persistence + cross-device sync behind one
 * `Repository` seam. Composes the pure engine with sync/record metadata; identity-aware but the
 * engine stays identity-agnostic (PRD §12.2). Storage-agnostic: any `KeyValueStore` backs it
 * (in-memory for tests; IndexedDB + Upstash KV adapters arrive with the app shell in Phase 3).
 */

// Records + schemas (IO validation)
export type { AppSnapshot, MatchStatus, RecordMeta, SavedMatch, Team } from "./schema";
export {
  emptySnapshot,
  parseAppSnapshot,
  zAppSnapshot,
  zMatch,
  zMatchEvent,
  zPlayer,
  zSavedMatch,
  zTeam,
} from "./schema";

// Seams (deterministic in tests)
export { now, __setNowForTests } from "./clock";
export {
  CODE_ALPHABET,
  generateCapabilityCode,
  isValidCapabilityCode,
  newId,
  normalizeCapabilityCode,
  __setIdGeneratorForTests,
} from "./ids";
export { getOwnerId, resetOwnerId, setOwnerId } from "./identity";

// Storage + repository
export { InMemoryKeyValueStore, type KeyValueStore } from "./keyValueStore";
export {
  SnapshotRepository,
  snapshotKey,
  type CreateMatchInput,
  type MatchPatch,
  type Repository,
  type TeamInput,
} from "./repository";

// Sync
export {
  loadSnapshotFrom,
  mergeEvents,
  mergeSnapshots,
  saveSnapshotTo,
  syncNow,
} from "./sync";

// Export / import
export { exportSnapshotJson, importSnapshotJson, withOwner } from "./exportImport";

// Season insights (computed on read)
export { seasonReport, carryForwardSeeds, type PlayerSeasonRow } from "./season";
