"use client";
/**
 * Send a note — the enquiry form, as a sticker card.
 *
 * Posts to /api/contact → Resend. The spam defences live server-side (honeypot, minimum fill time,
 * length caps); this page supplies the two things only the browser knows: the honeypot field and
 * the moment the form was opened. Name and email are optional — the email only matters if a reply
 * is wanted, and asking for one to file a complaint would be its own kind of rudeness.
 */
import { useRef, useState } from "react";
import { HandNote, HardButton, HardButtonLink, Logo, styles as ui, tilt } from "@/ui";
import form from "./contact.module.css";

type SendState = "idle" | "sending" | "sent" | "error";

/** The card's lean — deterministic, like every rotation in the album. */
const CARD_TILT = tilt("contact-card", 1);

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — visually hidden, humans never fill it
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState("");
  const openedAt = useRef(Date.now());

  async function send(): Promise<void> {
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          message,
          website,
          startedAt: openedAt.current,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Sending failed — please try again.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setState("error");
    }
  }

  return (
    <main className={ui.page}>
      <header className={ui.header}>
        <Logo href="/" />
        <HandNote size={20} rotate={2}>
          every note is read ✦
        </HandNote>
      </header>

      <div className={ui.gutter}>
        {state === "sent" ? (
          <>
            <h1 className={form.hed}>
              Stuck in.
              <br />
              <span className={form.hedRed}>Thank you.</span>
            </h1>
            <p className={form.standfirst}>
              Thanks for writing in{name.trim() ? `, ${name.trim()}` : ""}.
              {email.trim()
                ? " I'll reply to your email."
                : " Add an email next time if you'd like a reply."}
            </p>
            <HardButtonLink href="/" variant="green" style={{ marginTop: 18 }}>
              Back to the album
            </HardButtonLink>
          </>
        ) : (
          <>
            <h1 className={form.hed}>
              Send a note.
              <br />
              <span className={form.hedRed}>Every one is read.</span>
            </h1>
            <p className={form.standfirst}>
              Questions, ideas, or something not working? It goes straight to the developer — no
              account, no ticket number.
            </p>

            <div className={form.card} style={{ ["--tilt" as string]: `${CARD_TILT}deg` }}>
              <label>
                <span className={ui.label}>Your name (optional)</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  style={{ marginTop: 6 }}
                />
              </label>

              <label>
                <span className={ui.label}>Your email (only if you want a reply)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  style={{ marginTop: 6 }}
                />
              </label>

              <label>
                <span className={ui.label}>Message</span>
                <textarea
                  rows={6}
                  maxLength={6000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  style={{ marginTop: 6, minHeight: 130, padding: "10px 12px", resize: "vertical" }}
                />
              </label>
            </div>

            {/* Honeypot — off-screen for humans, irresistible to bots. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
            />

            {error && (
              <div className={form.error} role="alert">
                {error}
              </div>
            )}

            <HardButton
              variant="green"
              onClick={() => void send()}
              disabled={state === "sending" || message.trim().length === 0}
              style={{ marginTop: 18 }}
            >
              {state === "sending" ? "Sending…" : "Send the note"}
            </HardButton>
            <p className={ui.note} style={{ textAlign: "center", marginTop: 10 }}>
              No account needed. Your message goes to the developer and nowhere else.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
