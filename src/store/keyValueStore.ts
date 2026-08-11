/**
 * The narrow storage seam every Repository reads/writes through (Harness §4.4). Both the local
 * layer (IndexedDB, in the browser) and the cloud layer (Upstash KV, via API routes) implement
 * this same interface; tests inject {@link InMemoryKeyValueStore}. Concrete browser/cloud adapters
 * land in Phase 3 with the app shell, where the runtime + DOM types exist.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** In-memory store for tests and the dev/no-store fallback. */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  /** Test helper: snapshot of all keys (not part of the interface). */
  keys(): string[] {
    return [...this.map.keys()];
  }
}
