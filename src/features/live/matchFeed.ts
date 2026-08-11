/**
 * The match log — what ACTUALLY happened, derived from the append-only event log.
 *
 * The substitution PLAN says what the coach intends; this says what they did. They diverge the
 * moment a coach subs off-script (which is most matches), so the two must never be confused: the
 * plan is a forecast, the log is the record. Every entry carries the real match minute the event
 * was committed at, plus the wall-clock stamp when one was recorded.
 *
 * Pure and UI-free: it maps events to structured entries and leaves names, labels and formatting to
 * the caller, so it can be unit-tested and reused by the live screen and the post-match review.
 */
import type { MatchEvent, PositionSlot } from "@/engine";

/** One player replacing another — `offId` is null for a player brought on without anyone going off. */
export interface FeedSwap {
  offId: string | null;
  onId: string;
  slot: PositionSlot;
}

/** An on-field player changing position (no one leaves the field). */
export interface FeedMove {
  playerId: string;
  fromSlot: PositionSlot;
  toSlot: PositionSlot;
}

interface FeedBase {
  /** Stable React key — the event's index in the log, which never shifts (the log is append-only). */
  key: string;
  /** Match seconds from kickoff when it happened. */
  atSeconds: number;
  /** Real-world time, when the event carried a stamp (older events predate stamping). */
  wallClockISO?: string;
}

export type FeedEntry = FeedBase &
  (
    | { kind: "kickoff" }
    | { kind: "sub"; swaps: FeedSwap[]; moves: FeedMove[] }
    | { kind: "move"; moves: FeedMove[] }
    | { kind: "score"; playerId: string; points: number }
    | { kind: "period-end"; period: number }
    | { kind: "period-start"; period: number }
    | { kind: "full-time" }
  );

/**
 * Build the match log from an event log, NEWEST FIRST — mid-match the coach is checking "what did I
 * just do", so the latest change belongs at the top where it needs no scrolling.
 *
 * Clock housekeeping (TICK, pause/resume) and advisory state (locks, pins, snooze) are left out:
 * they're how the app keeps time and takes instructions, not things that happened in the game.
 */
export function buildMatchFeed(events: readonly MatchEvent[]): FeedEntry[] {
  const out: FeedEntry[] = [];

  events.forEach((e, i) => {
    const base = { key: String(i), atSeconds: e.atSeconds };
    switch (e.type) {
      case "MATCH_STARTED":
        out.push({ ...base, wallClockISO: e.wallClockISO, kind: "kickoff" });
        break;
      case "SUB_APPLIED": {
        const moves: FeedMove[] = e.positionChanges.map((pc) => ({ ...pc }));
        // off[i] pairs with on[i] — the same convention the planner and reducer use. A sub with no
        // swaps at all is a pure reshuffle, which reads very differently and gets its own entry.
        const swaps: FeedSwap[] = e.on.map((on, k) => ({
          offId: e.off[k] ?? null,
          onId: on.playerId,
          slot: on.slot,
        }));
        if (swaps.length === 0 && moves.length === 0) break; // nothing observable happened
        out.push(
          swaps.length > 0
            ? { ...base, wallClockISO: e.wallClockISO, kind: "sub", swaps, moves }
            : { ...base, wallClockISO: e.wallClockISO, kind: "move", moves },
        );
        break;
      }
      case "GOAL_SCORED":
        out.push({
          ...base,
          wallClockISO: e.wallClockISO,
          kind: "score",
          playerId: e.playerId,
          points: e.points ?? 1, // scores logged before points existed were worth one
        });
        break;
      case "PERIOD_ENDED":
        out.push({ ...base, wallClockISO: e.wallClockISO, kind: "period-end", period: e.period });
        break;
      case "PERIOD_STARTED":
        out.push({ ...base, wallClockISO: e.wallClockISO, kind: "period-start", period: e.period });
        break;
      case "MATCH_ENDED":
        out.push({ ...base, wallClockISO: e.wallClockISO, kind: "full-time" });
        break;
      default:
        break; // TICK / pause / resume / lock / pin / snooze — not part of the story
    }
  });

  return out.reverse();
}

/** Everything the formatter needs to turn an entry into one line of coach-readable English. */
export interface FeedLabels {
  nameOf: (playerId: string) => string;
  slotLabel: (slot: PositionSlot) => string;
  /** "Kick off" / "Tip off". */
  startLabel: string;
  /** "Half" / "Period". */
  periodLabel: string;
  /** "Half time" / "Period break". */
  breakLabel: string;
  /** "Full time" / "Final". */
  endLabel: string;
  scoreIcon: string;
  /** True when a score can be worth more than one, so the value is worth saying (basketball). */
  showScoreValue: boolean;
}

/**
 * One match-log line. Shared by the live screen and the post-match review so the two can never drift
 * into describing the same event differently.
 */
export function feedLineText(e: FeedEntry, l: FeedLabels): string {
  switch (e.kind) {
    case "kickoff":
      return `${l.startLabel} — match under way`;
    case "sub": {
      const subs = e.swaps
        .map((s) => `${s.offId ? `${l.nameOf(s.offId)} off, ` : ""}${l.nameOf(s.onId)} on (${l.slotLabel(s.slot)})`)
        .join(" · ");
      const moves = e.moves.map((m) => `${l.nameOf(m.playerId)} → ${l.slotLabel(m.toSlot)}`).join(", ");
      return moves ? `${subs} · ${moves}` : subs;
    }
    case "move":
      return e.moves.map((m) => `${l.nameOf(m.playerId)} moved to ${l.slotLabel(m.toSlot)}`).join(", ");
    case "score":
      return l.showScoreValue
        ? `${l.scoreIcon} ${l.nameOf(e.playerId)} scored ${e.points}`
        : `${l.scoreIcon} ${l.nameOf(e.playerId)} scored`;
    case "period-end":
      return `${l.breakLabel} — end of ${l.periodLabel.toLowerCase()} ${e.period}`;
    case "period-start":
      return `${l.periodLabel} ${e.period} under way`;
    case "full-time":
      return l.endLabel;
  }
}

/** How many substitutions have actually been made (position-only reshuffles don't count). */
export function countActualSubs(feed: readonly FeedEntry[]): number {
  return feed.reduce((n, e) => (e.kind === "sub" ? n + e.swaps.length : n), 0);
}

/** "14:32" from a stored ISO stamp — local time, since the coach reads it against their own watch. */
export function wallClockLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
