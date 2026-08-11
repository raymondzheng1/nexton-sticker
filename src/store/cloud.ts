/**
 * Cloud sync over a capability code (PRD §12.2; Harness §18). The SERVER owns the merge so a stale
 * or malicious client can never shrink history (anti-shrink, §18.2 #5): the client POSTs its current
 * snapshot, the server merges it into the KV copy, persists, and returns the merged result for the
 * client to adopt. The capability code is the credential and the KV scoping key.
 */
import { z } from "zod";
import { isValidCapabilityCode } from "./ids";
import type { KeyValueStore } from "./keyValueStore";
import { parseAppSnapshot, zAppSnapshot, type AppSnapshot } from "./schema";
import { loadSnapshotFrom, mergeSnapshots, saveSnapshotTo } from "./sync";

export const zSyncRequest = z.object({
  code: z.string(),
  /** The client's current snapshot to merge up (null = pull only, e.g. a fresh device). */
  snapshot: zAppSnapshot.nullable(),
});
export type SyncRequest = z.infer<typeof zSyncRequest>;

/**
 * Server-side sync handler (pure over an injected {@link KeyValueStore}, so it's unit-testable with
 * an in-memory KV — Harness §4.4). Validates the code, server-authoritatively merges, returns the
 * merged snapshot. Throws (→ 400 at the route) on an invalid code or an owner/code mismatch.
 */
export async function handleSyncRequest(kv: KeyValueStore, req: SyncRequest): Promise<AppSnapshot> {
  if (!isValidCapabilityCode(req.code)) {
    throw new Error("invalid capability code");
  }
  const server = await loadSnapshotFrom(kv, req.code);
  if (!req.snapshot) return server; // pull-only

  if (req.snapshot.ownerId !== req.code) {
    throw new Error("snapshot ownerId does not match the capability code");
  }
  const merged = mergeSnapshots(server, req.snapshot);
  await saveSnapshotTo(kv, merged);
  return merged;
}

/**
 * Client-side: push the local snapshot to the cloud and adopt the merged result. Used by the store's
 * debounced sync. Validates the response too (never trust the wire — Harness §7.1).
 */
export async function requestCloudSync(
  code: string,
  snapshot: AppSnapshot | null,
  fetchImpl: typeof fetch = fetch,
): Promise<AppSnapshot> {
  const res = await fetchImpl("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, snapshot }),
  });
  if (!res.ok) {
    throw new Error(`cloud sync failed: ${res.status}`);
  }
  return parseAppSnapshot(await res.json());
}
