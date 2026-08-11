/**
 * POST /api/activity — fire-and-forget key-usage pings to the operator (team created, match
 * started/ended). Zod-validated, rate-limited per IP (fail-closed §6.4). Carries a short human
 * detail line only — no player names, never the capability code. Clients treat this as best-effort
 * telemetry: they swallow failures so it can never break a coach's flow.
 */
import { InMemoryRateLimiter, UpstashRateLimiter, type RateLimiter } from "@/server/rateLimit";
import { handleActivityRequest, resendSenderFromEnv, zActivityRequest, type EmailSender } from "@/server/notify";
import { upstashFromEnv } from "@/store/adapters/upstashKvStore";

export const runtime = "nodejs";

const isProd = process.env.NODE_ENV === "production";
const ACTIVITY_MAX_PER_MINUTE = 30;

const devLimiter = new InMemoryRateLimiter(ACTIVITY_MAX_PER_MINUTE, 60_000);

function getLimiter(): RateLimiter | null {
  const cfg = upstashFromEnv();
  if (cfg) return new UpstashRateLimiter(cfg, ACTIVITY_MAX_PER_MINUTE, 60);
  return isProd ? null : devLimiter;
}

function getSender(): EmailSender | null {
  const sender = resendSenderFromEnv();
  if (sender) return sender;
  if (isProd) return null;
  return (msg) => {
    console.log(`[dev activity email] ${msg.subject} — ${msg.text}`);
    return Promise.resolve();
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const parsed = zActivityRequest.safeParse(body);
  if (!parsed.success) return json({ error: "invalid activity request" }, 400);

  const limiter = getLimiter();
  if (!limiter) return json({ error: "rate limiter unavailable" }, 503); // fail-closed
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await limiter.check(`activity:${ip}`);
  if (!rl.allowed) {
    // Log it: a 429 from OUR limiter and a 502 from a rejected Resend send both look like "email
    // stopped arriving" from the outside. Only the logs tell them apart.
    console.warn(`[activity] rate limited (${ACTIVITY_MAX_PER_MINUTE}/min per IP), dropped "${parsed.data.type}"`);
    return json({ error: "rate limited" }, 429);
  }

  const sender = getSender();
  if (!sender) return json({ error: "notifications not configured" }, 503);

  try {
    const result = await handleActivityRequest(parsed.data, sender);
    return json(result.body, result.status);
  } catch (err) {
    // LOG IT. The client swallows failures by design (telemetry must never break a coach's flow),
    // so this line is the only place a broken alerting path can announce itself — without it, a
    // rejected send is invisible from both ends and the operator just stops receiving email with no
    // way to find out why. The message carries Resend's status code (see resendSenderFromEnv).
    console.error(`[activity] send failed for "${parsed.data.type}":`, err instanceof Error ? err.message : err);
    return json({ error: "send failed" }, 502);
  }
}
