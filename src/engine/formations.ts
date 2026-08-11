/**
 * Formation library + generator (PRD §6.1). Keyed by on-field count; for any count with no
 * curated entry, a balanced formation is generated. **This file is the source of truth for
 * formation shapes** — every returned formation's `slots.length` equals its `onFieldCount`
 * (CLAUDE.md invariant #1). Pure, deterministic, no I/O.
 */
import { EngineError, invariant } from "./errors";
import type { Formation, FormationStyle, PositionSlot, Sport } from "./types";

/**
 * Basketball lineup for `n` on court: distribute across guards / forwards / centre (≥1 centre for
 * n ≥ 3). Returns explicit PG/SG/SF/PF/C slots — there's little formation variety in basketball, so
 * this single shape is the curated default. Name is the G-F-C count (e.g. "2-2-1" for 5).
 */
function buildBasketballFormation(onFieldCount: number): Formation {
  assertValidCount(onFieldCount);
  const n = onFieldCount;
  const centre = n >= 3 ? 1 : n >= 1 ? 0 : 0;
  const guards = Math.min(n - centre, Math.max(0, Math.round((n - centre) / 2)));
  const forwards = n - centre - guards;
  const slots: PositionSlot[] = [];
  for (let i = 0; i < guards; i++) slots.push(i === 0 ? "PG" : "SG");
  for (let i = 0; i < forwards; i++) slots.push(i === 0 ? "SF" : "PF");
  for (let i = 0; i < centre; i++) slots.push("C");
  invariant(slots.length === n, "basketball formation slot count must equal onFieldCount", {
    onFieldCount,
    produced: slots.length,
  });
  return { id: `bball-${n}`, name: `${guards}-${forwards}-${centre}`, onFieldCount: n, slots, generated: true };
}

/** Center-out slot builder for one football line of a given group. Handles any size ≥ 0. */
function buildLine(group: "DEF" | "MID" | "FWD", size: number): PositionSlot[] {
  if (size <= 0) return [];
  const triple: Record<"DEF" | "MID" | "FWD", [PositionSlot, PositionSlot, PositionSlot]> = {
    DEF: ["DL", "DC", "DR"],
    MID: ["ML", "MC", "MR"],
    FWD: ["FL", "FC", "FR"],
  };
  const [left, center, right] = triple[group];
  if (size === 1) return [center];
  return [left, ...Array<PositionSlot>(size - 2).fill(center), right];
}

interface Shape {
  name: string;
  /** [defenders, midfielders, forwards]; sums to onFieldCount − 1 (GK is implicit). */
  lines?: [number, number, number];
  /**
   * Explicit slot list (including GK) — overrides `lines`. Lets a curated formation use the vertical
   * midfield roles CDM (`DM`) / CAM (`AM`) that the flat [def, mid, fwd] model can't express.
   */
  slots?: PositionSlot[];
}

/** Assemble a validated {@link Formation} from a [def, mid, fwd] shape or an explicit slot list. */
function buildFormation(onFieldCount: number, shape: Shape, generated: boolean): Formation {
  let slots: PositionSlot[];
  let id: string;
  if (shape.slots) {
    slots = shape.slots;
    id = `${generated ? "gen-" : ""}${onFieldCount}-${shape.name}`;
  } else {
    const [def, mid, fwd] = shape.lines ?? [0, 0, 0];
    slots = ["GK", ...buildLine("DEF", def), ...buildLine("MID", mid), ...buildLine("FWD", fwd)];
    id = `${generated ? "gen-" : ""}${onFieldCount}-${def}-${mid}-${fwd}`;
  }
  invariant(slots.length === onFieldCount, "formation slot count must equal onFieldCount", {
    onFieldCount,
    shape: shape.name,
    produced: slots.length,
  });
  return { id, name: shape.name, onFieldCount, slots, generated };
}

/**
 * Curated formations keyed by on-field count. The first entry is the auto-pick default.
 * PRD-specified defaults included: 7v7 → 2-3-1, 10v10 → 3-3-3.
 */
const CURATED: Record<number, Shape[]> = {
  3: [{ name: "1-1", lines: [1, 0, 1] }],
  4: [{ name: "1-1-1", lines: [1, 1, 1] }],
  5: [
    { name: "2-1-1", lines: [2, 1, 1] },
    { name: "1-2-1", lines: [1, 2, 1] },
    { name: "2-2", lines: [2, 2, 0] },
  ],
  6: [
    { name: "2-2-1", lines: [2, 2, 1] },
    { name: "3-1-1", lines: [3, 1, 1] },
  ],
  7: [
    { name: "2-3-1", lines: [2, 3, 1] },
    { name: "3-2-1", lines: [3, 2, 1] },
    { name: "2-2-2", lines: [2, 2, 2] },
    { name: "2-1-2-1", slots: ["GK", "DL", "DR", "DM", "ML", "MR", "FC"] }, // holding CDM
  ],
  8: [
    { name: "3-3-1", lines: [3, 3, 1] },
    { name: "3-2-2", lines: [3, 2, 2] },
  ],
  9: [
    { name: "3-3-2", lines: [3, 3, 2] },
    { name: "3-2-3", lines: [3, 2, 3] },
    { name: "3-4-1", lines: [3, 4, 1] },
    { name: "3-3-1-1", slots: ["GK", "DL", "DC", "DR", "ML", "MC", "MR", "AM", "FC"] }, // CAM behind ST
  ],
  10: [
    { name: "3-3-3", lines: [3, 3, 3] },
    { name: "3-4-2", lines: [3, 4, 2] },
    { name: "4-3-2", lines: [4, 3, 2] },
  ],
  11: [
    { name: "4-4-2", lines: [4, 4, 2] },
    { name: "4-3-3", lines: [4, 3, 3] },
    { name: "3-5-2", lines: [3, 5, 2] },
    { name: "4-2-3-1", slots: ["GK", "DL", "DC", "DC", "DR", "DM", "DM", "ML", "AM", "MR", "FC"] }, // double pivot + CAM
    { name: "4-3-1-2", slots: ["GK", "DL", "DC", "DC", "DR", "ML", "MC", "MR", "AM", "FL", "FR"] }, // CAM behind two
  ],
};

function assertValidCount(onFieldCount: number): void {
  invariant(
    Number.isInteger(onFieldCount) && onFieldCount >= 1,
    "onFieldCount must be an integer ≥ 1",
    { onFieldCount },
  );
}

/**
 * Generate a balanced formation for ANY on-field count (PRD §6.1 — flexible format). Distributes
 * the (onFieldCount − 1) outfield players across DEF/MID/FWD as evenly as possible, with the
 * midfield absorbing the remainder. Always includes exactly one GK.
 */
export function generateFormation(onFieldCount: number): Formation {
  assertValidCount(onFieldCount);
  const outfield = onFieldCount - 1;
  const def = Math.round(outfield / 3);
  const fwd = Math.floor(outfield / 3);
  const mid = outfield - def - fwd;
  return buildFormation(onFieldCount, { name: `${def}-${mid}-${fwd}`, lines: [def, mid, fwd] }, true);
}

/**
 * Build a custom formation from explicit line counts [def, mid, fwd] plus OPTIONAL vertical
 * midfield roles (PRD §6.1 custom builder): `roles.dm` holding mids (CDM) between the defence and
 * the midfield, `roles.am` attacking mids (CAM) between the midfield and the attack. All lines
 * together must sum to onFieldCount − 1 (the GK is implicit); throws otherwise.
 */
export function buildCustomFormation(
  onFieldCount: number,
  lines: [number, number, number],
  roles: { dm?: number; am?: number } = {},
): Formation {
  assertValidCount(onFieldCount);
  const [def, mid, fwd] = lines;
  const dm = roles.dm ?? 0;
  const am = roles.am ?? 0;
  invariant(
    [def, mid, fwd, dm, am].every((n) => Number.isInteger(n) && n >= 0),
    "formation line counts must be non-negative integers",
    { lines, roles },
  );
  invariant(
    def + dm + mid + am + fwd === onFieldCount - 1,
    "formation lines (def+cdm+mid+cam+fwd) must equal onFieldCount − 1 (GK is implicit)",
    { onFieldCount, lines, roles, sum: def + dm + mid + am + fwd },
  );
  const name = [def, ...(dm > 0 ? [dm] : []), mid, ...(am > 0 ? [am] : []), fwd].join("-");
  if (dm === 0 && am === 0) {
    return buildFormation(onFieldCount, { name, lines }, true);
  }
  const slots: PositionSlot[] = [
    "GK",
    ...buildLine("DEF", def),
    ...Array<PositionSlot>(dm).fill("DM"),
    ...buildLine("MID", mid),
    ...Array<PositionSlot>(am).fill("AM"),
    ...buildLine("FWD", fwd),
  ];
  return buildFormation(onFieldCount, { name, slots }, true);
}

/**
 * Suggest a formation shape for a tactical style (PRD §6.1 — "the big picture"). Distributes the
 * (onFieldCount − 1) outfield players with a defensive/attacking bias; "balanced" matches
 * {@link generateFormation}. Always one GK; lines always sum correctly.
 */
export function styleFormation(onFieldCount: number, style: FormationStyle): Formation {
  assertValidCount(onFieldCount);
  if (style === "balanced") return generateFormation(onFieldCount);

  const outfield = onFieldCount - 1;
  const ratios: Record<Exclude<FormationStyle, "balanced">, { def: number; fwd: number }> = {
    defensive: { def: 0.45, fwd: 0.2 },
    attacking: { def: 0.28, fwd: 0.42 },
    aggressive: { def: 0.2, fwd: 0.5 },
  };
  const r = ratios[style];
  let def = Math.round(outfield * r.def);
  let fwd = Math.round(outfield * r.fwd);
  let mid = outfield - def - fwd;
  if (mid < 0) {
    // Over-allocated: trim forwards first, then defenders, so the lines stay valid.
    const over = -mid;
    fwd = Math.max(0, fwd - over);
    mid = outfield - def - fwd;
    if (mid < 0) {
      def = Math.max(0, def + mid);
      mid = outfield - def - fwd;
    }
  }
  return buildFormation(onFieldCount, { name: `${def}-${mid}-${fwd}`, lines: [def, mid, fwd] }, true);
}

/** All formation options for a count (curated, else a single generated one) — for the picker. */
export function listFormations(onFieldCount: number, sport: Sport = "football"): Formation[] {
  assertValidCount(onFieldCount);
  if (sport === "basketball") return [buildBasketballFormation(onFieldCount)];
  const curated = CURATED[onFieldCount];
  if (curated && curated.length > 0) {
    return curated.map((shape) => buildFormation(onFieldCount, shape, false));
  }
  return [generateFormation(onFieldCount)];
}

/**
 * Resolve a formation for a match. With `name`, returns that curated formation or throws (loud
 * failure with the available names). Without `name`, returns the curated default, or generates
 * one when no curated entry exists for the count.
 */
export function getFormation(onFieldCount: number, name?: string, sport: Sport = "football"): Formation {
  assertValidCount(onFieldCount);
  const options = listFormations(onFieldCount, sport);
  if (name === undefined) {
    // listFormations always returns at least one entry.
    return options[0] as Formation;
  }
  const match = options.find((f) => f.name === name);
  if (!match) {
    throw new EngineError("no formation with that name for this on-field count", {
      onFieldCount,
      requested: name,
      available: options.map((f) => f.name),
    });
  }
  return match;
}
