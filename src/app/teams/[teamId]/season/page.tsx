"use client";
/**
 * The season — the whole collection, one row per sticker.
 *
 * The densest screen in the app, and deliberately so: a season is a table. Every row carries the
 * player's face swatch (their sticker in miniature) and links to their own page of the album. All
 * of it is computed on read from the stored event logs, so it can never drift from what actually
 * happened. The positions sub-line is written in full words because the people who read this
 * report are parents, not coaches.
 *
 * Wiring is the proven season screen's, 1:1 — period filter, seasonReport, copy/download report.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { seasonReport } from "@/store";
import type { PlayerSeasonRow, SavedMatch, Team } from "@/store";
import { getRepo } from "@/store/clientRepo";
import { slotFullName, sportOf } from "@/features/sports";
import { HardButton, Kicker, Logo, Pill, cx, faceOf, styles } from "@/ui";
import ar from "@/features/live/albumReport.module.css";

const SEC_PER_MIN = 60;

function minutes(seconds: number): number {
  return Math.round(seconds / SEC_PER_MIN);
}

/** "Centre mid 64′ · Striker 20′" — positional history in full words, biggest share first. */
function positionsLine(r: PlayerSeasonRow): string {
  return Object.entries(r.totalSecondsBySlot)
    .filter(([, sec]) => minutes(sec) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([slot, sec]) => `${slotFullName(slot)} ${minutes(sec)}′`)
    .join(" · ");
}

type Period = "all" | "thisMonth" | "lastMonth";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All season" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
];

/** The month a match belongs to (kickoff date, falling back to creation). */
function matchDate(m: SavedMatch): Date {
  return new Date(m.startedAtISO ?? m.createdAt);
}

function inPeriod(m: SavedMatch, period: Period, now: Date): boolean {
  if (period === "all") return true;
  const d = matchDate(m);
  const month = period === "thisMonth" ? now.getMonth() : (now.getMonth() + 11) % 12;
  const year = period === "thisMonth" || now.getMonth() > 0 ? now.getFullYear() : now.getFullYear() - 1;
  return d.getMonth() === month && d.getFullYear() === year;
}

export default function SeasonPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("all");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const repo = getRepo();
    void Promise.all([repo.listMatches(teamId), repo.getTeam(teamId)]).then(([ms, t]) => {
      if (!alive) return;
      setMatches(ms);
      setTeam(t);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [teamId]);

  const filtered = useMemo(() => {
    const now = new Date();
    return matches.filter((m) => inPeriod(m, period, now));
  }, [matches, period]);
  const rows: PlayerSeasonRow[] = useMemo(() => seasonReport(filtered), [filtered]);
  // Football counts goals, basketball counts points — one column, the sport decides which number.
  const sport = sportOf(team?.sport);
  const scoreOf = (r: PlayerSeasonRow): number => (sport.id === "basketball" ? r.totalPoints : r.totalGoals);
  const anyScores = rows.some((r) => scoreOf(r) > 0);
  const playedCount = filtered.filter((m) => m.events.some((e) => e.type === "MATCH_STARTED")).length;
  // PLAYER · APPS · STARTS · (⚽) · MINS — the score column only earns its space once someone scores.
  const columns = anyScores ? "1fr 46px 52px 34px 54px" : "1fr 46px 52px 54px";

  function reportText(): string {
    const label = PERIODS.find((p) => p.value === period)?.label ?? "All season";
    const header = `${team?.name ?? "Team"} — player report · ${label} · ${playedCount} match${playedCount === 1 ? "" : "es"}`;
    const body = rows
      .map((r) => {
        const positions = positionsLine(r);
        const scored = scoreOf(r) > 0 ? ` · ${sport.scoreIcon} ${scoreOf(r)}` : "";
        return `${r.name}: ${minutes(r.totalSecondsOnField)}′ · ${r.matchesPlayed} apps · ${r.starts} starts${scored}${positions ? `\n  positions: ${positions}` : ""}`;
      })
      .join("\n");
    return `${header}\n\n${body}\n— via NextOn`;
  }

  async function onCopy(): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(reportText());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        // Clipboard blocked (no permission / gesture) — the download stays available; benign.
      }
    }
  }

  function onDownload(): void {
    const blob = new Blob([reportText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = `${team?.name ?? "team"}-${period}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.download = `nexton-report-${safe}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const header = (
    <header className={styles.header}>
      <span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
          ←
        </Link>
        <Logo />
      </span>
      <Pill tone="neutral">
        {playedCount} match{playedCount === 1 ? "" : "es"}
      </Pill>
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

  return (
    <main className={styles.page}>
      {header}

      <div className={styles.gutter}>
        <h1 className={ar.hed}>{team ? team.name : "The season"}</h1>
        <p className={styles.note}>Every player&apos;s season, added up from the matches on file.</p>

        {/* Report period — monthly reports are what parents actually ask for. */}
        <div className={ar.periodChips}>
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cx(ar.periodChip, period === p.value && ar.periodChipOn)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, color: "var(--ink)" }}>
              {period === "all" ? "No pages filled yet" : "Nothing this period"}
            </div>
            <p className={styles.note} style={{ fontWeight: 600 }}>
              {period === "all"
                ? "Play a match and every player's minutes, positions and starts add up here."
                : "Try another period — matches count toward the month they kicked off in."}
            </p>
          </div>
        ) : (
          <>
            <Kicker>The collection</Kicker>
            <div className={styles.cardInset}>
              <div className={ar.tableHead} style={{ gridTemplateColumns: columns }}>
                <span>Player</span>
                <span className={ar.num}>Apps</span>
                <span className={ar.num}>Starts</span>
                {anyScores && (
                  <span className={ar.num} title={sport.scoreTotalLabel}>
                    {sport.scoreIcon}
                  </span>
                )}
                <span className={ar.num}>Mins</span>
              </div>
              {rows.map((r, i) => {
                const positions = positionsLine(r);
                const face = faceOf(r.playerId);
                return (
                  <Link
                    key={r.playerId}
                    href={`/teams/${teamId}/player/${r.playerId}`}
                    className={cx(ar.rowGrid, i === rows.length - 1 && ar.rowGridLast)}
                    style={{ gridTemplateColumns: columns, textDecoration: "none" }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span className={ar.cellName} style={{ display: "block" }}>
                        <span
                          className={ar.faceDot}
                          style={{ background: `linear-gradient(178deg, ${face.a}, ${face.b})` }}
                          aria-hidden
                        />
                        {r.name} <span style={{ color: "var(--red)" }}>›</span>
                      </span>
                      {positions !== "" && (
                        <span className={ar.cellSub} title={positions}>
                          {positions}
                        </span>
                      )}
                    </span>
                    <span className={ar.num}>{r.matchesPlayed}</span>
                    <span className={ar.num}>{r.starts}</span>
                    {anyScores && <span className={ar.num}>{scoreOf(r) || "—"}</span>}
                    <span className={ar.num}>{minutes(r.totalSecondsOnField)}′</span>
                  </Link>
                );
              })}
            </div>

            <div className={ar.btnRow}>
              <HardButton variant="outline" size="md" onClick={() => void onCopy()}>
                {copied ? "Copied ✓" : "Copy report"}
              </HardButton>
              <HardButton variant="outline" size="md" onClick={onDownload}>
                Download .txt
              </HardButton>
            </div>

            <p className={styles.note} style={{ marginTop: 14 }}>
              Positions show where each player&apos;s minutes were earned. Season minutes are tracked
              here separately — by default each match is balanced on its own. Turn on{" "}
              <strong>Season fair-play</strong> (in Edit team, or per match at setup) to have the
              engine draw on these totals and favour players who&apos;ve played less.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
