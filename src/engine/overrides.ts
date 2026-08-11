/**
 * Manager overrides (PRD §7.6) — first-class, and **always advisory in the sense that the engine
 * recalculates AROUND the coach's choice; it never overrides the coach** (CLAUDE.md invariants
 * #2, #3). In-match overrides (lock/keep-on, pin, snooze, rest-now) are produced as append-only
 * {@link MatchEvent}s so they flow through the same reducer (undo + crash recovery). Roster-level
 * overrides (reduced-minutes, must-start) are pure transforms on the Player record. Pure & no I/O.
 */
import { SECONDS_PER_MINUTE } from "./constants";
import { invariant } from "./errors";
import { positionFit } from "./positions";
import { benchEligibleNow } from "./candidates";
import { debtMap } from "./fairness";
import { onFieldIds } from "./liveState";
import { planFromState } from "./plan";
import type {
  LiveState,
  Match,
  MatchEvent,
  Player,
  PlayerLiveState,
  PositionSlot,
} from "./types";
import { byDesc, indexPlayers } from "./util";

// ── In-match overrides → events ─────────────────────────────────────────────

/**
 * Key player / keep-on (§7.6): a locked player is never suggested OFF; the engine fairly
 * distributes the remaining minutes around them. `locked: false` releases the player.
 */
export function keepPlayerOn(playerId: string, atSeconds: number, locked = true): MatchEvent {
  return { type: "PLAYER_LOCKED", atSeconds, playerId, locked };
}

/** Pin a player to a slot — the engine won't move them. `slot: null` unpins. */
export function pinPlayer(playerId: string, atSeconds: number, slot: PositionSlot | null): MatchEvent {
  return { type: "PLAYER_PINNED", atSeconds, playerId, slot };
}

/** Snooze the next suggested sub by `minutes` (recalc pushes the next window past this). */
export function snoozeNextSub(atSeconds: number, minutes: number): MatchEvent {
  invariant(minutes > 0, "snooze minutes must be > 0", { minutes });
  return { type: "SNOOZE_SET", atSeconds, untilSeconds: atSeconds + minutes * SECONDS_PER_MINUTE };
}

/**
 * Rest now / bench (§7.6): force a player off and (when a bench is available) bring on the best
 * fairness+fit replacement for the vacated slot. Returns the {@link MatchEvent} to append; the
 * caller recalculates afterwards. Does NOT count as the incoming player's "turn" any differently —
 * the engine simply re-balances from the resulting state.
 */
export function restPlayerNow(
  match: Match,
  players: Player[],
  liveState: LiveState,
  playerId: string,
  atSeconds: number,
): MatchEvent {
  const byId = indexPlayers(players);
  const ps = liveState.players[playerId];
  invariant(ps !== undefined, "rest-now references a player not in the squad", { playerId });
  invariant(ps.onField, "rest-now target is not on the field", { playerId });
  const vacated = ps.currentSlot;
  const debts = debtMap(match, players, liveState);

  const replacement = benchEligibleNow(match, byId, liveState, atSeconds)
    .filter((b) => vacated === null || positionFit(byId.get(b.playerId) as Player, vacated) > 0)
    .sort(byDesc((b) => debts.get(b.playerId) ?? 0, (b) => b.playerId))[0];

  if (replacement && vacated !== null) {
    return {
      type: "SUB_APPLIED",
      atSeconds,
      off: [playerId],
      on: [{ playerId: replacement.playerId, slot: vacated }],
      positionChanges: [],
    };
  }
  // No eligible bench replacement — the player still comes off (team plays short; coach's call).
  return { type: "SUB_APPLIED", atSeconds, off: [playerId], on: [], positionChanges: [] };
}

// ── Roster-level overrides → pure Player transforms ─────────────────────────

/** Reduced minutes (§7.6): scale the fairness target down. Returns a NEW Player (additive). */
export function setReducedMinutes(player: Player, minutesWeight: number): Player {
  invariant(
    minutesWeight >= 0 && minutesWeight <= 1,
    "minutesWeight must be within [0, 1]",
    { minutesWeight },
  );
  return { ...player, minutesWeight };
}

/** Must-start (§7.6): guarantee the player in the starting lineup. Returns a NEW Player. */
export function setMustStart(player: Player, mustStart: boolean): Player {
  return { ...player, mustStart };
}

// ── Override transparency (§7.6) ────────────────────────────────────────────

/**
 * A gentle, non-blocking note when honouring constraints makes equal time impossible — e.g.
 * "Locking Sofia on means Oliver will finish ~3 min short." Returns "" when fairness is still
 * achievable or no lock is responsible. Never blocks the coach (CLAUDE.md invariant #2).
 */
export function overrideTradeoffNote(match: Match, players: Player[], liveState: LiveState): string {
  const plan = planFromState(match, players, liveState);
  if (!plan.toleranceInfeasible) return "";

  const byId = indexPlayers(players);
  const lockedNames = onFieldIds(liveState)
    .map((id) => liveState.players[id])
    .filter((ps): ps is PlayerLiveState => ps !== undefined && ps.locked)
    .map((ps) => byId.get(ps.playerId)?.name)
    .filter((n): n is string => n !== undefined);

  if (lockedNames.length === 0) return ""; // infeasible, but not because of a lock

  // The most under-played player at full time is the one who finishes short.
  const tolSec = match.fairnessToleranceMinutes * SECONDS_PER_MINUTE;
  const shortest = Object.entries(plan.predictedFinalDebtSeconds)
    .filter(([id]) => byId.has(id))
    .sort(byDesc(([, d]) => d, ([id]) => id))[0];
  if (!shortest) return "";
  const [shortId, shortDebt] = shortest;
  if (shortDebt <= tolSec) return "";

  const shortName = byId.get(shortId)?.name ?? shortId;
  const shortMin = Math.round(shortDebt / SECONDS_PER_MINUTE);
  const lockedLabel =
    lockedNames.length === 1 ? lockedNames[0] : `${lockedNames.slice(0, -1).join(", ")} and ${lockedNames.at(-1) ?? ""}`;
  return `Keeping ${lockedLabel} on means ${shortName} will finish ~${shortMin} min short.`;
}
