/**
 * Server-side cloud KV adapter — Vercel KV / Upstash Redis over its REST API (no SDK dependency,
 * just fetch). The token is server-only and never reaches the client (Harness §2.4). Thin IO glue:
 * the sync MERGE logic it serves is unit-tested in cloud.ts against an in-memory store.
 */
import type { KeyValueStore } from "../keyValueStore";

export interface UpstashConfig {
  url: string;
  token: string;
}

/** Read Upstash/Vercel-KV REST credentials from the environment; null when unconfigured. */
export function upstashFromEnv(): UpstashConfig | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Run a single Redis command via the Upstash REST endpoint; returns the `result` field. */
export async function upstashCommand(config: UpstashConfig, args: (string | number)[]): Promise<unknown> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Upstash command failed: ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`Upstash error: ${json.error}`);
  return json.result ?? null;
}

export class UpstashKvStore implements KeyValueStore {
  constructor(private readonly config: UpstashConfig) {}

  async get(key: string): Promise<string | null> {
    const result = await upstashCommand(this.config, ["GET", key]);
    return typeof result === "string" ? result : null;
  }

  async set(key: string, value: string): Promise<void> {
    await upstashCommand(this.config, ["SET", key, value]);
  }

  async del(key: string): Promise<void> {
    await upstashCommand(this.config, ["DEL", key]);
  }
}
