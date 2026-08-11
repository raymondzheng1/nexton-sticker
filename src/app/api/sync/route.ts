/**
 * POST /api/sync — cross-device sync over a capability code (Harness §18). Validates input (Zod),
 * rate-limits per IP (fail-closed §6.4), then server-authoritatively merges the client snapshot into
 * the KV copy via {@link handleSyncRequest} and returns the merged result.
 *
 * Production requires Vercel KV / Upstash (env vars below); without them the route fails closed (503)
 * rather than silently accepting writes it can't persist. Local dev falls back to per-instance
 * in-memory stores so the app runs before KV is provisioned (Harness §4.4 dev-fallback).
 *
 * Required env (set in Vercel; see CLAUDE.md): KV_REST_API_URL, KV_REST_API_TOKEN
 * (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 */
import { InMemoryRateLimiter, UpstashRateLimiter, type RateLimiter } from "@/server/rateLimit";
import { UpstashKvStore, upstashFromEnv } from "@/store/adapters/upstashKvStore";
import { handleSyncRequest, zSyncRequest } from "@/store/cloud";
import { InMemoryKeyValueStore, type KeyValueStore } from "@/store/keyValueStore";

export const runtime = "nodejs";

const isProd = process.env.NODE_ENV === "production";
const SYNC_MAX_PER_MINUTE = 60;

// Per-instance dev fallbacks (ephemeral — fine for a single local dev session, never for prod).
const devKv = new InMemoryKeyValueStore();
const devLimiter = new InMemoryRateLimiter(SYNC_MAX_PER_MINUTE, 60_000);

function getKv(): KeyValueStore | null {
  const cfg = upstashFromEnv();
  if (cfg) return new UpstashKvStore(cfg);
  return isProd ? null : devKv;
}

function getLimiter(): RateLimiter | null {
  const cfg = upstashFromEnv();
  if (cfg) return new UpstashRateLimiter(cfg, SYNC_MAX_PER_MINUTE, 60);
  return isProd ? null : devLimiter;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const parsed = zSyncRequest.safeParse(body);
  if (!parsed.success) return json({ error: "invalid sync request" }, 400);

  const limiter = getLimiter();
  if (!limiter) return json({ error: "rate limiter unavailable" }, 503); // fail-closed
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await limiter.check(`sync:${ip}`);
  if (!rl.allowed) return json({ error: "rate limited" }, 429);

  const kv = getKv();
  if (!kv) return json({ error: "cloud store unavailable" }, 503); // fail-closed

  try {
    const merged = await handleSyncRequest(kv, parsed.data);
    return json(merged);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "sync failed" }, 400);
  }
}
