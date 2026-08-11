/**
 * Contact + activity notification handlers (Harness §3.05: test the real handlers over an injected
 * sender). Covers the spam layers from the Harness contact-form learning: honeypot and min-fill-time
 * fake success (never tip the bot), length caps that REJECT with guidance (never truncate what gets
 * delivered), and the full body reaching the sender untouched.
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TYPES,
  handleActivityRequest,
  handleContactRequest,
  zActivityRequest,
  zContactRequest,
  type EmailMessage,
} from "../../src/server/notify";

function capturingSender(): { sent: EmailMessage[]; send: (msg: EmailMessage) => Promise<void> } {
  const sent: EmailMessage[] = [];
  return { sent, send: (msg) => { sent.push(msg); return Promise.resolve(); } };
}

const T0 = 1_700_000_000_000;

describe("contact handler — spam layers + delivery", () => {
  it("delivers a genuine enquiry in full, with Reply-To set", async () => {
    const { sent, send } = capturingSender();
    const message = "Hi! Love the app — could interval rotation support 6 minutes? ".repeat(40); // ~2400 chars
    const res = await handleContactRequest(
      { name: "Sam", email: "sam@example.com", message, startedAt: T0 - 60_000 },
      send,
      T0,
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("Sam");
    expect(sent[0]!.text).toContain(message.trim()); // FULL body delivered — never truncated
    expect(sent[0]!.replyTo).toBe("sam@example.com");
  });

  it("honeypot filled → fake success, nothing sent (don't tip the bot)", async () => {
    const { sent, send } = capturingSender();
    const res = await handleContactRequest(
      { message: "spammy spam spam spam", website: "https://spam.example", startedAt: T0 - 60_000 },
      send,
      T0,
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("submitted faster than a human could type → fake success, nothing sent", async () => {
    const { sent, send } = capturingSender();
    const res = await handleContactRequest({ message: "instant bot submission here", startedAt: T0 - 500 }, send, T0);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("too-short and too-long messages are REJECTED with guidance (not truncated)", async () => {
    const { sent, send } = capturingSender();
    const short = await handleContactRequest({ message: "hi", startedAt: T0 - 60_000 }, send, T0);
    expect(short.status).toBe(400);
    expect(String(short.body.error)).toContain("more detail");

    const long = await handleContactRequest({ message: "x".repeat(5_001), startedAt: T0 - 60_000 }, send, T0);
    expect(long.status).toBe(400);
    expect(String(long.body.error)).toContain("5,000");
    expect(sent).toHaveLength(0);
  });

  it("zod schema accepts optional fields and bounds the parse", () => {
    expect(zContactRequest.safeParse({ message: "hello there, quick question" }).success).toBe(true);
    expect(zContactRequest.safeParse({ message: 42 }).success).toBe(false);
  });
});

describe("activity handler — operator pings", () => {
  it("sends a labelled ping with the detail line", async () => {
    const { sent, send } = capturingSender();
    const res = await handleActivityRequest({ type: "team_created", detail: "Lakers · basketball · 8 players" }, send);
    expect(res.status).toBe(200);
    expect(sent[0]!.subject).toBe("NextOn · Team created");
    expect(sent[0]!.text).toBe("Lakers · basketball · 8 players");
  });

  it("rejects unknown activity types at the schema", () => {
    expect(zActivityRequest.safeParse({ type: "match_started" }).success).toBe(true);
    expect(zActivityRequest.safeParse({ type: "app_opened" }).success).toBe(false);
  });

  it("covers the whole coach journey, and every type has a readable label", async () => {
    // The journey the operator emails should narrate, in order.
    expect([...ACTIVITY_TYPES]).toEqual([
      "first_run",
      "sync_code_created",
      "sync_code_linked",
      "team_created",
      "team_deleted",
      "match_created",
      "match_started",
      "match_ended",
    ]);
    for (const type of ACTIVITY_TYPES) {
      const { sent, send } = capturingSender();
      const res = await handleActivityRequest({ type }, send);
      expect(res.status).toBe(200);
      const subject = sent[0]!.subject;
      expect(subject.startsWith("NextOn · ")).toBe(true);
      // A label, not the raw enum key leaking into the operator's inbox.
      expect(subject).not.toContain("_");
    }
  });
});
