/**
 * Operator email notifications via Resend (Harness §16.2 — one shared send helper; Tier B optional
 * Resend). Two consumers:
 *  - /api/contact — the public enquiry form. Public forms are spam magnets (Harness §"contact form"
 *    learning): defended in cheap layers — honeypot field, minimum-fill-time, friendly length caps
 *    that REJECT with guidance (never silently truncate the delivered email) — plus per-IP rate
 *    limiting at the route.
 *  - /api/activity — fire-and-forget key-usage pings across the coach's journey (see ACTIVITY_TYPES).
 *    Contains no player names and never the capability code (it's a bearer credential).
 *
 * Handlers are pure over an injected {@link EmailSender} (Harness §3.05 Tier-B testing: the real
 * boundary is handler ↔ dependency), so tests exercise the real logic with a capturing fake.
 */
import { z } from "zod";

export interface EmailMessage {
  subject: string;
  text: string;
  /** Reply-To — lets a direct email reply reach the enquirer. */
  replyTo?: string;
}

export type EmailSender = (msg: EmailMessage) => Promise<void>;

/**
 * Resend-backed sender from env, or null when unconfigured (routes fail closed in prod, log in dev).
 * RESEND_API_KEY is required; CONTACT_TO_EMAIL / RESEND_FROM are optional overrides.
 *
 * ⚠️ THE DEFAULT FROM-ADDRESS IS NOT PRODUCTION-SAFE. `onboarding@resend.dev` is Resend's shared
 * TEST sender: their own quickstart says not to ship with it, and it will only deliver to the email
 * address on the Resend account. Set RESEND_FROM to an address on a domain you have verified in
 * Resend before relying on any of this. The fallback exists so the flow works locally before setup —
 * it is a dev convenience, not a deployment.
 *
 * An earlier version of this comment stated the account-owner restriction as settled fact and said
 * "no domain setup needed". That claim was written by us, never verified against Resend, and was
 * later cited back as if it were evidence while debugging a real outage. It is left described here
 * only as what Resend documents, not as what we have confirmed about this account.
 */
export function resendSenderFromEnv(fetchImpl: typeof fetch = fetch): EmailSender | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const from = process.env.RESEND_FROM;
  // Key-only (no RESEND_FROM) is a WORKING production config here, not a half-configured one:
  // the sandbox sender delivers to the Resend ACCOUNT OWNER's address, and the owner is every
  // recipient this system has (contact enquiries + activity pings both go to the operator). A
  // 2026-08-12 change made this branch fail closed in production and thereby broke the original
  // app's live contact form, which had run for weeks on exactly this config. The real outage that
  // motivated it was different: the sibling apps had RESEND_FROM set to UNVERIFIED domains, which
  // Resend 403s — that is caught below by surfacing Resend's response body, not by refusing the
  // key-only setup. If this product ever emails anyone besides the operator, RESEND_FROM on a
  // verified domain becomes mandatory; until then, don't "protect" a config that demonstrably works.
  const to = process.env.CONTACT_TO_EMAIL ?? "raymond.zheng@gmail.com";
  return async (msg) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from ?? "NextOn <onboarding@resend.dev>",
        to: [to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : null),
      }),
    });
    if (!res.ok) {
      // Resend's body names the actual problem ("domain is not verified", key errors, …). A bare
      // status code sent a real outage down a multi-day guessing game once; never discard it.
      const detail = await res.text().catch(() => "");
      throw new Error(`resend send failed: ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
    }
  };
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Contact form ─────────────────────────────────────────────────────────────

export const zContactRequest = z.object({
  name: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  message: z.string().max(20_000), // hard parse bound; the friendly cap below is what users see
  /** Honeypot — a visually hidden field real users never fill. */
  website: z.string().optional(),
  /** When the form was opened (ms epoch) — humans take longer than a bot's instant submit. */
  startedAt: z.number().optional(),
});
export type ContactRequest = z.infer<typeof zContactRequest>;

const MIN_FILL_MS = 3_000;
const MAX_MESSAGE_CHARS = 5_000;

export async function handleContactRequest(
  data: ContactRequest,
  send: EmailSender,
  nowMs: number = Date.now(),
): Promise<HandlerResult> {
  // Spam layers return a FAKE success — never tip the bot off that it was caught.
  if (data.website && data.website.trim() !== "") return { status: 200, body: { ok: true } };
  if (data.startedAt !== undefined && nowMs - data.startedAt < MIN_FILL_MS) {
    return { status: 200, body: { ok: true } };
  }

  const message = data.message.trim();
  if (message.length < 10) {
    return { status: 400, body: { error: "Please add a little more detail so I can help (at least 10 characters)." } };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    // Reject with guidance — never silently truncate what gets delivered.
    return {
      status: 400,
      body: { error: `Please keep your message under ${MAX_MESSAGE_CHARS.toLocaleString()} characters — email me directly if you need more room.` },
    };
  }

  const name = data.name?.trim();
  const email = data.email?.trim();
  await send({
    subject: `NextOn enquiry${name ? ` from ${name}` : ""}`,
    text: `${message}\n\n— ${name || "(no name given)"}${email ? ` · ${email}` : " · (no reply email given)"}`,
    replyTo: email || undefined,
  });
  return { status: 200, body: { ok: true } };
}

// ── Key-activity pings ───────────────────────────────────────────────────────

/**
 * The coach's journey, in order: first run → identity (sync code) → team → match set up → kicked
 * off → finished, plus the churn signal (team deleted). NextOn has no accounts, so "sync code
 * created" is the nearest equivalent of a sign-up — the code itself is a bearer credential and is
 * NEVER included in the ping.
 */
export const ACTIVITY_TYPES = [
  "first_run",
  "sync_code_created",
  "sync_code_linked",
  "team_created",
  "team_deleted",
  "match_created",
  "match_started",
  "match_ended",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const zActivityRequest = z.object({
  type: z.enum(ACTIVITY_TYPES),
  /** Short human line, e.g. "Lakers · basketball · 8 players". No player names, never the code. */
  detail: z.string().max(300).optional(),
});
export type ActivityRequest = z.infer<typeof zActivityRequest>;

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  first_run: "New user — first run",
  sync_code_created: "Sync code created",
  sync_code_linked: "Device linked with a sync code",
  team_created: "Team created",
  team_deleted: "Team deleted",
  match_created: "Match set up",
  match_started: "Match started",
  match_ended: "Match ended",
};

export async function handleActivityRequest(data: ActivityRequest, send: EmailSender): Promise<HandlerResult> {
  await send({
    subject: `NextOn · ${ACTIVITY_LABELS[data.type]}`,
    text: data.detail?.trim() || "(no detail)",
  });
  return { status: 200, body: { ok: true } };
}
