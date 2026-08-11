"use client";
/** Shared client-side Repository singleton (IndexedDB-backed) used by both the app store and the
 * live-match store, so they observe the same cached snapshot. */
import { IndexedDbKeyValueStore } from "./adapters/indexedDbKeyValueStore";
import type { KeyValueStore } from "./keyValueStore";
import { SnapshotRepository, type Repository } from "./repository";

let localKvs: KeyValueStore | null = null;
let repo: Repository | null = null;

export function getLocalKvs(): KeyValueStore {
  localKvs ??= new IndexedDbKeyValueStore();
  return localKvs;
}

export function getRepo(): Repository {
  repo ??= new SnapshotRepository(getLocalKvs());
  return repo;
}
