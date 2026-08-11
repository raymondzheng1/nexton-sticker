/**
 * Position taxonomy + position-fit scoring (PRD §6.1, §7.4).
 * Pure, deterministic, no I/O.
 */
import type { Player, PositionGroup, PositionSlot } from "./types";

/** Every slot mapped to its group. The single source of truth for the taxonomy. */
const SLOT_TO_GROUP: Record<PositionSlot, PositionGroup> = {
  // Football
  GK: "GK",
  DL: "DEF",
  DC: "DEF",
  DR: "DEF",
  DM: "MID",
  ML: "MID",
  MC: "MID",
  MR: "MID",
  AM: "MID",
  FL: "FWD",
  FC: "FWD",
  FR: "FWD",
  // Basketball (PG/SG → guards, SF/PF → forwards, C → center)
  PG: "G",
  SG: "G",
  SF: "F",
  PF: "F",
  C: "C",
};

export const ALL_SLOTS = Object.keys(SLOT_TO_GROUP) as PositionSlot[];
export const ALL_GROUPS: PositionGroup[] = ["GK", "DEF", "MID", "FWD", "G", "F", "C"];

/**
 * Group ordering used for adjacency. Each sport's groups are CONTIGUOUS, so within-sport adjacency
 * is correct (GK↔DEF↔MID↔FWD; G↔F↔C) while cross-sport neighbours (e.g. FWD↔G) are never queried —
 * a match only ever contains one sport's slots.
 */
const GROUP_ORDER: PositionGroup[] = ["GK", "DEF", "MID", "FWD", "G", "F", "C"];

export function groupOf(slot: PositionSlot): PositionGroup {
  return SLOT_TO_GROUP[slot];
}

export function slotsForGroup(group: PositionGroup): PositionSlot[] {
  return ALL_SLOTS.filter((s) => SLOT_TO_GROUP[s] === group);
}

/**
 * Horizontal column of a slot for pitch layout: 0 = left, 1 = centre, 2 = right. Drives left→right
 * ordering within a line so a centre player (e.g. MC) isn't drawn out on the wing.
 */
export function columnOf(slot: PositionSlot): 0 | 1 | 2 {
  // Basketball (no L/R suffix): PG + SF on the left, SG + PF on the right, C central.
  if (slot === "PG" || slot === "SF") return 0;
  if (slot === "SG" || slot === "PF") return 2;
  if (slot === "C") return 1;
  if (slot.endsWith("L")) return 0; // DL, ML, FL
  if (slot.endsWith("R")) return 2; // DR, MR, FR
  return 1; // GK, DC, DM, MC, AM, FC — central
}

/** True when two groups are neighbours in {@link GROUP_ORDER} (acceptable, not ideal, fit). */
export function groupsAdjacent(a: PositionGroup, b: PositionGroup): boolean {
  return Math.abs(GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)) === 1;
}

function isGroup(token: PositionSlot | PositionGroup): token is PositionGroup {
  return (ALL_GROUPS as string[]).includes(token);
}

/** Can the player play this exact slot (either the slot itself, or its group, is in `tokens`)? */
function tokensCoverSlot(tokens: (PositionSlot | PositionGroup)[], slot: PositionSlot): boolean {
  const g = groupOf(slot);
  return tokens.some((t) => (isGroup(t) ? t === g : t === slot));
}

/** Does the player list any eligibility in this group at all? */
function eligibleInGroup(player: Player, group: PositionGroup): boolean {
  return player.eligiblePositions.some((t) => (isGroup(t) ? t === group : groupOf(t) === group));
}

/** Index of the slot in the player's preference order, or -1 (group match counts). */
function preferenceIndex(player: Player, slot: PositionSlot): number {
  const g = groupOf(slot);
  return player.preferredPositions.findIndex((t) => (isGroup(t) ? t === g : t === slot));
}

const SIDE_COLUMN: Record<"left" | "centre" | "right", 0 | 1 | 2> = { left: 0, centre: 1, right: 2 };

/**
 * Side-preference adjustment for a slot: on the player's side +0.10, one column off (wing↔centre)
 * −0.05, opposite wing −0.12. Small enough that it never crosses fit tiers (same-group still beats
 * adjacent-group) — it only picks the right flank WITHIN a line.
 */
function sideDelta(player: Player, slot: PositionSlot): number {
  if (!player.preferredSide) return 0;
  const diff = Math.abs(SIDE_COLUMN[player.preferredSide] - columnOf(slot));
  return diff === 0 ? 0.1 : diff === 2 ? -0.12 : -0.05;
}

/** Base fit by eligibility/preference tier (before any side-preference refinement). */
function baseOutfieldFit(player: Player, slot: PositionSlot, group: PositionGroup): number {
  const prefIdx = preferenceIndex(player, slot);
  if (prefIdx >= 0) {
    // Top preference → 1.0, decaying gently for later preferences but never below 0.9.
    return Math.max(0.9, 1 - prefIdx * 0.02);
  }
  if (tokensCoverSlot(player.eligiblePositions, slot)) return 0.85;
  if (eligibleInGroup(player, group)) return 0.65;

  // Adjacent-group eligibility (e.g. a DEF asked to play MID).
  const adjacent = ALL_GROUPS.some(
    (other) => other !== group && groupsAdjacent(other, group) && eligibleInGroup(player, other),
  );
  if (adjacent) return 0.4;

  return 0.1;
}

/**
 * Position fit of a player for a slot, in [0, 1] (PRD §7.4):
 *   preferred exact ≥ 0.9 (boosted toward 1.0 for higher preference) · eligible exact 0.85 ·
 *   eligible same-group 0.65 · adjacent group 0.4 · otherwise 0.1.
 * A GK slot is only fillable by a `canPlayGK` player (else fit = 0). When the player has a side
 * preference, the column is refined (left-back → DL not DR) WITHIN lines they can already play —
 * the low "can flex" fallback (0.1) is left untouched so a short squad can still fill every slot.
 */
export function positionFit(player: Player, slot: PositionSlot): number {
  const g = groupOf(slot);
  if (g === "GK") return player.canPlayGK ? 1 : 0;

  const base = baseOutfieldFit(player, slot, g);
  if (base < 0.4) return base;
  return Math.max(0, Math.min(1, base + sideDelta(player, slot)));
}

/** Can this player fill this slot at all (GK gating respected; everyone else can flex, low fit)? */
export function canFillSlot(player: Player, slot: PositionSlot): boolean {
  return positionFit(player, slot) > 0;
}
