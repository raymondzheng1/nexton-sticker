/**
 * Client-side local working store — IndexedDB (offline-first; the touchline has no signal). Thin IO
 * glue behind the {@link KeyValueStore} contract (which is tested via the in-memory store). Stores
 * one snapshot blob per owner key. Client-only: throws loudly if used where IndexedDB is absent
 * (e.g. the server) rather than silently no-op'ing (Harness §7.1).
 */
import type { KeyValueStore } from "../keyValueStore";

const DB_NAME = "nexton";
const STORE_NAME = "kv";
const DB_VERSION = 1;

function getIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this environment (client-only store)");
  }
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = getIndexedDb().open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const req = run(tx.objectStore(STORE_NAME));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export class IndexedDbKeyValueStore implements KeyValueStore {
  async get(key: string): Promise<string | null> {
    const value = await withStore<unknown>("readonly", (s) => s.get(key));
    return typeof value === "string" ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await withStore("readwrite", (s) => s.put(value, key));
  }

  async del(key: string): Promise<void> {
    await withStore("readwrite", (s) => s.delete(key));
  }
}
