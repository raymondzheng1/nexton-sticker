"use client";
/**
 * The teams index — "your albums", the returning coach's front page.
 *
 * Each team is a large sticker card: the club's gradient face on top, its recent matches beneath as
 * dateline rows (a live one gets the red LIVE pill — the coach mid-match taps straight back in),
 * and the two live actions under a dotted rule. Wiring is the Back Page index's 1:1, plus the same
 * listMatches + matchRev re-fetch pattern its team page uses, so the fixture datelines are never
 * stale after the router restores this screen from its cache.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import { sportOf } from "@/features/sports";
import type { SavedMatch } from "@/store/schema";
import {
  HandNote,
  HardButtonLink,
  Kicker,
  Logo,
  MissingSlot,
  Pill,
  StickerFrame,
  cx,
  faceOf,
  styles,
  tilt,
} from "@/ui";
import { dateline, statusWord } from "./presenters";
import css from "./teams.module.css";

const SHARE_TEXT =
  "NextOn — fair playing time for every player. Free, no accounts, works offline at the pitch.";

/** How many dateline rows a card shows before deferring to the team page. */
const RECENT_MATCHES = 3;

export function TeamsIndex() {
  const ready = useAppStore((s) => s.ready);
  const teams = useAppStore((s) => s.teams);
  const listMatches = useAppStore((s) => s.listMatches);
  const matchRev = useAppStore((s) => s.matchRev);
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [shareNote, setShareNote] = useState("");

  useEffect(() => {
    if (ready) void listMatches().then(setMatches);
  }, [ready, listMatches, matchRev]);

  /** Native share sheet on a phone, clipboard on a desktop, a visible link if both are blocked. */
  async function share(): Promise<void> {
    // /welcome is the permanent marketing page: a recipient must land on the pitch, not on
    // whatever "/" resolves to for THEM. Matches the original's useShareApp and this app's
    // own settings-page share, from which this copy had drifted (2026-08-12 audit).
    const url = `${window.location.origin}/welcome`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "NextOn", text: SHARE_TEXT, url });
        return;
      } catch (e) {
        // Closing the share sheet is a choice, not an error; anything else falls back to copy.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied — paste it to another coach.");
    } catch {
      setShareNote(`Copy this link: ${url}`);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo href="/" />
        <HandNote size={20} rotate={2}>
          season 2026 ✦
        </HandNote>
      </header>

      <div className={styles.gutter}>
        {!ready ? (
          <p className={styles.empty}>Opening the album…</p>
        ) : teams.length === 0 ? (
          <>
            <h1 className={css.hed}>No albums yet.</h1>
            <p className={styles.body}>
              Name a squad and NextOn does the rest — minutes tracked live, subs suggested, nobody
              goes home short.
            </p>
            <div style={{ marginTop: 18 }}>
              <MissingSlot name="Your team" note="not stuck in yet!" minHeight={120} />
            </div>
            <div className={css.foot}>
              <HardButtonLink href="/onboarding" variant="green">
                Create your team →
              </HardButtonLink>
              <p className={css.footNote}>Saved on this phone · no account</p>
            </div>
          </>
        ) : (
          <>
            <Kicker>Your albums</Kicker>
            {teams.map((team) => {
              const cfg = sportOf(team.sport);
              const face = faceOf(team.id);
              const recent = matches
                .filter((m) => m.teamId === team.id)
                .slice()
                .reverse(); // newest first, as a results column reads
              const shown = recent.slice(0, RECENT_MATCHES);
              const overflow = recent.length - shown.length;
              return (
                <StickerFrame key={team.id} tiltDeg={tilt(team.id, 1.5)} className={css.teamCard}>
                  <Link
                    href={`/teams/${team.id}`}
                    className={css.teamFace}
                    style={{ ["--face-a" as string]: face.a, ["--face-b" as string]: face.b }}
                  >
                    <span className={css.teamArt} aria-hidden>
                      {cfg.scoreIcon}
                    </span>
                    <span className={css.teamName}>{team.name}</span>
                  </Link>
                  <div className={css.teamBody}>
                    <p className={css.teamMeta}>
                      {team.ageGroup ? `${team.ageGroup} · ` : ""}
                      {cfg.label} · {team.defaultOnFieldCount}
                      {cfg.formatSuffix} · {team.roster.length}{" "}
                      {team.roster.length === 1 ? "player" : "players"}
                    </p>
                    {shown.length > 0 && (
                      <div className={css.mList}>
                        {shown.map((m) => (
                          <div key={m.id} className={css.mItem}>
                            <Link
                              href={
                                m.status === "completed"
                                  ? `/teams/${team.id}/match/${m.id}/review`
                                  : `/teams/${team.id}/match/${m.id}`
                              }
                              className={css.mLink}
                            >
                              <span className={css.mWhen}>
                                {dateline(m.startedAtISO ?? m.createdAt)}
                              </span>
                              <span className={css.mName}>{m.name}</span>
                              {m.status === "live" ? (
                                <Pill tone="red" dot>
                                  Live
                                </Pill>
                              ) : (
                                <span
                                  className={cx(
                                    css.mState,
                                    m.status === "completed" ? css.mDone : css.mSetup,
                                  )}
                                >
                                  {statusWord(m.status, cfg)}
                                </span>
                              )}
                            </Link>
                          </div>
                        ))}
                        {overflow > 0 && (
                          <Link href={`/teams/${team.id}`} className={css.mMore}>
                            ＋ {overflow} more in the album →
                          </Link>
                        )}
                      </div>
                    )}
                    <div className={css.cardActions}>
                      <HardButtonLink href={`/teams/${team.id}/new`} variant="red" size="md">
                        Start a match ▶
                      </HardButtonLink>
                      <HardButtonLink href={`/teams/${team.id}/season`} variant="outline" size="md">
                        Season
                      </HardButtonLink>
                    </div>
                  </div>
                </StickerFrame>
              );
            })}

            <div className={css.foot}>
              <HardButtonLink href="/onboarding" variant="outline">
                ＋ Add another team
              </HardButtonLink>
            </div>

            <p className={css.deadline}>
              <button type="button" className={css.linkBtn} onClick={() => void share()}>
                Share NextOn
              </button>
              {" · "}
              <Link href="/settings">Settings</Link>
              {" · "}
              <Link href="/contact">Contact</Link>
            </p>
            {shareNote ? (
              <p className={css.footNote} role="status">
                {shareNote}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
