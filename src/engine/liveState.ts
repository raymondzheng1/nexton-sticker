/**
 * Live match state: an append-only event reducer + a single source-of-truth clock (PRD §6.5,
 * §8.3). Field time accrues ONLY while the clock runs; pauses freeze every stint timer. The whole
 * state is a pure fold over the event log, so it rebuilds exactly after a crash/kill (crash-safe
 * restore) and powers undo (drop the last event, refold). The engine never reads a clock — the
 * caller supplies elapsed deltas via TICK events.
 */
import { invariant } from "./errors";
import type {
  LiveState,
  Match,
  MatchEvent,
  Player,
  PlayerLiveState,
} from "./types";
import { getAvailablePlayers } from "./util";

/** Fresh pre-match live state: everyone off field, all timers at zero. */
export function initLiveState(match: Match, players: Player[]): LiveState {
  const available = getAvailablePlayers(match, players);
  const playersState: Record<string, PlayerLiveState> = {};
  for (const p of available) {
    playersState[p.id] = {
      playerId: p.id,
      onField: false,
      currentSlot: null,
      secondsOnField: 0,
      secondsAsGk: 0,
      secondsBySlot: {},
      secondsThisStint: 0,
      // Always-on players (not part of the rotation) start LOCKED — never planned/suggested off
      // (invariant #3). The coach can still Release them live.
      locked: p.alwaysOn === true,
      pinnedSlot: null,
      goals: 0,
      points: 0,
    };
  }
  return {
    status: "pre-match",
    period: 1,
    elapsedSeconds: 0,
    periodStartedAtSeconds: 0,
    players: playersState,
  };
}

function clonePlayer(p: PlayerLiveState): PlayerLiveState {
  // secondsBySlot is a nested object — copy it so applyEvent never mutates the input state.
  return { ...p, secondsBySlot: { ...p.secondsBySlot } };
}

function cloneState(s: LiveState): LiveState {
  const players: Record<string, PlayerLiveState> = {};
  for (const [id, ps] of Object.entries(s.players)) players[id] = clonePlayer(ps);
  return { ...s, players };
}

function requirePlayer(state: LiveState, playerId: string): PlayerLiveState {
  const ps = state.players[playerId];
  invariant(ps !== undefined, "event references a player not in the available squad", { playerId });
  return ps;
}

/**
 * Apply one event, returning a NEW state (immutable). The reducer is total and deterministic.
 * Unknown/out-of-phase events fail loudly rather than silently corrupting state.
 */
export function applyEvent(state: LiveState, event: MatchEvent): LiveState {
  const next = cloneState(state);

  switch (event.type) {
    case "MATCH_STARTED": {
      invariant(state.status === "pre-match", "MATCH_STARTED only valid from pre-match", {
        status: state.status,
      });
      next.status = "running";
      next.period = 1;
      next.elapsedSeconds = 0;
      next.periodStartedAtSeconds = 0; // period 1 starts at kickoff, by definition
      for (const a of event.lineup) {
        const ps = requirePlayer(next, a.playerId);
        ps.onField = true;
        ps.currentSlot = a.slot;
        ps.secondsThisStint = 0;
      }
      return next;
    }

    case "TICK": {
      invariant(event.deltaSeconds >= 0, "TICK deltaSeconds must be ≥ 0", {
        deltaSeconds: event.deltaSeconds,
      });
      // Time accrues only while running (PRD §8.3) — a TICK while paused/broken is a no-op.
      if (state.status !== "running") return next;
      next.elapsedSeconds = state.elapsedSeconds + event.deltaSeconds;
      for (const ps of Object.values(next.players)) {
        if (!ps.onField) continue;
        ps.secondsOnField += event.deltaSeconds;
        ps.secondsThisStint += event.deltaSeconds;
        if (ps.currentSlot === "GK") ps.secondsAsGk += event.deltaSeconds;
        // Per-position history (player performance reports): attribute the time to the slot held.
        if (ps.currentSlot !== null) {
          ps.secondsBySlot[ps.currentSlot] = (ps.secondsBySlot[ps.currentSlot] ?? 0) + event.deltaSeconds;
        }
      }
      return next;
    }

    case "CLOCK_PAUSED": {
      if (state.status === "running") next.status = "paused";
      return next;
    }

    case "CLOCK_RESUMED": {
      if (state.status === "paused" || state.status === "period-break") next.status = "running";
      return next;
    }

    case "PERIOD_ENDED": {
      next.status = "period-break";
      return next;
    }

    case "PERIOD_STARTED": {
      next.status = "running";
      next.period = event.period;
      // WHERE this period begins on the match clock — the anchor every "how far into the period are
      // we?" question is measured from. The coach may have ended the last one early, so this is not
      // necessarily (period − 1) × periodLength (see LiveState.periodStartedAtSeconds).
      next.periodStartedAtSeconds = event.atSeconds;
      // A new period is a fresh stint window (half-time rest resets just-subbed protection).
      for (const ps of Object.values(next.players)) {
        if (ps.onField) ps.secondsThisStint = 0;
      }
      return next;
    }

    case "SUB_APPLIED": {
      const offSet = new Set(event.off);
      const onIds = event.on.map((o) => o.playerId);
      for (const id of onIds) {
        invariant(!offSet.has(id), "a player cannot be both off and on in one sub", { id });
      }
      for (const id of event.off) {
        const ps = requirePlayer(next, id);
        ps.onField = false;
        ps.currentSlot = null;
        ps.secondsThisStint = 0;
      }
      for (const on of event.on) {
        const ps = requirePlayer(next, on.playerId);
        ps.onField = true;
        ps.currentSlot = on.slot;
        ps.secondsThisStint = 0;
      }
      for (const pc of event.positionChanges) {
        const ps = requirePlayer(next, pc.playerId);
        // A position change keeps the player on the field; the stint continues.
        ps.currentSlot = pc.toSlot;
      }
      return next;
    }

    case "PLAYER_LOCKED": {
      requirePlayer(next, event.playerId).locked = event.locked;
      return next;
    }

    case "PLAYER_PINNED": {
      requirePlayer(next, event.playerId).pinnedSlot = event.slot;
      return next;
    }

    case "SNOOZE_SET": {
      next.snoozedUntilSeconds = event.untilSeconds;
      return next;
    }

    case "GOAL_SCORED": {
      const ps = requirePlayer(next, event.playerId);
      // One scoring EVENT, worth `points` (football = 1; basketball 1/2/3). An event stored before
      // points existed has none, so it counts as one — which is exactly what it recorded.
      ps.goals += 1;
      ps.points += event.points ?? 1;
      return next;
    }

    case "MATCH_ENDED": {
      next.status = "full-time";
      return next;
    }

    default: {
      // Exhaustiveness guard — a new event type without a case fails loudly here.
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Rebuild live state by folding the whole event log (crash-safe restore / undo, PRD §6.5).
 *
 * This is the RECOVERY path, so it is deliberately resilient: an event that can't be applied to the
 * current state (e.g. a duplicate MATCH_STARTED or a stale swap introduced by a cross-device merge —
 * see sync.ts) is SKIPPED rather than thrown, so a match always re-opens best-effort instead of
 * bricking the screen. (The live reducer `applyEvent` itself stays strict + loud for new events;
 * only this fold-from-log tolerates a corrupted history.)
 */
export function rebuildLiveState(
  match: Match,
  players: Player[],
  events: MatchEvent[],
): LiveState {
  let state = initLiveState(match, players);
  for (const event of events) {
    try {
      state = applyEvent(state, event);
    } catch {
      // Un-replayable event in a stored/merged log — skip it and keep folding (recovery, not live).
    }
  }
  return state;
}

/** Player ids currently on the field. */
export function onFieldIds(state: LiveState): string[] {
  return Object.values(state.players)
    .filter((p) => p.onField)
    .map((p) => p.playerId);
}

/** Player ids available but currently on the bench. */
export function benchIds(state: LiveState): string[] {
  return Object.values(state.players)
    .filter((p) => !p.onField)
    .map((p) => p.playerId);
}
