/**
 * Pure helpers for the drag-and-drop lineup editor (PRD §8.2). Kept UI-free so the swap logic is
 * unit-testable; the React component handles the pointer plumbing.
 */
import { isStartableAtKickoff, positionFit, type LineupAssignment, type Player } from "@/engine";

/** Available players not currently in the starting XI. */
export function benchFor(players: Player[], assignment: LineupAssignment[]): Player[] {
  const onField = new Set(assignment.map((a) => a.playerId));
  return players.filter((p) => !onField.has(p.id));
}

/**
 * Resolve a drag of `sourceId` onto `targetId` into a new assignment:
 *  - both on the field → swap their slots,
 *  - bench → field player → the bench player takes that slot (the field player drops to the bench),
 *  - field → bench player → same swap the other way.
 * Slots are preserved; only who fills them changes. positionFit is recomputed. Pure (no mutation of
 * the input array).
 *
 * A bench player who can't start (marked 🕑 arrives-late or unavailable) is never moved INTO a slot
 * — the drag is refused (assignment returned unchanged); the editor explains why.
 */
export function applyLineupDrag(
  assignment: LineupAssignment[],
  players: Player[],
  sourceId: string,
  targetId: string,
): LineupAssignment[] {
  if (sourceId === targetId) return assignment;
  const byId = new Map(players.map((p) => [p.id, p]));
  const onField = new Set(assignment.map((a) => a.playerId));
  for (const id of [sourceId, targetId]) {
    const p = byId.get(id);
    if (!onField.has(id) && p && !isStartableAtKickoff(p)) return assignment;
  }
  const fit = (playerId: string, slot: LineupAssignment["slot"]): number => {
    const p = byId.get(playerId);
    return p ? positionFit(p, slot) : 0;
  };

  const next = assignment.map((a) => ({ ...a }));
  const sEntry = next.find((a) => a.playerId === sourceId);
  const tEntry = next.find((a) => a.playerId === targetId);

  if (sEntry && tEntry) {
    const sSlot = sEntry.slot;
    const tSlot = tEntry.slot;
    sEntry.playerId = targetId;
    sEntry.positionFit = fit(targetId, sSlot);
    tEntry.playerId = sourceId;
    tEntry.positionFit = fit(sourceId, tSlot);
  } else if (sEntry && !tEntry) {
    // dragged an on-field player onto a bench player → bench player takes the slot
    sEntry.playerId = targetId;
    sEntry.positionFit = fit(targetId, sEntry.slot);
  } else if (!sEntry && tEntry) {
    // dragged a bench player onto an on-field player → bench player takes the slot
    tEntry.playerId = sourceId;
    tEntry.positionFit = fit(sourceId, tEntry.slot);
  }
  return next;
}
