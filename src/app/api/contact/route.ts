/**
 * POST /api/contact — the public enquiry form. Zod-validated, rate-limited per IP (fail-closed
 * §6.4), spam-defended in layers inside {@link handleContactRequest} (honeypot, min-fill-time,
 * friendly length caps). Sends via Resend (RESEND_API_KEY); in production the route fails closed
 * (503) when unconfigured, in local dev it logs the email instead so the flow works before setup
 * (Harness §4.4 dev-fallback).
 */
import { InMemoryRateLimiter, UpstashRateLimiter, type RateLimiter } from "@/server/rateLimit";
import { handleContactRequest, resendSenderFromEnv, zContactRequest, type EmailSender } from "@/server/notify";
import { upstashFromEnv } from "@/store/adapters/upstashKvStore";

export const runtime = "nodejs";

const isProd = process.env.NODE_ENV === "production";
const CONTACT_MAX_PER_MINUTE = 5;

const devLimiter = new InMemoryRateLimiter(CONTACT_MAX_PER_MINUTE, 60_000);

function getLimiter(): RateLimiter | null {
  const cfg = upstashFromEnv();
  if (cfg) return new UpstashRateLimiter(cfg, CONTACT_MAX_PER_MINUTE, 60);
  return isProd ? null : devLimiter;
}

function getSender(): EmailSender | null {
  const sender = resendSenderFromEnv();
  if (sender) return sender;
  if (isProd) return null; // fail closed — never pretend an enquiry was delivered
  return (msg) => {
    console.log(`[dev contact email] ${msg.subject}\n${msg.text}`);
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

  const parsed = zContactRequest.safeParse(body);
  if (!parsed.success) return json({ error: "invalid contact request" }, 400);

  const limiter = getLimiter();
  if (!limiter) return json({ error: "rate limiter unavailable" }, 503); // fail-closed
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await limiter.check(`contact:${ip}`);
  if (!rl.allowed) {
    console.warn(`[contact] rate limited (${CONTACT_MAX_PER_MINUTE}/min per IP)`);
    return json({ error: "Too many messages — please try again in a minute." }, 429);
  }

  const sender = getSender();
  if (!sender) return json({ error: "contact is not configured yet — please email me directly" }, 503);

  try {
    const result = await handleContactRequest(parsed.data, sender);
    return json(result.body, result.status);
  } catch (err) {
    // Log the real reason (Resend's status code — see resendSenderFromEnv). The user gets a friendly
    // line; without this the operator would never learn that a genuine enquiry failed to arrive.
    console.error("[contact] send failed:", err instanceof Error ? err.message : err);
    return json({ error: "Sending failed — please try again, or email me directly." }, 502);
  }
}
