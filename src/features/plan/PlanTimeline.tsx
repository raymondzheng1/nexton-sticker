"use client";
/**
 * The planned-changes timeline — the pre-match sub plan as a stack of small sticker rows, each one
 * editable: retime it (±2′), swap who's involved, remove it, or add a new change into the biggest
 * gap. Every edit keeps the prefix and lets the engine re-plan the rest, exactly as the proven
 * wiring does it: replanAfter / sanitizePlan / suggestWindowAt are the only authorities on what a
 * valid plan looks like, and the projected minutes the caller renders elsewhere update from the
 * same `onChange` windows.
 *
 * Fully controlled: `windows` in, `onChange(nextWindows)` out. The caller persists (approvePlan)
 * and re-projects; this component owns nothing but the editing gestures.
 */
import { useMemo } from "react";
import {
  replanAfter,
  sanitizePlan,
  stateAfterWindows,
  suggestWindowAt,
  type LineupAssignment,
  type LiveState,
  type Match,
  type PlannedWindow,
  type Player,
} from "@/engine";
import { slotFullName, slotShortName, sportOf } from "@/features/sports";
import { HardButton, StickerFrame, clockTime, cx, styles, tilt } from "@/ui";
import tl from "./planTimeline.module.css";

/** m:ss, unpadded — how a change is written on the plan ("7:30", not "07:30"). */
function planTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface PlanTimelineProps {
  /** The match rules (match.config) — sport, periods, period length all read from here. */
  config: Match;
  players: Player[];
  startingLineup: LineupAssignment[];
  windows: PlannedWindow[];
  /** Receives the full re-planned list after every edit. Persist + re-project from it. */
  onChange: (windows: PlannedWindow[]) => void;
  totalSeconds: number;
}

export function PlanTimeline({
  config,
  players,
  startingLineup,
  windows,
  onChange,
  totalSeconds,
}: PlanTimelineProps) {
  const cfg = sportOf(config.sport);
  const squadById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const nameOf = (id: string): string => squadById.get(id)?.name ?? id;

  // Lineup state before each planned window — the Off/On option lists are built from it, so an
  // edit can only ever offer players who are really on the pitch / on the bench at that moment.
  const planStates = useMemo<LiveState[]>(() => {
    if (startingLineup.length === 0) return [];
    const out: LiveState[] = [];
    for (let k = 0; k <= windows.length; k++) {
      out.push(stateAfterWindows(config, players, startingLineup, windows.slice(0, k)));
    }
    return out;
  }, [config, players, startingLineup, windows]);

  /* ── edits (each keeps the prefix; the engine re-plans the rest) ─────────── */

  const retime = (i: number, deltaSec: number): void => {
    const w = windows[i];
    if (!w) return;
    const prev = windows[i - 1];
    const nextW = windows[i + 1];
    const lo = (prev ? prev.atSeconds : 0) + 60;
    const hi = (nextW ? nextW.atSeconds : totalSeconds) - 60;
    const at = Math.max(lo, Math.min(hi, w.atSeconds + deltaSec));
    if (at === w.atSeconds) return;
    const edited = [...windows];
    edited[i] = { ...w, atSeconds: at };
    onChange(replanAfter(config, players, startingLineup, edited, i + 1));
  };

  const removeWindow = (i: number): void => {
    // A literal delete (re-planning would just have the engine re-add an equivalent change);
    // sanitizePlan rewrites what's left so it stays valid.
    onChange(sanitizePlan(config, players, startingLineup, windows.filter((_, k) => k !== i)));
  };

  const addWindow = (): void => {
    const marks = [0, ...windows.map((w) => w.atSeconds), totalSeconds];
    let gapIdx = 0;
    let gapLen = -1;
    for (let i = 0; i < marks.length - 1; i++) {
      const a = marks[i];
      const b = marks[i + 1];
      if (a === undefined || b === undefined) continue;
      if (b - a > gapLen) {
        gapLen = b - a;
        gapIdx = i;
      }
    }
    const a = marks[gapIdx];
    const b = marks[gapIdx + 1];
    if (a === undefined || b === undefined) return;
    const at = Math.round((a + b) / 2);
    const before = windows.filter((w) => w.atSeconds < at);
    const nw = suggestWindowAt(config, players, startingLineup, before, at);
    if (!nw) return;
    const merged = [...windows, nw].sort((x, y) => x.atSeconds - y.atSeconds);
    onChange(replanAfter(config, players, startingLineup, merged, merged.indexOf(nw) + 1));
  };

  const changeSwap = (i: number, swapIdx: number, field: "off" | "on", playerId: string): void => {
    const w = windows[i];
    const before = planStates[i];
    if (!w || !before) return;
    const off = [...w.off];
    const on = w.on.map((o) => ({ ...o }));
    const cur = on[swapIdx];
    if (field === "off") {
      off[swapIdx] = playerId;
      const slot = before.players[playerId]?.currentSlot ?? cur?.slot;
      if (cur && slot) on[swapIdx] = { ...cur, slot };
    } else if (cur) {
      on[swapIdx] = { ...cur, playerId };
    }
    const edited = [...windows];
    edited[i] = { ...w, off, on, positionChanges: [] }; // manual edit → a straight swap, no chained moves
    onChange(replanAfter(config, players, startingLineup, edited, i + 1));
  };

  /* ── the stack ───────────────────────────────────────────────────────────── */

  return (
    <div>
      {windows.length === 0 ? (
        <p className={styles.note}>No changes planned — everyone plays the whole match.</p>
      ) : (
        <div className={tl.list}>
          {windows.map((w, i) => {
            const before = planStates[i];
            if (!before) return null;
            const onFieldBefore = Object.values(before.players).filter(
              (p) => p.onField && p.currentSlot !== "GK",
            );
            const benchIdsBefore = players
              .map((p) => p.id)
              .filter(
                (id) => !before.players[id]?.onField && squadById.get(id)?.availability !== "unavailable",
              );
            return (
              <StickerFrame key={`${w.atSeconds}-${i}`} tiltDeg={tilt(`change-${i}`, 1)} className={tl.card}>
                <div className={tl.head}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={`Change ${i + 1} two minutes earlier`}
                    onClick={() => retime(i, -120)}
                  >
                    −
                  </button>
                  <span className={tl.time}>
                    {planTime(w.atSeconds)} · {cfg.periodLabel.charAt(0)}
                    {Math.min(config.periods, Math.floor(w.atSeconds / (config.periodLengthMinutes * 60)) + 1)}
                  </span>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={`Change ${i + 1} two minutes later`}
                    onClick={() => retime(i, 120)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={cx(styles.iconBtn, tl.remove)}
                    aria-label={`Remove change ${i + 1}`}
                    onClick={() => removeWindow(i)}
                  >
                    ✕
                  </button>
                </div>
                {w.on.map((onEntry, si) => {
                  const offId = w.off[si];
                  return (
                    <div key={si} className={tl.swap}>
                      <div className={tl.swapRow}>
                        <span className={cx(tl.swapLabel, tl.swapLabelOff)}>▼ off</span>
                        <select
                          aria-label={`Player off in change ${i + 1}`}
                          value={offId ?? ""}
                          onChange={(e) => changeSwap(i, si, "off", e.target.value)}
                        >
                          {offId && !onFieldBefore.some((p) => p.playerId === offId) && (
                            <option value={offId}>{nameOf(offId)}</option>
                          )}
                          {onFieldBefore.map((p) => (
                            <option key={p.playerId} value={p.playerId}>
                              {nameOf(p.playerId)}
                              {p.currentSlot ? ` (${slotShortName(p.currentSlot)})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={tl.swapRow}>
                        <span className={cx(tl.swapLabel, tl.swapLabelOn)}>▲ on</span>
                        <select
                          aria-label={`Player on in change ${i + 1}`}
                          value={onEntry.playerId}
                          onChange={(e) => changeSwap(i, si, "on", e.target.value)}
                        >
                          {!benchIdsBefore.includes(onEntry.playerId) && (
                            <option value={onEntry.playerId}>{nameOf(onEntry.playerId)}</option>
                          )}
                          {benchIdsBefore.map((id) => (
                            <option key={id} value={id}>
                              {nameOf(id)}
                            </option>
                          ))}
                        </select>
                        <span className={tl.slot}>{slotFullName(onEntry.slot)}</span>
                      </div>
                    </div>
                  );
                })}
              </StickerFrame>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <HardButton variant="outline" size="md" auto onClick={addWindow}>
          + Add a change
        </HardButton>
      </div>
    </div>
  );
}

/* ── read-only sibling: the changes still ahead, on the live desk ─────────── */

export interface UpcomingTimelineProps {
  /** Only the windows still ahead — the caller filters by the live clock. */
  windows: readonly PlannedWindow[];
  players: Player[];
  /** The pinned next-change target; its row is inked red. */
  nextAtSeconds?: number | null;
}

/** "Still to come", printed as plain album rows — a record of intent, never an editor. */
export function UpcomingTimeline({ windows, players, nextAtSeconds = null }: UpcomingTimelineProps) {
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? id;
  if (windows.length === 0) {
    return <p className={styles.note}>Nothing more scheduled — ask for a change whenever you want one.</p>;
  }
  return (
    <div>
      {windows.map((w, i) => (
        <div key={w.atSeconds} className={cx(styles.row, i === windows.length - 1 && styles.rowLast)}>
          <span className={cx(tl.upTime, nextAtSeconds === w.atSeconds && tl.upNext)}>
            {clockTime(w.atSeconds)}
          </span>
          <span className={tl.upText}>
            {w.on.map((o, k) => `${nameOf(w.off[k] ?? "")} → ${nameOf(o.playerId)}`).join(", ")}
          </span>
        </div>
      ))}
    </div>
  );
}
