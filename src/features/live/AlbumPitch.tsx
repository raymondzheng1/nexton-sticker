"use client";
/**
 * ALBUM PITCH — the album page itself: a white sticker frame around the playing surface, with the
 * players ON as mini stickers standing in formation, their live minutes and fairness status printed
 * on each sticker's footer strip.
 *
 * It is a real control, not an illustration: tapping a sticker does exactly what tapping that
 * player's table row does, so tap-two-to-swap works between the picture and the lists
 * interchangeably. The contract (players / onSelect / selectedId / flashIds / frozen) is a straight
 * port of the proven live-screen wiring.
 *
 * Geometry is NOT reinvented here. `surfaceLayout` — shared verbatim with the sibling apps and
 * covered by the regression corpus — places every slot, so nothing in this file knows or cares how
 * many players are on the field (invariant #1).
 */
import type { ReactNode } from "react";
import { PlayerSticker, cx, tilt } from "@/ui";
import { slotFullName } from "@/features/sports";
import { STATUS_META, type TokenStatus } from "./status";
import { courtLayout, pitchLayout, type SurfacePoint } from "./surfaceLayout";
import ap from "./albumPitch.module.css";

/** One player on the page. Presentation only — the caller decides what each field means. */
export interface AlbumPlayer {
  id: string;
  /** First name, as everywhere in this product. */
  name: string;
  /** Their slot ("DC", "PG", "GK"); null when unplaced — they stand in the middle. */
  slot: string | null;
  /** Keep-on: a hard constraint the coach set, so it shows on the sticker and not only the list. */
  locked: boolean;
  secondsOnField: number;
  /** Fairness read, or null before kick-off when nobody has played a minute. */
  status: TokenStatus | null;
  /** The engine is suggesting this one comes off — the red-ringed sticker. */
  flagged: boolean;
  /** Printed on the footer INSTEAD of minutes: the team sheet prints the position. */
  note?: string;
  /** Scorer's mark on the face — "⚽", "⚽ 2", "🏀 5". */
  scoreMark?: string;
}

/** The old name, so ported wiring reads 1:1. */
export type FigurePlayer = AlbumPlayer;

export interface AlbumPitchProps {
  /** Football pitch or basketball half-court — `sportOf(match.config.sport).surface`. */
  surface: "pitch" | "court";
  players: AlbumPlayer[];
  /** The handwritten line under the page, e.g. <HandNote>tap a sticker to swap ↑</HandNote>. */
  caption?: ReactNode;
  /** The ▲/✓/▼ legend on the caption row. On by default — colour is never the only signal. */
  legend?: boolean;
  /** Omit to print a static page (the pre-match team sheet has nothing to select). */
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  /** Just came on / just scored — one beat of emphasis. */
  flashIds?: readonly string[];
  /** Full time: the page becomes a record rather than a control. */
  frozen?: boolean;
}

/** What a screen reader hears instead of a sticker: everything the page says, in words. */
function describe(p: AlbumPlayer): string {
  const parts: string[] = [p.name];
  if (p.slot !== null) parts.push(slotFullName(p.slot));
  if (p.note === undefined) {
    const played = Math.round(p.secondsOnField / 60);
    parts.push(`${played} minute${played === 1 ? "" : "s"} played`);
  }
  if (p.locked) parts.push("kept on");
  if (p.status !== null) parts.push(STATUS_META[p.status].label.toLowerCase());
  return parts.join(", ");
}

/**
 * How close two stickers on the same line can stand, as a share of the page's width, before they
 * print over one another. A mini sticker runs to about a fifth of a phone's page — twin
 * centre-backs or a double pivot collide — so the second of any tight pair sticks a step HIGHER,
 * the way an album owner staggers a crowded row. Above rather than below because below is where
 * the next line back stands.
 */
const TIGHT_GAP_PERCENT = 22;

/** Ids whose sticker steps up. Walks each line left→right, keeping a sticker on the default row
 * only when it clears the last one that stayed there — so a fanned line of any size alternates
 * cleanly, and a roomy line is left alone. */
function steppedUp(placed: { p: AlbumPlayer; at: SurfacePoint }[]): Set<string> {
  const lines = new Map<number, { id: string; x: number }[]>();
  for (const { p, at } of placed) {
    const key = Math.round(at.y);
    lines.set(key, [...(lines.get(key) ?? []), { id: p.id, x: at.x }]);
  }
  const up = new Set<string>();
  for (const line of lines.values()) {
    let lastOnRow: number | null = null;
    for (const t of [...line].sort((a, b) => a.x - b.x)) {
      if (lastOnRow !== null && t.x - lastOnRow < TIGHT_GAP_PERCENT) up.add(t.id);
      else lastOnRow = t.x;
    }
  }
  return up;
}

/** White chalk, attacking up: border, halfway line, centre circle, both boxes. */
function PitchLines() {
  return (
    <g>
      <rect x="4" y="3" width="92" height="86" rx="1" />
      <line x1="4" y1="46" x2="96" y2="46" />
      <circle cx="50" cy="46" r="10" />
      {/* attacking end */}
      <rect x="28" y="3" width="44" height="14" />
      <rect x="38" y="3" width="24" height="6" />
      {/* our end */}
      <rect x="28" y="75" width="44" height="14" />
      <rect x="38" y="83" width="24" height="6" />
    </g>
  );
}

/** The standard half-court coaching diagram: key, free-throw circle, three-point line, rim. */
function CourtLines() {
  return (
    <g>
      <rect x="3" y="3" width="94" height="126" />
      {/* half of the centre circle, on the half-court line */}
      <path d="M 38 3 A 12 12 0 0 0 62 3" />
      {/* three-point line: corner straights into the arc */}
      <path d="M 10 129 L 10 103 C 10 56, 90 56, 90 103 L 90 129" />
      {/* the key */}
      <rect x="33" y="91" width="34" height="38" />
      {/* free-throw circle: solid towards the basket, dashed behind it */}
      <path d="M 38 91 A 12 12 0 0 1 62 91" />
      <path d="M 38 91 A 12 12 0 0 0 62 91" strokeDasharray="3 2.6" />
      {/* backboard, rim, restricted area */}
      <line x1="43" y1="123" x2="57" y2="123" strokeWidth="1" />
      <circle cx="50" cy="119.4" r="2.4" />
      <path d="M 42 123 C 42 113, 58 113, 58 123" />
    </g>
  );
}

export function AlbumPitch({
  surface,
  players,
  caption,
  legend = true,
  onSelect,
  selectedId = null,
  flashIds,
  frozen = false,
}: AlbumPitchProps) {
  const isCourt = surface === "court";
  const layout = (isCourt ? courtLayout : pitchLayout)(players.map((p) => ({ id: p.id, slot: p.slot })));
  const fallback: SurfacePoint = isCourt ? { x: 50, y: 55 } : { x: 50, y: 42 };
  const flashed = new Set(flashIds ?? []);

  // Paint back→front, then left→right: the order a team sheet is read, so the keyboard walks the
  // page the way a coach does — and where two stickers must overlap in a crowded line, the
  // right-hand one consistently sits over the left rather than flickering between renders.
  const placed = players
    .map((p) => ({ p, at: layout.get(p.id) ?? fallback }))
    .sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x || (a.p.id < b.p.id ? -1 : 1));
  const up = steppedUp(placed);

  const sticker = (p: AlbumPlayer): ReactNode => (
    <PlayerSticker
      playerId={p.id}
      name={p.name}
      seconds={p.secondsOnField}
      status={p.status}
      gk={p.slot === "GK"}
      size="mini"
      scoreMark={p.scoreMark}
      locked={p.locked}
      footer={p.note}
      tiltDeg={tilt(p.id, 2)}
      className={cx(ap.mini, p.flagged && ap.miniFlagged, flashed.has(p.id) && ap.miniFlash)}
    />
  );

  return (
    <figure className={ap.figure}>
      <div className={ap.frame}>
        <div className={cx(ap.surface, isCourt ? ap.court : ap.pitch)}>
          {!isCourt && <div className={ap.mowing} aria-hidden />}
          <svg
            viewBox={isCourt ? "0 0 100 132" : "0 0 100 92"}
            preserveAspectRatio="none"
            className={ap.lines}
            fill="none"
            stroke={isCourt ? "rgba(255,250,235,.7)" : "rgba(255,255,255,.55)"}
            strokeWidth="0.5"
            aria-hidden
          >
            {isCourt ? <CourtLines /> : <PitchLines />}
          </svg>

          {placed.map(({ p, at }) => {
            const style = { left: `${at.x}%`, top: `${at.y}%` };
            const cls = cx(ap.token, up.has(p.id) && ap.tokenUp, selectedId === p.id && ap.tokenSel);
            return onSelect ? (
              <button
                key={p.id}
                type="button"
                style={style}
                disabled={frozen}
                className={cx(cls, ap.tokenBtn)}
                aria-pressed={selectedId === p.id}
                aria-label={describe(p)}
                onClick={() => onSelect(p.id)}
              >
                {sticker(p)}
              </button>
            ) : (
              <div key={p.id} style={style} className={cls}>
                {sticker(p)}
              </div>
            );
          })}
        </div>
      </div>
      {(caption !== undefined || legend) && (
        <figcaption className={ap.captionRow}>
          <span className={ap.captionLeft}>{caption}</span>
          {legend && (
            <span className={ap.legend} aria-hidden>
              <span className={ap.legendUnder}>▲</span> needs · <span className={ap.legendOn}>✓</span> on
              target · <span className={ap.legendOver}>▼</span> rest
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
