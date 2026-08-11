/**
 * Pure presentation helpers shared by the teams index, the team hub and the squad editor — the
 * formatting the Back Page kept inline, hoisted so the album's two match lists can never drift.
 * No IO, no store: data in, strings out.
 */
import type { Player } from "@/engine";
import type { SavedMatch } from "@/store/schema";
import type { SportConfig } from "@/features/sports";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed format, not a locale one: the list is client-rendered from IndexedDB and must not drift. */
export function dateline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${DAYS[d.getDay()] ?? ""} ${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()] ?? ""}`;
}

/** Our points on the day, from the log. Football goals are worth 1; basketball scores carry theirs. */
export function pointsOf(m: SavedMatch): number {
  let total = 0;
  for (const e of m.events) if (e.type === "GOAL_SCORED") total += e.points ?? 1;
  return total;
}

/**
 * The word beside a non-live match row. Live matches get the red LIVE pill instead — a pill is
 * chrome, not a word, so it stays in the component. Completed takes the sport's own full-time noun.
 */
export function statusWord(status: SavedMatch["status"], cfg: SportConfig): string {
  return status === "completed" ? cfg.endLabel : "To come";
}

/**
 * A player's whole position summary in one string — keeper, then each eligible line's chip text —
 * or "Any position" when nothing is set. The squad editor's row tag and the hub's sticker footers
 * both print exactly this, so what the coach set and what the album shows are the same words.
 */
export function positionTag(p: Player, cfg: SportConfig): string {
  const parts: string[] = [];
  if (cfg.hasGoalkeeper && p.canPlayGK) parts.push("🧤 Keeper");
  for (const g of cfg.positionGroups) {
    if (p.eligiblePositions.includes(g.value)) parts.push(g.chip);
  }
  return parts.length > 0 ? parts.join(" · ") : "Any position";
}
