"use client";
/**
 * "Where everyone finishes" — projected full-time minutes per player, drawn as a sticker-album
 * table on cream card stock: name, a green bar on the track with the red fair-share tick, minutes.
 *
 * Used in two places and deliberately ONE component, because the two answers must look and read
 * identically: before kick-off it projects a hypothetical match from the starting lineup, and during
 * a match it projects from the minutes already on the clock plus the changes still to come. A coach
 * comparing the two should see the same table, not two dialects of the same idea.
 *
 * The derivation helpers (projectedRows, fairShareSeconds, spreadSeconds) are a straight port of
 * the proven wiring — only the presentation is album language.
 */
import { fairnessReport, type LiveState, type Match, type Player } from "@/engine";
// Imported from the module rather than the barrel: status.ts is copied-verbatim core, and this file
// must compile whether or not the live feature has an index yet.
import { statusFor, statusTolFor, type TokenStatus } from "@/features/live/status";
import { Kicker, ProgressTrack, StatusChip, cx, mins, styles } from "@/ui";

export interface ProjectedRow {
  id: string;
  name: string;
  seconds: number;
  status: TokenStatus;
  /** Their minutes are fixed — not planned for (late, not here yet) or finished (retired). */
  fixed: boolean;
  /** Why they're fixed, for the row's tooltip. Empty when they're a normal rotation player. */
  fixedReason: string;
}

/**
 * Turn a projected end-of-match state into display rows, sorted by minutes.
 *
 * Two kinds of player get marked rather than judged, because a status glyph beside them would be
 * read as unfairness when it's nothing of the sort:
 *  - a 🕑 late player who hasn't arrived — nothing is planned for them until they turn up;
 *  - a 🚑 player retired out of the match — their minutes are final and no plan can change them.
 */
export function projectedRows(
  match: Match,
  players: Player[],
  finalState: LiveState,
  totalSeconds: number,
): ProjectedRow[] {
  const debt = new Map(fairnessReport(match, players, finalState).rows.map((r) => [r.playerId, r.debtSeconds]));
  const tol = statusTolFor(totalSeconds);
  return players
    .map((p) => {
      const seconds = finalState.players[p.id]?.secondsOnField ?? 0;
      const late = p.availability === "arrives-late" && (p.unavailableUntilMinute ?? 0) > 0;
      const retired = p.availableUntilMinute !== undefined;
      const fixed = late || retired;
      return {
        id: p.id,
        name: retired ? `🚑 ${p.name}` : late ? `🕑 ${p.name}` : p.name,
        seconds,
        fixed,
        fixedReason: retired
          ? "Out for the match — these minutes are final"
          : late
            ? "Arrives later — planned in once they're here"
            : "",
        status: fixed ? ("on" as const) : statusFor(debt.get(p.id) ?? 0, tol),
      };
    })
    .sort((a, b) => b.seconds - a.seconds || (a.name < b.name ? -1 : 1));
}

/**
 * Where the red tick goes: the mean of the projected minutes. With every player on a full share
 * that IS the fair share — the squad's on-field seconds divided between them — and when weights or
 * late arrivals make it only an approximation, the caller passes the exact figure instead.
 */
export function fairShareSeconds(rows: ProjectedRow[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, r) => sum + r.seconds, 0) / rows.length;
}

/** How far the worst-off player lands from that fair share — the spread, in seconds. */
export function spreadSeconds(rows: ProjectedRow[], fair = fairShareSeconds(rows)): number {
  return rows.reduce((worst, r) => Math.max(worst, Math.abs(r.seconds - fair)), 0);
}

interface ProjectedMinutesProps {
  rows: ProjectedRow[];
  /** Seconds an even split would give everyone — where the red tick sits. Defaults to the mean. */
  fairSeconds?: number;
  title?: string;
  /** Small uppercase caption beside the kicker, e.g. "if the plan runs". */
  caption?: string;
  /** Appended to the fair-share legend, e.g. "everyone lands within 2′ of it". */
  footnote?: string;
}

export function ProjectedMinutes({
  rows,
  fairSeconds,
  title = "Projected minutes",
  caption,
  footnote,
}: ProjectedMinutesProps) {
  const fair = fairSeconds ?? fairShareSeconds(rows);
  const max = Math.max(1, fair, ...rows.map((r) => r.seconds));

  return (
    <section>
      <Kicker style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span>{title}</span>
        {caption !== undefined && (
          <span style={{ fontSize: 11.5, letterSpacing: "0.08em", fontWeight: 800 }}>{caption}</span>
        )}
      </Kicker>

      <div className={styles.cardInset}>
        {rows.length === 0 ? (
          <p className={styles.note}>No minutes to project yet.</p>
        ) : (
          rows.map((row, i) => (
            <div key={row.id} className={cx(styles.row, i === rows.length - 1 && styles.rowLast)}>
              <span
                title={row.name}
                style={{
                  width: 52,
                  flex: "none",
                  fontSize: 15,
                  fontWeight: 800,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.name}
              </span>
              <ProgressTrack pct={(row.seconds / max) * 100} tickPct={(fair / max) * 100} />
              <span style={{ width: 34, flex: "none", textAlign: "right", fontSize: 15, fontWeight: 800 }}>
                {mins(row.seconds)}
              </span>
              {/* A late or retired player is marked, never judged — a status glyph there would read
                  as unfairness when their minutes simply aren't the plan's to give. */}
              <span style={{ width: 16, flex: "none", textAlign: "center" }} title={row.fixedReason || undefined}>
                {row.fixed ? (
                  <span style={{ color: "var(--tan)", fontWeight: 800 }}>–</span>
                ) : (
                  <StatusChip kind={row.status} wordless />
                )}
              </span>
            </div>
          ))
        )}
      </div>

      <p className={styles.note}>
        <span style={{ color: "var(--red)", fontWeight: 800 }}>|</span> = fair share
        {footnote !== undefined && ` · ${footnote}`}
      </p>
    </section>
  );
}
