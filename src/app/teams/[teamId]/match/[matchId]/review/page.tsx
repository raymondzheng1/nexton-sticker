"use client";
/**
 * Full time — the FINISHED PAGE of the album.
 *
 * The proof a coach hands the parents' chat: who played, for how long, who scored, and whether it
 * came out fair. Everything here is computed on read from the append-only event log, so it is the
 * record of what happened rather than the plan it was built on.
 *
 * The share text renders as THE SWAPSIES NOTE — the handwritten-titled monospace receipt from the
 * marketing page — and its content is exactly the proven share text, because the note the parents
 * read and the numbers on this screen must never disagree.
 *
 * The headline tells the truth. "Album complete." is only printed when everyone actually played and
 * the squad landed inside the fairness band; otherwise the page says what really happened. An album
 * that flatters the collector is worth nothing to the parents reading it.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fairnessReport, rebuildLiveState } from "@/engine";
import { getRepo } from "@/store/clientRepo";
import type { SavedMatch } from "@/store/schema";
import {
  buildMatchFeed,
  countActualSubs,
  feedLineText,
  statusFor,
  statusTolFor,
  wallClockLabel,
  type FeedLabels,
} from "@/features/live";
import { slotShortName, sportOf } from "@/features/sports";
import {
  HandNote,
  HardButton,
  HardButtonLink,
  Kicker,
  Logo,
  Pill,
  StatusChip,
  Toast,
  clockTime,
  cx,
  styles,
  tilt,
} from "@/ui";
import ar from "@/features/live/albumReport.module.css";
import la from "@/features/live/liveAlbum.module.css";

const SEC_PER_MIN = 60;
/** PLAYER · MIN · ⚽ · FAIR — the box-score column widths, shared by the head and every row. */
const BOX_COLUMNS = "1fr 52px 44px 40px";

function minutes(seconds: number): number {
  return Math.round(seconds / SEC_PER_MIN);
}

export default function ReviewPage() {
  const params = useParams<{ teamId: string; matchId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const matchId = typeof params.matchId === "string" ? params.matchId : "";

  const [match, setMatch] = useState<SavedMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getRepo()
      .getMatch(matchId)
      .then((m) => {
        if (!alive) return;
        setMatch(m);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [matchId]);

  const cfg = sportOf(match?.config.sport);
  const isBasketball = cfg.id === "basketball";

  const view = useMemo(() => {
    if (!match) return null;
    const basketball = (match.config.sport ?? "football") === "basketball";
    const finalState = rebuildLiveState(match.config, match.players, match.events);
    const report = fairnessReport(match.config, match.players, finalState);
    const startEvent = match.events.find((e) => e.type === "MATCH_STARTED");
    const starterIds = new Set(
      startEvent && startEvent.type === "MATCH_STARTED"
        ? startEvent.lineup.map((a) => a.playerId)
        : [],
    );
    const rowBy = new Map(report.rows.map((r) => [r.playerId, r]));
    const nameOf = new Map(match.players.map((p) => [p.id, p.name]));

    const lines = match.players
      .map((p) => {
        const ls = finalState.players[p.id];
        const r = rowBy.get(p.id);
        return {
          playerId: p.id,
          name: nameOf.get(p.id) ?? p.id,
          playedSeconds: ls?.secondsOnField ?? r?.playedSeconds ?? 0,
          targetSeconds: r?.targetSeconds ?? 0,
          debtSeconds: r?.debtSeconds ?? 0,
          started: starterIds.has(p.id),
          gkSeconds: ls?.secondsAsGk ?? 0,
          // Football shows goals, basketball shows points — a three-pointer counts as 3.
          goals: basketball ? (ls?.points ?? 0) : (ls?.goals ?? 0),
        };
      })
      .sort(
        (a, b) =>
          b.playedSeconds - a.playedSeconds ||
          (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
      );

    const scorers = lines
      .filter((l) => l.goals > 0)
      .sort((a, b) => b.goals - a.goals || (a.name < b.name ? -1 : 1));
    const totalGoals = scorers.reduce((s, l) => s + l.goals, 0);
    // The match log — every substitution, score and period change, as it actually happened.
    const feed = buildMatchFeed(match.events);
    return { lines, report, scorers, totalGoals, feed, subsMade: countActualSubs(feed) };
  }, [match]);

  /** The note's body — everything except the "via" sign-off, which the receipt inks in tan. */
  function receiptBody(): string {
    if (!match || !view) return "";
    const header = `${match.name}`;
    const body = view.lines.map((l) => `${l.name}: ${minutes(l.playedSeconds)}′`).join("\n");
    const spread = minutes(view.report.spreadSeconds);
    const maxOff = minutes(view.report.maxAbsDebtSeconds);
    const scorers = view.scorers.length
      ? `\n\n${cfg.scoreIcon} ${cfg.scorersLabel} (${view.totalGoals}): ${view.scorers
          .map((l) => `${l.name}${l.goals > 1 ? ` ${isBasketball ? `${l.goals}pts` : `×${l.goals}`}` : ""}`)
          .join(", ")}`
      : "";
    return `${header}\n\n${body}${scorers}\n\nFairness spread: ${spread}′ · Max off-target: ${maxOff}′`;
  }

  /** What Copy and Download send: the receipt, sign-off included. */
  function summaryText(): string {
    return `${receiptBody()}\n— via NextOn`;
  }

  async function onCopy(): Promise<void> {
    const text = summaryText();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        // Clipboard blocked (no permission / no gesture) — the download stays available; benign.
      }
    }
  }

  function onDownload(): void {
    const blob = new Blob([summaryText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (match?.name ?? "match").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.download = `nexton-${safe}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const feedLabels: FeedLabels = {
    nameOf: (id) => match?.players.find((p) => p.id === id)?.name ?? id,
    slotLabel: slotShortName,
    startLabel: cfg.startLabel,
    periodLabel: cfg.periodLabel,
    breakLabel: cfg.breakLabel,
    endLabel: cfg.endLabel,
    scoreIcon: cfg.scoreIcon,
    showScoreValue: isBasketball,
  };

  const header = (
    <header className={styles.header}>
      <span className={la.brand}>
        <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
          ←
        </Link>
        <Logo />
      </span>
      <Pill tone="neutral">{cfg.endLabel}</Pill>
    </header>
  );

  if (loading) {
    return (
      <main className={styles.page}>
        {header}
        <div className={styles.gutter}>
          <p className={styles.empty}>Opening the album…</p>
        </div>
      </main>
    );
  }

  if (!match || !view) {
    return (
      <main className={styles.page}>
        {header}
        <div className={styles.gutter}>
          <h1 className={ar.hed}>No such match.</h1>
          <p className={styles.body}>It may have been deleted on this device or on another one.</p>
          <div style={{ marginTop: 16 }}>
            <HardButtonLink href={`/teams/${teamId}`} variant="outline" size="md">
              Back to the team
            </HardButtonLink>
          </div>
        </div>
      </main>
    );
  }

  const spreadMin = minutes(view.report.spreadSeconds);
  // Status band scales with the match length — a fixed 4′ band would call ANY split in a short
  // game "fair" (a 6′ game with 6′-vs-3′ players showed 100% before this).
  const statusTol = statusTolFor(match.config.periods * match.config.periodLengthMinutes * 60);
  const onTargetCount = view.lines.filter((l) => statusFor(l.debtSeconds, statusTol) === "on").length;
  const squadPlayed = view.lines.filter((l) => l.playedSeconds > 0).length;
  const unplayed = view.lines.length - squadPlayed;
  const scheduledMinutes = match.config.periods * match.config.periodLengthMinutes;

  // The headline is derived, never assumed: "Album complete." is only printed when everyone got on
  // AND everyone landed inside the fairness band; otherwise the page says what really happened.
  const hedTop =
    unplayed === 0 ? "Everyone played." : unplayed === 1 ? "All but one played." : `${unplayed} never got on.`;
  const hedBottom =
    unplayed === 0 && onTargetCount === view.lines.length ? "Album complete." : "Here are the numbers.";

  return (
    <main className={styles.page}>
      {header}

      <div className={styles.gutter}>
        <h1 className={ar.hed}>
          {hedTop}
          <br />
          <span className={ar.hedRed}>{hedBottom}</span>
        </h1>
        <p className={styles.note}>
          {match.name} · {scheduledMinutes}′ scheduled ·{" "}
          {view.totalGoals > 0 ? `${cfg.scoreIcon} ${view.totalGoals}` : `no ${cfg.scoreTotalLabel.toLowerCase()} logged`}
        </p>

        {/* The verdict, as three little stickers pressed on the page. */}
        <div className={cx(ar.statGrid, ar.statGrid3)}>
          <div className={ar.statCell} style={{ ["--tilt" as string]: `${tilt("stat-fair", 1.5)}deg` }}>
            <div className={ar.statValue}>
              {onTargetCount}/{view.lines.length}
            </div>
            <div className={ar.statLabel}>Played fair share</div>
          </div>
          <div className={ar.statCell} style={{ ["--tilt" as string]: `${tilt("stat-spread", 1.5)}deg` }}>
            <div className={cx(ar.statValue, ar.statValueRed)}>{spreadMin}′</div>
            <div className={ar.statLabel}>Minutes spread</div>
          </div>
          <div className={ar.statCell} style={{ ["--tilt" as string]: `${tilt("stat-subs", 1.5)}deg` }}>
            <div className={ar.statValue}>{view.subsMade}</div>
            <div className={ar.statLabel}>Subs made</div>
          </div>
        </div>

        {/* ── Box score ── */}
        <Kicker>Box score</Kicker>
        <div className={styles.cardInset}>
          <div className={ar.tableHead} style={{ gridTemplateColumns: BOX_COLUMNS }}>
            <span>Player</span>
            <span className={ar.num}>Min</span>
            <span className={ar.num} title={cfg.scoreTotalLabel}>
              {cfg.scoreIcon}
            </span>
            <span className={ar.num}>Fair</span>
          </div>
          {view.lines.map((l, i) => (
            <div
              key={l.playerId}
              className={cx(ar.rowGrid, i === view.lines.length - 1 && ar.rowGridLast)}
              style={{ gridTemplateColumns: BOX_COLUMNS }}
            >
              <span className={ar.cellName}>
                {l.gkSeconds > 0 ? "🧤 " : ""}
                {l.name}
              </span>
              <span className={ar.num}>{minutes(l.playedSeconds)}′</span>
              <span className={ar.num}>{l.goals > 0 ? l.goals : "—"}</span>
              <span style={{ textAlign: "right" }}>
                <StatusChip kind={statusFor(l.debtSeconds, statusTol)} wordless />
              </span>
            </div>
          ))}
          <div className={ar.tableFoot}>
            <span>Spread: {spreadMin}′</span>
            <span>Max off target: {minutes(view.report.maxAbsDebtSeconds)}′</span>
          </div>
        </div>
        <p className={styles.note}>
          ✓ on target · ▲ short of a fair share · ▼ played more than a fair share. Season totals
          build on the Season page, and seed the next match when Season fair-play is on.
        </p>

        {/* ── Who scored ── */}
        {view.scorers.length > 0 && (
          <>
            <Kicker>
              {cfg.scoreIcon} {cfg.scorersLabel} · {view.totalGoals}
            </Kicker>
            <p className={styles.body} style={{ marginTop: 0, fontWeight: 800 }}>
              {view.scorers
                .map((l) => `${l.name}${l.goals > 1 ? (isBasketball ? ` ${l.goals}pts` : ` ×${l.goals}`) : ""}`)
                .join(" · ")}
            </p>
          </>
        )}

        {/* ── THE SWAPSIES NOTE — the share text, printed as the receipt it becomes ── */}
        <div className={ar.receiptCard} style={{ ["--tilt" as string]: "-0.6deg" }}>
          <div className={ar.receiptTitle}>swapsies note for the parents&apos; chat:</div>
          <pre className={ar.receipt}>
            {receiptBody()}
            {"\n"}
            <span className={ar.receiptVia}>— via NextOn</span>
          </pre>
        </div>
        <div style={{ marginTop: 12 }}>
          <HardButton variant="green" onClick={() => void onCopy()}>
            Copy the swapsies note
          </HardButton>
          <div className={ar.btnRow}>
            <HardButton variant="outline" size="md" onClick={onDownload}>
              Download .txt
            </HardButton>
            <HardButtonLink href={`/teams/${teamId}/new`} variant="outline" size="md">
              Next match →
            </HardButtonLink>
          </div>
          <HandNote size={19} rotate={tilt(matchId, 1.5)} style={{ marginTop: 8 }}>
            same numbers as the page above — nothing polished up
          </HandNote>
        </div>

        {/* ── The match log: what actually happened, in order ── */}
        {view.feed.length > 0 && (
          <details className={la.details}>
            <summary className={la.detailsHead}>
              <span>Match log · {view.feed.length} entries</span>
              <span className={la.detailsMark} aria-hidden>
                <span className={la.markOpen}>▾</span>
                <span className={la.markClosed}>▸</span>
              </span>
            </summary>
            <div className={styles.cardInset} style={{ marginTop: 10 }}>
              {view.feed.map((e, i) => {
                const wall = wallClockLabel(e.wallClockISO);
                return (
                  <div key={e.key} className={cx(la.logRow, i === view.feed.length - 1 && la.logRowLast)}>
                    <span className={la.logTime}>{clockTime(e.atSeconds)}</span>
                    <span className={la.logText}>{feedLineText(e, feedLabels)}</span>
                    {wall !== null && <span className={la.logClock}>{wall}</span>}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {copied && <Toast message="Copied ✓" />}
    </main>
  );
}
