/**
 * Subbing GRID — the coach's classic paper "subbing sheet" mental model, generated from the plan:
 * players down the side, time-segments across the top, a filled cell = on the field (showing the
 * position). It complements the editable timeline with an at-a-glance view of the WHOLE game's
 * rotation — and totals each player's minutes automatically (what coaches do by hand on paper).
 *
 * Pure + framework-free so it's unit-testable; the React component only renders the result.
 */
import { stateAfterWindows, type LineupAssignment, type Match, type Player, type PlannedWindow, type PositionSlot } from "@/engine";

export interface GridColumn {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** 0-based period this segment belongs to (0 = first half/period). */
  periodIndex: number;
  /** True when this segment begins a new period (the natural column break, like the sheet's halves). */
  isPeriodStart: boolean;
}

export interface GridRow {
  playerId: string;
  name: string;
  /** Per-column slot code when on the field (e.g. "MC", "GK", "CDM"), or null when on the bench. */
  cells: (string | null)[];
  totalSeconds: number;
}

export interface SubbingGridData {
  columns: GridColumn[];
  rows: GridRow[];
}

/** DM/AM read as CDM/CAM everywhere in the UI; other slots are shown as-is. */
function cellLabel(slot: PositionSlot): string {
  return slot === "DM" ? "CDM" : slot === "AM" ? "CAM" : slot;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function buildSubbingGrid(
  match: Match,
  players: Player[],
  startingLineup: LineupAssignment[],
  windows: PlannedWindow[],
): SubbingGridData {
  const periodLen = match.periodLengthMinutes * 60;
  const total = match.periods * periodLen;

  // Column boundaries = kickoff, every planned change, and every period break (so half-time is a
  // clean column division, exactly like the paper sheet's "1ST / 2ND"), clamped to the match length.
  const periodStarts: number[] = [];
  for (let p = 1; p < match.periods; p++) periodStarts.push(p * periodLen);
  const bounds = uniqueSorted(
    [0, ...windows.map((w) => w.atSeconds), ...periodStarts, total].filter((t) => t >= 0 && t <= total),
  );

  // The on-field state only changes when a window fires, so cache one LiveState per applied-count.
  const stateByApplied = new Map<number, ReturnType<typeof stateAfterWindows>>();
  const stateAfter = (start: number): ReturnType<typeof stateAfterWindows> => {
    const applied = windows.filter((w) => w.atSeconds <= start).length;
    let s = stateByApplied.get(applied);
    if (s === undefined) {
      s = stateAfterWindows(match, players, startingLineup, windows.slice(0, applied));
      stateByApplied.set(applied, s);
    }
    return s;
  };

  const columns: GridColumn[] = [];
  const onFieldByCol: Record<string, PositionSlot | null>[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startSeconds = bounds[i] ?? 0;
    const endSeconds = bounds[i + 1] ?? total;
    if (endSeconds <= startSeconds) continue;
    const periodIndex = Math.min(match.periods - 1, Math.floor(startSeconds / periodLen));
    columns.push({
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
      periodIndex,
      isPeriodStart: startSeconds % periodLen === 0,
    });
    const state = stateAfter(startSeconds);
    const slots: Record<string, PositionSlot | null> = {};
    for (const p of players) {
      const lp = state.players[p.id];
      slots[p.id] = lp?.onField ? lp.currentSlot : null;
    }
    onFieldByCol.push(slots);
  }

  // Row order mirrors the paper sheet: starters first (in lineup order), then the rest of the squad.
  const starterIds = startingLineup.map((a) => a.playerId);
  const ordered = [
    ...starterIds.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined),
    ...players.filter((p) => !starterIds.includes(p.id)),
  ];

  const rows: GridRow[] = ordered.map((p) => {
    let totalSeconds = 0;
    const cells = columns.map((col, i) => {
      const slot = onFieldByCol[i]?.[p.id] ?? null;
      if (slot !== null) totalSeconds += col.durationSeconds;
      return slot !== null ? cellLabel(slot) : null;
    });
    return { playerId: p.id, name: p.name, cells, totalSeconds };
  });

  return { columns, rows };
}
