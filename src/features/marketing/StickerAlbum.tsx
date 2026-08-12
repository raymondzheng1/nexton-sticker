"use client";
/**
 * The Sticker Album — the marketing page.
 *
 * Cream paper, white-bordered stickers lying at a slight rotation, handwriting in the margins, one
 * foil frame for the rare card — and the signature device: the player who needs minutes is a
 * MISSING sticker, a dashed red gap in the album. The conceit is load-bearing: an album is a
 * collection you complete, which is exactly what fair minutes are.
 *
 * Everything on this page is honest. The squad, the countdown and the swapsies note are a worked
 * example with neutral first names; there are no testimonials or user counts, invented or
 * otherwise. The one flourish — Ava's sticker filling the gap when it scrolls into view — plays
 * once, and never for a reader who asked for reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import {
  FoilCard,
  HandNote,
  HardButtonLink,
  Logo,
  MissingSlot,
  PlayerSticker,
  ProgressTrack,
  cx,
  styles as ui,
} from "@/ui";
import album from "./stickerAlbum.module.css";

/**
 * The specimen squad. The ids are chosen so faceOf() deals each player the gradient the design
 * drew (Sam green, Maya blue, Leo yellow, Noah purple, Kit teal — Ava takes pink when she fills
 * in); the tilts are the mockup's exact rotations. Footers are the mockup's, verbatim — minutes,
 * then glyph (plus the word for anything that isn't on target).
 */
const SQUAD = [
  { id: "sam2", name: "Sam", gk: true, tilt: -2, foot: "18′ ✓", title: "On target" },
  { id: "maya-demo", name: "Maya", gk: false, tilt: 1.5, foot: "16′ ✓", title: "On target" },
  { id: "leo3", name: "Leo", gk: false, tilt: -1, foot: "21′ ▼ rest", title: "Give a rest" },
  { id: "noah6", name: "Noah", gk: false, tilt: 2, foot: "12′ ✓", title: "On target" },
  { id: "kit7", name: "Kit", gk: false, tilt: 1, foot: "17′ ✓", title: "On target" },
] as const;

export function StickerAlbum() {
  const teams = useAppStore((s) => s.teams);
  const hasTeams = teams.length > 0;

  /* Once-only delight: when the dashed Ava slot scrolls into view, her sticker fills the gap —
     300ms, no loop, and never armed at all under prefers-reduced-motion. */
  const [filled, setFilled] = useState(false);
  const avaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = avaRef.current;
    if (!el) return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          // A beat's pause, so the reader registers the gap before the app fills it.
          timer = window.setTimeout(() => setFilled(true), 900);
        }
      },
      { threshold: 0.7 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className={album.paper}>
      {/* ── 1 · header ── */}
      <header className={album.header}>
        <Logo />
        {hasTeams ? (
          <Link href="/teams" className={album.headerLink}>
            Open the app →
          </Link>
        ) : (
          <HandNote size={20} rotate={2}>
            season 2026 ✦
          </HandNote>
        )}
      </header>

      {/* ── 2 · hero ── */}
      <section className={album.hero}>
        <div className={album.kicker}>The squad album</div>
        <h1 className={album.hed}>
          Got it. Got it. <span className={album.hedRed}>Needs minutes.</span>
        </h1>
        <p className={album.sub}>
          A full album means every kid played their share. NextOn keeps the count live and tells you
          who&apos;s next on.
        </p>
        <HardButtonLink href="/onboarding" variant="green" style={{ marginTop: 20 }}>
          Create your team — it&apos;s free
        </HardButtonLink>
        <div className={album.trustRow}>
          <span>No account</span>
          <span className={album.trustDot} aria-hidden>
            ·
          </span>
          <span>Works offline</span>
          <span className={album.trustDot} aria-hidden>
            ·
          </span>
          <span>Free</span>
        </div>
      </section>

      {/* ── 3 · the sticker grid, with Ava as the missing sixth ── */}
      <section className={album.gridWrap} aria-label="A specimen page of the squad album">
        <div className={album.grid}>
          {SQUAD.slice(0, 4).map((p) => (
            <PlayerSticker
              key={p.id}
              playerId={p.id}
              name={p.name}
              gk={p.gk}
              tiltDeg={p.tilt}
              footer={<span title={p.title}>{p.foot}</span>}
            />
          ))}
          <div ref={avaRef} className={album.fillStack}>
            <MissingSlot
              className={cx(filled && album.fillGone)}
              name="Ava"
              tiltDeg={-1.5}
              note={
                <>
                  needs minutes!
                  <br />▲ on next
                </>
              }
            />
            {filled && (
              <div className={album.fillIn}>
                <PlayerSticker
                  playerId="ava-e"
                  name="Ava"
                  tiltDeg={-1.5}
                  footer={<span title="On target">24′ ✓</span>}
                />
              </div>
            )}
          </div>
          {SQUAD.slice(4).map((p) => (
            <PlayerSticker
              key={p.id}
              playerId={p.id}
              name={p.name}
              gk={p.gk}
              tiltDeg={p.tilt}
              footer={<span title={p.title}>{p.foot}</span>}
            />
          ))}
        </div>
        <p className={album.gridCaption}>
          <HandNote size={21} rotate={-1}>
            the app fills the gaps before full time ↑
          </HandNote>
        </p>
      </section>

      {/* ── 4 · the foil rare: the suggestion card (a still life — nothing here is live) ── */}
      <section className={album.foilWrap}>
        <FoilCard badge="★ Shiny — rare">
          <div className={album.suggestHead}>
            <span>⇄ Next suggested change</span>
            <span className={album.countdown}>3:50</span>
          </div>
          <div className={album.progressRow}>
            <ProgressTrack pct={72} />
          </div>
          <div className={album.swapRow}>
            <span className={album.swapOff}>Leo ▼ off</span>
            <span className={album.swapArrow} aria-hidden>
              →
            </span>
            <span className={album.swapOn}>Ava ▲ on</span>
            <span className={album.swapPos}>left mid</span>
          </div>
          {/* Decorative print of the live controls — spans, not buttons, so nothing pretends to work. */}
          <div className={album.swapActions} aria-hidden>
            <span className={cx(ui.hardBtn, ui.hardGreen, ui.hardMd, album.swapConfirm)}>Confirm sub</span>
            <span className={cx(ui.hardBtn, ui.hardOutline, ui.hardMd, ui.hardAuto)}>⏱ Snooze</span>
          </div>
        </FoilCard>
        <p className={album.suggestCaption}>
          <strong>It suggests, you decide</strong> — nothing happens until you tap.
        </p>
      </section>

      {/* ── 5 · steps 1-2-3 ── */}
      <section className={album.steps}>
        <div className={album.step}>
          <span className={cx(album.stepBadge, album.stepRed)} aria-hidden>
            1
          </span>
          <span className={album.stepText}>
            <strong>Stick your squad in once</strong>{" "}
            <span className={album.stepMuted}>— first names only.</span>
          </span>
        </div>
        <div className={album.step}>
          <span className={cx(album.stepBadge, album.stepYellow)} aria-hidden>
            2
          </span>
          <span className={album.stepText}>
            <strong>Kick off</strong>{" "}
            <span className={album.stepMuted}>— the sub plan&apos;s ready before the whistle.</span>
          </span>
        </div>
        <div className={album.step}>
          <span className={cx(album.stepBadge, album.stepGreen)} aria-hidden>
            3
          </span>
          <span className={album.stepText}>
            <strong>Tap to confirm subs</strong>{" "}
            <span className={album.stepMuted}>— album complete at full time.</span>
          </span>
        </div>
      </section>

      {/* ── 6 · the swapsies note ── */}
      <section className={album.receiptCard}>
        <div className={album.receiptTitle}>swapsies note for the parents&apos; chat:</div>
        <div className={album.receipt}>
          Riverside Lions · 12/04
          <br />
          Ava 24′ · Sam 23′ · Leo 23′
          <br />
          ⚽ Sam ×2, Ava · spread 2′
          <br />
          <span className={album.receiptVia}>— via NextOn</span>
        </div>
      </section>

      {/* ── 7 · offline card ── */}
      <section className={album.offline}>
        <div className={album.offlineHead}>No wifi at the pitch? Perfect.</div>
        {/* No "Privacy →" link here: there is no privacy PAGE, and a link promising one reads as
            broken (owner report, 2026-08-12). The honest privacy note prints in the footer below. */}
        <p className={album.offlineBody}>
          Works fully offline. No accounts, no ads — your squad stays on your phone.
        </p>
      </section>

      {/* ── 8 · footer CTA ── */}
      <footer className={album.footer}>
        <HardButtonLink href="/onboarding" variant="red">
          Create your team
        </HardButtonLink>
        <div className={album.signOff}>
          <HandNote size={22}>free · no accounts · works offline</HandNote>
        </div>
        <p className={album.contactLine}>
          Questions or ideas?{" "}
          <Link href="/contact">Contact the developer →</Link>
        </p>
        <p className={album.privacyNote}>
          <strong>Privacy:</strong> NextOn stores first names only — no surnames, no photos, no ads.
          Your squad lives in your phone&apos;s own storage and works without a network; a private
          team code syncs your own devices when you want it to, and you can export or delete
          everything at any time.
        </p>
      </footer>
    </main>
  );
}
