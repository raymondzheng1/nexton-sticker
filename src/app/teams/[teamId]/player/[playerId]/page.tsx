"use client";
/**
 * The player's own page of the album — one kid's season, match by match, headed by their big
 * sticker (their gradient face, their emoji art).
 *
 * Everything is computed on read from the stored event logs: minutes per match (against that
 * match's own fair share), scores, starts, and where the minutes were earned. Linked from the
 * season collection.
 *
 * The chart is hand-drawn SVG rather than a charting library: a row of rectangles and a dashed
 * fair-share rule are cheaper than a dependency — a bar that reached its fair share prints green,
 * one that came up short prints red, and the words below say the same thing so colour is never
 * the only signal.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fairnessReport, rebuildLiveState } from "@/engine";
import { getRepo } from "@/store/clientRepo";
import type { SavedMatch, Team } from "@/store";
import { slotFullName, sportOf } from "@/features/sports";
import { HandNote, Kicker, Logo, Pill, ProgressTrack, cx, faceOf, mins, styles, tilt } from "@/ui";
import ar from "@/features/live/albumReport.module.css";

const SEC_PER_MIN = 60;
const minutes = (s: number): number => Math.round(s / SEC_PER_MIN);

interface MatchRow {
  matchId: string;
  dateISO: string;
  playedSeconds: number;
  targetSeconds: number;
  goals: number;
  started: boolean;
  secondsBySlot: Record<string, number>;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function PlayerPage() {
  const params = useParams<{ teamId: string; playerId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const playerId = typeof params.playerId === "string" ? params.playerId : "";

  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);

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

  const playerRecord =
    team?.roster.find((p) => p.id === playerId) ??
    matches.flatMap((m) => m.players).find((p) => p.id === playerId) ??
    null;
  const playerName = playerRecord?.name ?? "Player";

  // The team's sport decides whether the scoring column reads goals or points.
  const sport = sportOf(team?.sport);
  const gk = sport.hasGoalkeeper && (playerRecord?.canPlayGK ?? false);

  const rows: MatchRow[] = useMemo(() => {
    const out: MatchRow[] = [];
    for (const m of matches) {
      if (m.deletedAt !== null) continue;
      const started = m.events.find((e) => e.type === "MATCH_STARTED");
      if (!started || started.type !== "MATCH_STARTED") continue; // never kicked off
      if (!m.players.some((p) => p.id === playerId)) continue; // not in this match's squad
      const finalState = rebuildLiveState(m.config, m.players, m.events);
      const ls = finalState.players[playerId];
      if (!ls) continue;
      const report = fairnessReport(m.config, m.players, finalState);
      const r = report.rows.find((x) => x.playerId === playerId);
      out.push({
        matchId: m.id,
        dateISO: m.startedAtISO ?? m.createdAt,
        playedSeconds: ls.secondsOnField,
        targetSeconds: r?.targetSeconds ?? 0,
        // Per match, in that match's own sport: football goals, basketball points.
        goals: (m.config.sport ?? "football") === "basketball" ? ls.points : ls.goals,
        started: started.lineup.some((a) => a.playerId === playerId),
        secondsBySlot: Object.fromEntries(
          Object.entries(ls.secondsBySlot).filter(([, sec]) => (sec ?? 0) > 0),
        ),
      });
    }
    return out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1)); // oldest → newest
  }, [matches, playerId]);

  const totals = useMemo(() => {
    const bySlot: Record<string, number> = {};
    let played = 0;
    let goals = 0;
    let starts = 0;
    for (const r of rows) {
      played += r.playedSeconds;
      goals += r.goals;
      if (r.started) starts += 1;
      for (const [slot, sec] of Object.entries(r.secondsBySlot)) {
        bySlot[slot] = (bySlot[slot] ?? 0) + sec;
      }
    }
    return { played, goals, starts, bySlot };
  }, [rows]);

  const header = (
    <header className={styles.header}>
      <span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        <Link href={`/teams/${teamId}/season`} className={styles.backLink} aria-label="Back to the season">
          ←
        </Link>
        <Logo />
      </span>
      <Pill tone="neutral">
        {rows.length} match{rows.length === 1 ? "" : "es"}
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

  // ── Minutes-per-match chart. A bar that reached its fair share (within 10%) prints green, one
  // that came up short prints red; the dashed red rule across each bar is that match's fair share. ──
  const chartH = 172;
  const barW = 26;
  const gap = 14;
  const padL = 30;
  const padTop = 26;
  const padBottom = 26;
  const chartW = padL + rows.length * (barW + gap) + 8;
  const maxY = Math.max(1, ...rows.map((r) => Math.max(r.playedSeconds, r.targetSeconds)));
  const y = (sec: number): number => padTop + (chartH - padTop - padBottom) * (1 - sec / maxY);

  const positionTotals = Object.entries(totals.bySlot)
    .filter(([, sec]) => minutes(sec) > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxSlot = Math.max(1, ...positionTotals.map(([, sec]) => sec));

  const face = faceOf(playerId);
  const tiles = [
    { v: `${minutes(totals.played)}′`, l: "Minutes" },
    { v: String(rows.length), l: "Matches" },
    { v: String(totals.starts), l: "Starts" },
    { v: String(totals.goals), l: sport.scoreTotalLabel },
  ];

  return (
    <main className={styles.page}>
      {header}

      <div className={styles.gutter}>
        {/* The player IS their sticker — the big one, at the top of their own page. */}
        <div className={ar.bigStickerRow}>
          <div
            className={ar.bigSticker}
            style={{
              ["--tilt" as string]: `${tilt(playerId, 2)}deg`,
              ["--face-a" as string]: face.a,
              ["--face-b" as string]: face.b,
            }}
          >
            <span className={ar.bigFace} style={{ display: "block" }}>
              <span className={ar.bigArt} aria-hidden>
                {gk ? "🧤" : sport.scoreIcon}
              </span>
              <span className={ar.bigName}>{playerName}</span>
            </span>
            <span className={ar.bigFoot} style={{ display: "block" }}>
              {mins(totals.played)} played
            </span>
          </div>
          <div className={ar.bigAside}>
            <HandNote size={20} rotate={tilt(`${playerId}-note`, 2)}>
              {team ? `${team.name} · ` : ""}
              {rows.length === 0 ? "no pages filled yet" : `${rows.length} page${rows.length === 1 ? "" : "s"} of the season filled`}
            </HandNote>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, color: "var(--ink)" }}>
              No matches yet
            </div>
            <p className={styles.note} style={{ fontWeight: 600 }}>
              Once this player takes part in a match, their history builds here.
            </p>
          </div>
        ) : (
          <>
            {/* Summary tiles — the same little stickers as the finished match page. */}
            <div className={cx(ar.statGrid, ar.statGrid4)}>
              {tiles.map((t) => (
                <div
                  key={t.l}
                  className={ar.statCell}
                  style={{ ["--tilt" as string]: `${tilt(`${playerId}-${t.l}`, 1.5)}deg` }}
                >
                  <div className={ar.statValue}>{t.v}</div>
                  <div className={ar.statLabel}>{t.l}</div>
                </div>
              ))}
            </div>

            {/* ── Minutes per match ── */}
            <Kicker>Minutes per match</Kicker>
            <div className={styles.cardInset}>
              <div className={ar.chartScroll}>
                <svg
                  width={chartW}
                  height={chartH}
                  role="img"
                  aria-label={`Minutes per match for ${playerName}, against each match's fair share`}
                >
                  <text x={padL - 6} y={y(0) + 4} textAnchor="end" fontSize="12" fill="var(--tan)">
                    0
                  </text>
                  <text x={padL - 6} y={y(maxY) + 4} textAnchor="end" fontSize="12" fill="var(--tan)">
                    {minutes(maxY)}′
                  </text>
                  <line x1={padL} y1={y(0)} x2={chartW - 4} y2={y(0)} stroke="var(--border-tan)" strokeWidth="2" />
                  {rows.map((r, i) => {
                    const x = padL + i * (barW + gap) + gap / 2;
                    const met = r.playedSeconds >= r.targetSeconds * 0.9;
                    return (
                      <g key={r.matchId}>
                        <rect
                          x={x}
                          y={y(r.playedSeconds)}
                          width={barW}
                          height={Math.max(1, y(0) - y(r.playedSeconds))}
                          fill={met ? "var(--green)" : "var(--red)"}
                        />
                        {/* that match's fair share */}
                        <line
                          x1={x - 3}
                          y1={y(r.targetSeconds)}
                          x2={x + barW + 3}
                          y2={y(r.targetSeconds)}
                          stroke="var(--red-deep)"
                          strokeDasharray="4 3"
                          strokeWidth="2"
                        />
                        {r.goals > 0 && (
                          <text
                            x={x + barW / 2}
                            y={y(Math.max(r.playedSeconds, r.targetSeconds)) - 8}
                            textAnchor="middle"
                            fontSize="12"
                          >
                            {sport.scoreIcon}
                            {r.goals > 1 ? r.goals : ""}
                          </text>
                        )}
                        <text
                          x={x + barW / 2}
                          y={chartH - 7}
                          textAnchor="middle"
                          fontSize="12"
                          fill="var(--tan)"
                        >
                          {shortDate(r.dateISO)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
            <p className={styles.note}>
              The dashed rule is that match&apos;s fair share. A green bar reached it; a red bar came
              up short.
            </p>

            {/* ── Positions played (full names, for the people reading at home) ── */}
            {positionTotals.length > 0 && (
              <>
                <Kicker>Positions played</Kicker>
                <div className={styles.cardInset}>
                  {positionTotals.map(([slot, sec], i) => (
                    <div key={slot} className={cx(ar.barRow, i === positionTotals.length - 1 && ar.barRowLast)}>
                      <span className={ar.barLabel}>{slotFullName(slot)}</span>
                      <ProgressTrack pct={(sec / maxSlot) * 100} />
                      <span className={ar.barMins}>{minutes(sec)}′</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Match by match, newest first ── */}
            <Kicker>Match by match</Kicker>
            <div className={styles.cardInset}>
              {[...rows].reverse().map((r, i) => (
                <div key={r.matchId} className={cx(ar.matchRow, i === rows.length - 1 && ar.matchRowLast)}>
                  <span className={ar.matchDate}>{shortDate(r.dateISO)}</span>
                  <span className={ar.matchMins}>{minutes(r.playedSeconds)}′</span>
                  <span className={ar.matchDetail}>
                    {Object.entries(r.secondsBySlot)
                      .sort((a, b) => b[1] - a[1])
                      .map(([slot, sec]) => `${slotFullName(slot)} ${minutes(sec)}′`)
                      .join(" · ")}
                    {r.started ? " · started" : ""}
                    {r.goals > 0 ? ` · ${sport.scoreIcon} ${r.goals}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
