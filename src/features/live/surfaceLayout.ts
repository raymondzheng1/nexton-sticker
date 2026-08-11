/**
 * Slot-anchored token layout for both playing surfaces (pure — testable without the components).
 * Shared by the live Pitch/Court, the plan preview, and the lineup editor's drag board, so a
 * formation looks identical everywhere. Nothing assumes a particular on-field count: positions
 * derive from the SLOTS present, and duplicate slots fan out around their anchor.
 */
import { columnOf, groupOf, type PositionSlot } from "@/engine";

export interface SurfacePoint {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ── Basketball half-court ────────────────────────────────────────────────────

/**
 * Conventional half-court position spots (best-practice basketball diagram, in container %):
 * 1 PG at the point (top of the key), 2 SG right wing, 3 SF left wing, 4 PF left low block,
 * 5 C right low block by the paint. Bigger formats fan duplicate slots out around their anchor
 * (`fan` axis).
 */
const COURT_SPOTS: Record<string, { x: number; y: number; fan: "x" | "y" }> = {
  PG: { x: 50, y: 38, fan: "x" },
  SG: { x: 78, y: 55, fan: "y" },
  SF: { x: 22, y: 55, fan: "y" },
  PF: { x: 30, y: 76, fan: "x" },
  C: { x: 70, y: 76, fan: "x" },
};

/** Place court entries on their slot's conventional spot; duplicates fan along the slot's axis. */
export function courtLayout(entries: { id: string; slot: string | null }[]): Map<string, SurfacePoint> {
  const bySlot = new Map<string, string[]>();
  for (const e of entries) {
    const key = e.slot ?? "?";
    bySlot.set(key, [...(bySlot.get(key) ?? []), e.id]);
  }
  const out = new Map<string, SurfacePoint>();
  for (const [slot, ids] of bySlot) {
    const anchor = COURT_SPOTS[slot] ?? { x: 50, y: 55, fan: "x" as const };
    ids.forEach((id, i) => {
      const offset = (i - (ids.length - 1) / 2) * (anchor.fan === "x" ? 15 : 13);
      out.set(id, {
        x: clamp(anchor.x + (anchor.fan === "x" ? offset : 0), 10, 90),
        y: clamp(anchor.y + (anchor.fan === "y" ? offset : 0), 14, 84),
      });
    });
  }
  return out;
}

// ── Football pitch ───────────────────────────────────────────────────────────

/** Vertical band of a football slot, back→front: DEF · CDM · MID · CAM · FWD. */
function pitchBandOf(slot: PositionSlot): number {
  if (slot === "DM") return 1;
  if (slot === "AM") return 3;
  const g = groupOf(slot);
  return g === "DEF" ? 0 : g === "FWD" ? 4 : 2;
}

/** Column anchors (container %): left flank, centre, right flank. */
const PITCH_COLUMN_X: Record<0 | 1 | 2, number> = { 0: 22, 1: 50, 2: 78 };

/**
 * Slot-anchored football layout (the conventional formation diagram):
 *  - columns anchor to the flanks/centre (DL hugs the left touchline, MC is central, …);
 *  - duplicate slots in a column fan out (two DCs straddle the middle, a double pivot splits);
 *  - a 2-man DEF/FWD line with an empty centre (front two, centre-back pair) sits NARROWER than
 *    true wingers — wide-mid pairs (e.g. ML+MR flanking a CAM) stay wide;
 *  - occupied bands spread evenly back→front (empty bands collapse), GK by the goal.
 * y grows toward our own goal (GK 82%); the front line sits at 14%.
 */
export function pitchLayout(entries: { id: string; slot: string | null }[]): Map<string, SurfacePoint> {
  const out = new Map<string, SurfacePoint>();
  const outfield: { id: string; slot: PositionSlot }[] = [];
  for (const e of entries) {
    const slot = (e.slot ?? null) as PositionSlot | null;
    if (slot === "GK") out.set(e.id, { x: 50, y: 82 });
    else if (slot === null) out.set(e.id, { x: 50, y: 42 });
    else outfield.push({ id: e.id, slot });
  }

  const bands = [...new Set(outfield.map((o) => pitchBandOf(o.slot)))].sort((a, b) => a - b);
  const yFor = (band: number): number => {
    const i = bands.indexOf(band);
    return bands.length === 1 ? 42 : 14 + ((66 - 14) * (bands.length - 1 - i)) / (bands.length - 1);
  };

  for (const band of bands) {
    const inBand = outfield
      .filter((o) => pitchBandOf(o.slot) === band)
      .sort((a, b) => columnOf(a.slot) - columnOf(b.slot) || (a.id < b.id ? -1 : 1));
    const y = yFor(band);
    const byCol: Record<0 | 1 | 2, { id: string }[]> = { 0: [], 1: [], 2: [] };
    for (const o of inBand) byCol[columnOf(o.slot)].push(o);
    const narrowPair = inBand.length === 2 && byCol[1].length === 0 && (band === 0 || band === 4);
    for (const col of [0, 1, 2] as const) {
      const group = byCol[col];
      const anchor = narrowPair ? (col === 0 ? 34 : 66) : PITCH_COLUMN_X[col];
      group.forEach((o, i) => {
        out.set(o.id, { x: clamp(anchor + (i - (group.length - 1) / 2) * 14, 8, 92), y });
      });
    }
  }
  return out;
}
