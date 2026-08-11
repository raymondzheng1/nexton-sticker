"use client";
/**
 * Live-match store (PRD §6.5, §8.3). The clock ticks in memory every second; the append-only event
 * log is the persisted truth (crash-safe restore). To bound writes, accrued seconds are flushed to
 * the log as a single TICK on every meaningful event and on a periodic autosave — so reopening after
 * a crash loses at most one autosave interval. After every event the sub plan is recalculated
 * (PRD §7.5). All suggestions are advisory; nothing is applied without a coach action.
 */
import { create } from "zustand";
import {
  applyEvent,
  buildPlan,
  DEFAULT_SUB_FREQUENCY,
  initLiveState,
  invalidatesPlan,
  isStartableAtKickoff,
  planFromLineup,
  rebuildLiveState,
  recalculate,
  replanFromLive,
  restPlayerNow,
  snoozeNextSub,
  SECONDS_PER_MINUTE,
  type LiveState,
  type MatchEvent,
  type PlannedWindow,
  type Player,
  type PositionChange,
  type PositionSlot,
  type SubPlan,
  type Swap,
} from "@/engine";
import { useAppStore } from "./appStore";
import { getRepo } from "./clientRepo";
import { periodEndSeconds, shouldKeepNextChange, wallClockCatchUp } from "./clock";
import type { SavedMatch } from "./schema";
import { reportActivity } from "./telemetry";

/** Accrued, not-yet-persisted seconds (module-level so ticking doesn't churn React state needlessly). */
let unpersisted = 0;
/** Wall-clock ms of the last applied tick — so elapsed advances by REAL time, not interval count
 * (correct even when the interval is throttled/paused while backgrounded). */
let lastWallMs = 0;
/**
 * The committed "next suggested change" target — a stable countdown anchor (PRD §7.4 cue). The
 * continuous planner re-derives its window grid from the current time on every recalc, so reading
 * the countdown straight off the plan made it jump whenever you left and returned. Instead we pin
 * the target once (on kickoff / a sub / an override) and keep it across reopen, only refreshing it
 * when it's actually reached. Module-level so it survives an in-app navigate-away→return (same JS
 * context); `targetMatchId` guards against carrying it onto a different match. `fromSeconds` is the
 * elapsed time when it was set, so the progress bar has a stable span. */
let nextChange: { atSeconds: number; fromSeconds: number } | null = null;
let targetMatchId: string | null = null;

/**
 * Stamp the real-world time onto the events that carry one. The engine never reads `wallClockISO`
 * (it stays deterministic on injected match time); it exists so the match log can tell the coach
 * WHEN something actually happened. Events without the field (TICK, locks, pins, snooze) pass
 * through untouched — the switch narrows so only variants that declare it are widened.
 */
function stamped(event: MatchEvent, iso: string): MatchEvent {
  switch (event.type) {
    case "MATCH_STARTED":
    case "CLOCK_PAUSED":
    case "CLOCK_RESUMED":
    case "PERIOD_ENDED":
    case "PERIOD_STARTED":
    case "SUB_APPLIED":
    case "GOAL_SCORED":
    case "MATCH_ENDED":
      return { ...event, wallClockISO: event.wallClockISO ?? iso };
    default:
      return event;
  }
}

/**
 * First upcoming planned change as a stable countdown target, or null if none remain. When the coach
 * has approved a plan (`match.subPlan`) it is the GUIDE — the countdown follows its next window;
 * otherwise (or once it's exhausted) we fall back to the engine's continuous plan.
 */
function deriveNextChange(
  subPlan: PlannedWindow[] | null | undefined,
  plan: SubPlan,
  elapsedSeconds: number,
): { atSeconds: number; fromSeconds: number } | null {
  if (subPlan && subPlan.length > 0) {
    const next = subPlan.find((w) => w.atSeconds > elapsedSeconds + 1);
    if (next) return { atSeconds: next.atSeconds, fromSeconds: elapsedSeconds };
    // plan exhausted (all windows passed) → fall through to the engine's plan
  }
  const w0 = plan.windows[0]?.atMinute;
  if (w0 === undefined) return null;
  return { atSeconds: Math.round(w0 * 60), fromSeconds: elapsedSeconds };
}

interface LiveStoreState {
  matchId: string | null;
  match: SavedMatch | null;
  live: LiveState | null;
  subPlan: SubPlan | null;
  /** Stable countdown target for the next suggested change (see `nextChange` above). */
  nextChange: { atSeconds: number; fromSeconds: number } | null;
  loading: boolean;
  error: string | null;

  open: (matchId: string) => Promise<void>;
  close: () => void;
  kickOff: () => Promise<void>;
  /** Persist the coach's reviewed substitution plan so the live match follows it as a guide. */
  approvePlan: (windows: PlannedWindow[]) => Promise<void>;
  /**
   * Set how often the coach wants to substitute (level 1–5) and rebuild the plan around it. Works
   * before kickoff (regenerate the whole timeline from the starting lineup) and during the match
   * (regenerate only what's still ahead — executed changes are history).
   */
  setSubFrequency: (level: number) => Promise<void>;
  /** Wipe the event log back to pre-match so the coach can start the match over (item 5). */
  restart: () => Promise<void>;
  tick: () => void;
  /** Re-derive the clock from the wall-clock anchor immediately (call when the page becomes
   * visible/focused — don't wait for the throttled interval). */
  resync: () => void;
  autosave: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  endPeriod: () => Promise<void>;
  startNextPeriod: () => Promise<void>;
  confirmSwaps: (swaps: Swap[], positionChanges?: PositionChange[]) => Promise<void>;
  manualSwap: (off: string[], on: { playerId: string; slot: PositionSlot }[]) => Promise<void>;
  /**
   * Record a score for a player — `points` is what it was worth (football 1; basketball 1/2/3).
   * Never affects minutes, fairness, or the next-change countdown.
   */
  logGoal: (playerId: string, points?: number) => Promise<void>;
  /**
   * The player is OUT for the rest of the match (injury, fouled out, had to go). They stop being a
   * substitution candidate immediately and the minutes they can no longer play redistribute to the
   * rest of the squad. Requires them to be OFF the field already — the caller subs them off first,
   * so the side never drops below its on-field count by accident.
   */
  retirePlayer: (playerId: string) => Promise<void>;
  /** Undo a retirement: back on the bench and in the rotation, catching up on missed minutes. */
  unretirePlayer: (playerId: string) => Promise<void>;
  /**
   * A 🕑 late player is actually here NOW (before or after their estimated minute): re-anchor their
   * availability window to the real arrival, so they're immediately in the rotation and their fair
   * share is pro-rated from when they truly arrived.
   */
  markArrived: (playerId: string) => Promise<void>;
  /**
   * A surprise arrival joins the match squad mid-game (roster player who wasn't picked, or a
   * brand-new player). They join the bench, eligible immediately, with their fair share pro-rated
   * from the join minute — never diluting minutes already fairly earned by others.
   */
  addPlayerToMatch: (player: Player) => Promise<void>;
  toggleLock: (playerId: string) => Promise<void>;
  restNow: (playerId: string) => Promise<void>;
  pin: (playerId: string, slot: PositionSlot | null) => Promise<void>;
  snooze: (minutes: number) => Promise<void>;
  endMatch: () => Promise<void>;
}

export const useLiveStore = create<LiveStoreState>((set, get) => {
  /** Apply any real wall-time elapsed since the last tick into the in-memory clock (no persist). */
  function syncWall(): void {
    const live = get().live;
    if (!live || live.status !== "running" || lastWallMs === 0) return;
    const delta = Math.floor((Date.now() - lastWallMs) / 1000);
    if (delta < 1) return;
    const next = applyEvent(live, { type: "TICK", atSeconds: live.elapsedSeconds + delta, deltaSeconds: delta });
    lastWallMs += delta * 1000;
    unpersisted += delta;
    set({ live: next });
  }

  /** Persist (or clear) the wall-clock anchor on the match record. */
  async function writeAnchor(anchor: { elapsedSeconds: number; wallClockISO: string } | null): Promise<void> {
    const { matchId, match } = get();
    if (!matchId) return;
    await getRepo().updateMatch(matchId, { clockAnchor: anchor });
    if (match) set({ match: { ...match, clockAnchor: anchor } });
  }

  /**
   * Regenerate the approved plan's FUTURE windows from the current live state, keeping windows
   * already executed — called the moment reality diverges from the plan: the coach subs manually or
   * sets a keep-on/pin (see {@link invalidatesPlan}), a late player arrives, or a player joins
   * mid-match. Without this the guide keeps naming players who are already on the pitch and its
   * remaining windows chase a match that no longer exists. No-op when the coach has no approved
   * plan (the engine plan re-derives on every commit anyway).
   */
  async function replanGuide(matchNow: SavedMatch, live: LiveState): Promise<SavedMatch> {
    if (!matchNow.subPlan || matchNow.subPlan.length === 0) return matchNow;
    const next = replanFromLive(matchNow.config, matchNow.players, live, matchNow.subPlan);
    return getRepo().updateMatch(matchNow.id, { subPlan: next });
  }

  /**
   * Flush accrued clock seconds to the log, apply the events in memory + persist, then recalc.
   * SERIALIZED via {@link commit}'s queue so two overlapping actions (rapid taps, or a tap during the
   * animated multi-sub) never read each other's stale state — which could otherwise apply conflicting
   * position changes and leave two players in one slot.
   */
  async function doCommit(events: MatchEvent[], repin = true): Promise<void> {
    syncWall(); // record real elapsed before this event so timestamps are accurate
    const { matchId, live, match } = get();
    if (!matchId || !live || !match) return;
    const repo = getRepo();
    let working = live;
    // `appendEvent` returns the match WITH the new event in its log — keep it. The match log the
    // coach reads is derived from `match.events`, so discarding this left the store holding the
    // event list as it was when the page opened: kick-off, goals, half time and full time would
    // never have appeared in it.
    let matchNow = match;

    if (unpersisted > 0) {
      // The in-memory clock already counted these seconds; record them in the log to match.
      matchNow = await repo.appendEvent(matchId, {
        type: "TICK",
        atSeconds: working.elapsedSeconds,
        deltaSeconds: unpersisted,
      });
      unpersisted = 0;
    }
    // Stamp real-world time once per commit, so every event in one batch shares it.
    const nowISO = new Date().toISOString();
    for (const raw of events) {
      const ev = stamped(raw, nowISO);
      working = applyEvent(working, ev);
      matchNow = await repo.appendEvent(matchId, ev);
    }

    // Subbing a 🕑 late player ON before their estimated minute IS their arrival — re-anchor their
    // window to now (every path: tap-sub, suggestion, plan guide), so their fair share is pro-rated
    // from when they actually entered, not the estimate.
    let replanned = false;
    const cameOn = events
      .filter((e): e is Extract<MatchEvent, { type: "SUB_APPLIED" }> => e.type === "SUB_APPLIED")
      .flatMap((e) => e.on.map((o) => o.playerId));
    const arrivedEarly = matchNow.players.filter(
      (p) =>
        cameOn.includes(p.id) &&
        p.availability === "arrives-late" &&
        (p.unavailableUntilMinute ?? 0) * 60 > working.elapsedSeconds,
    );
    if (arrivedEarly.length > 0) {
      // Subbing a late player straight on IS their arrival — flip them to a full "available" squad
      // member (same equal-time, catch-up treatment as markArrived), not the pro-rated late window.
      const players = matchNow.players.map((p) =>
        arrivedEarly.some((a) => a.id === p.id)
          ? { ...p, availability: "available" as const, unavailableUntilMinute: undefined }
          : p,
      );
      matchNow = await repo.updateMatch(matchId, { players });
      // Arrival changes who's available — the approved guide re-plans around them right away.
      matchNow = await replanGuide(matchNow, working);
      replanned = true;
    }

    // The coach deviated from the plan (manual sub / reposition / keep-on / pin): every remaining
    // window was simulated from a match that no longer exists, so regenerate the future of the
    // guide from the REAL state. Without this the plan keeps naming a player the coach already
    // brought on, and its later windows pull the wrong people off — the fairness promise breaks.
    if (!replanned && invalidatesPlan(events)) {
      matchNow = await replanGuide(matchNow, working);
    }

    // A substantive change happened (kickoff, sub, override, snooze, period) — re-derive the plan
    // AND re-pin the countdown target from it. This is the only place the target moves during play.
    const plan = recalculate(matchNow.config, matchNow.players, working);
    // A goal doesn't change minutes/the plan, so it must NOT re-pin the countdown (that would reset
    // the "next change" bar). Other events re-pin from the fresh plan as before.
    if (repin) {
      nextChange = deriveNextChange(matchNow.subPlan, plan, working.elapsedSeconds);
      targetMatchId = matchId;
    }
    // `matchNow` always carries the freshest log (see above), so it is published unconditionally.
    set({ live: working, subPlan: plan, nextChange, match: matchNow });
    // Let lists that show match status (e.g. the team page) know this match changed (kickoff → live,
    // end → completed, etc.) so they don't render a stale status after a cached back-navigation.
    useAppStore.getState().bumpMatchRev();
  }

  // Serialize commits: each runs after the previous fully settles, so it reads fresh state (no
  // interleaving that could double-book a slot). Errors don't break the chain for the next commit.
  let commitChain: Promise<void> = Promise.resolve();
  function commit(events: MatchEvent[], repin = true): Promise<void> {
    const run = commitChain.then(() => doCommit(events, repin));
    commitChain = run.catch(() => undefined);
    return run;
  }

  return {
    matchId: null,
    match: null,
    live: null,
    subPlan: null,
    nextChange: null,
    loading: false,
    error: null,

    open: async (matchId) => {
      set({ loading: true, error: null });
      const match = await getRepo().getMatch(matchId);
      if (!match) {
        set({ loading: false, error: "Match not found", matchId: null, match: null, live: null, subPlan: null });
        return;
      }
      const live = rebuildLiveState(match.config, match.players, match.events);
      lastWallMs = Date.now();

      // Catch up the clock to real wall time (the page can't tick while you're away).
      const { working, delta, crossedPeriod } = wallClockCatchUp(live, match, Date.now());
      unpersisted = delta; // persisted by autosave/close or the boundary commit below

      const plan = recalculate(match.config, match.players, working);
      // Keep the previously-pinned countdown target if it's for THIS match and still in the future —
      // so the countdown stays stable across a navigate-away→return instead of re-deriving from now.
      // Re-pin from the fresh plan only on a different match or once the old target has been reached.
      if (!shouldKeepNextChange(nextChange, targetMatchId, matchId, working.elapsedSeconds)) {
        nextChange = deriveNextChange(match.subPlan, plan, working.elapsedSeconds);
        targetMatchId = matchId;
      }

      set({
        matchId,
        match,
        live: working,
        subPlan: plan,
        nextChange,
        loading: false,
        error: null,
      });

      if (crossedPeriod) void get().endPeriod();
    },

    close: () => {
      unpersisted = 0;
      // Note: the module-level `nextChange`/`targetMatchId` are intentionally NOT cleared here, so an
      // in-app navigate-away→return (which unmounts/remounts) keeps the same stable countdown target.
      set({ matchId: null, match: null, live: null, subPlan: null, nextChange: null, error: null });
    },

    kickOff: async () => {
      const { match, live } = get();
      if (!match || !live || live.status !== "pre-match") return;
      // Use the coach's confirmed lineup if it covers the full XI AND everyone in it can actually
      // start (a stale confirmed lineup could still hold a player later marked 🕑 late — never let
      // an absent player kick off); otherwise the engine's auto-pick (which excludes them).
      const startable = new Set(match.players.filter(isStartableAtKickoff).map((p) => p.id));
      const confirmed = match.startingLineup;
      const lineup =
        confirmed &&
        confirmed.length === match.config.onFieldCount &&
        confirmed.every((a) => startable.has(a.playerId))
          ? confirmed
          : buildPlan(match.config, match.players).startingLineup.assignments;
      await commit([{ type: "MATCH_STARTED", atSeconds: 0, lineup }]);
      lastWallMs = Date.now();
      await writeAnchor({ elapsedSeconds: get().live?.elapsedSeconds ?? 0, wallClockISO: new Date().toISOString() });
      reportActivity(
        "match_started",
        `${match.name} · ${match.config.sport ?? "football"} · ${match.config.onFieldCount}-a-side · ${match.config.periods}×${match.config.periodLengthMinutes}′`,
      );
    },

    approvePlan: async (windows) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      await getRepo().updateMatch(matchId, { subPlan: windows });
      const updatedMatch = { ...match, subPlan: windows };
      // Re-pin the countdown to the approved plan's next window so the live cue follows it.
      const plan = recalculate(match.config, match.players, live);
      nextChange = deriveNextChange(windows, plan, live.elapsedSeconds);
      targetMatchId = matchId;
      set({ match: updatedMatch, subPlan: plan, nextChange });
    },

    restart: async () => {
      const { matchId, match } = get();
      if (!matchId || !match) return;
      const updated = await getRepo().resetMatch(matchId);
      const live = rebuildLiveState(updated.config, updated.players, updated.events);
      unpersisted = 0;
      lastWallMs = 0;
      nextChange = null;
      targetMatchId = matchId;
      set({
        match: updated,
        live,
        subPlan: recalculate(updated.config, updated.players, live),
        nextChange: null,
      });
      useAppStore.getState().bumpMatchRev(); // status returned to setup — refresh lists
    },

    tick: () => {
      const { live, match } = get();
      if (!live || !match || live.status !== "running") return;
      // Advance by REAL elapsed time since the last tick (not a fixed 1s) — stays accurate when the
      // interval is throttled while backgrounded.
      const rawDelta = lastWallMs === 0 ? 1 : Math.floor((Date.now() - lastWallMs) / 1000);
      if (rawDelta < 1) return;
      lastWallMs += rawDelta * 1000;

      // Earlier periods auto-pause at their boundary (half-time): cap the applied tick there so a big
      // catch-up tick doesn't overshoot and inflate minutes (PRD §8.3). The FINAL period is NOT
      // capped — the clock rolls past full time into added time, and the page prompts the coach to
      // end (or play on), reflecting real stoppage time (item 6).
      const periodEnd = periodEndSeconds(match, live);
      const isFinalPeriod = live.period >= match.config.periods;
      const target = isFinalPeriod ? live.elapsedSeconds + rawDelta : Math.min(live.elapsedSeconds + rawDelta, periodEnd);
      const delta = target - live.elapsedSeconds;
      if (delta > 0) {
        const next = applyEvent(live, { type: "TICK", atSeconds: target, deltaSeconds: delta });
        unpersisted += delta;
        set({ live: next });
      }

      // Auto-pause at a non-final period boundary (half-time). No auto full-time — the coach ends it.
      if (!isFinalPeriod && target >= periodEnd) {
        void get().endPeriod();
      }
    },

    resync: () => {
      const { live, match } = get();
      if (!live || !match) return;
      if (live.status !== "running") {
        lastWallMs = Date.now();
        return;
      }
      const { working, delta, crossedPeriod } = wallClockCatchUp(live, match, Date.now());
      if (delta > 0) {
        unpersisted += delta; // flushed by autosave / next commit
        // Advance the clock only — do NOT re-plan here. Re-deriving the plan on every refocus is what
        // made the "next change" countdown jump; the pinned target keeps it counting down smoothly.
        set({ live: working });
      }
      lastWallMs = Date.now();
      if (crossedPeriod) void get().endPeriod();
    },

    autosave: async () => {
      const { matchId, live } = get();
      if (!matchId || !live || live.status !== "running" || unpersisted === 0) return;
      await getRepo().appendEvent(matchId, {
        type: "TICK",
        atSeconds: live.elapsedSeconds,
        deltaSeconds: unpersisted,
      });
      unpersisted = 0;
    },

    pause: async () => {
      if (get().live?.status !== "running") return;
      await commit([{ type: "CLOCK_PAUSED", atSeconds: get().live?.elapsedSeconds ?? 0 }]);
      await writeAnchor(null); // clock stopped — freeze
    },
    resume: async () => {
      const live = get().live;
      if (live && (live.status === "paused" || live.status === "period-break")) {
        await commit([{ type: "CLOCK_RESUMED", atSeconds: live.elapsedSeconds }]);
        lastWallMs = Date.now();
        await writeAnchor({ elapsedSeconds: get().live?.elapsedSeconds ?? 0, wallClockISO: new Date().toISOString() });
      }
    },
    endPeriod: async () => {
      const live = get().live;
      if (live && live.status === "running") {
        await commit([{ type: "PERIOD_ENDED", atSeconds: live.elapsedSeconds, period: live.period }]);
        await writeAnchor(null); // half-time — clock frozen until next period
      }
    },
    startNextPeriod: async () => {
      const live = get().live;
      if (live && live.status === "period-break") {
        await commit([{ type: "PERIOD_STARTED", atSeconds: live.elapsedSeconds, period: live.period + 1 }]);
        lastWallMs = Date.now();
        await writeAnchor({ elapsedSeconds: get().live?.elapsedSeconds ?? 0, wallClockISO: new Date().toISOString() });
      }
    },

    confirmSwaps: async (swaps, positionChanges = []) => {
      const live = get().live;
      if (!live) return;
      const off = swaps.map((s) => s.playerOff).filter((id): id is string => id !== null);
      const on = swaps.map((s) => ({ playerId: s.playerOn, slot: s.toSlot }));
      await commit([{ type: "SUB_APPLIED", atSeconds: live.elapsedSeconds, off, on, positionChanges }]);
    },

    manualSwap: async (off, on) => {
      const live = get().live;
      if (!live) return;
      await commit([{ type: "SUB_APPLIED", atSeconds: live.elapsedSeconds, off, on, positionChanges: [] }]);
    },

    logGoal: async (playerId, points = 1) => {
      const live = get().live;
      if (!live) return;
      // repin = false: a score mustn't disturb the "next change" countdown.
      await commit(
        [{ type: "GOAL_SCORED", atSeconds: live.elapsedSeconds, playerId, points }],
        false,
      );
    },

    setSubFrequency: async (level) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      const next = Math.round(level);
      if ((match.config.subFrequency ?? DEFAULT_SUB_FREQUENCY) === next) return;
      const config = { ...match.config, subFrequency: next };
      let updated = await getRepo().updateMatch(matchId, { config });

      if (live.status === "pre-match") {
        // Nothing has happened yet, so the WHOLE timeline is regenerated at the new cadence — this
        // is the coach dialling the plan in before kickoff, and any hand-edits they made are
        // deliberately superseded (they just asked for a different plan).
        const confirmed = updated.startingLineup;
        const lineup =
          confirmed && confirmed.length === config.onFieldCount
            ? confirmed
            : buildPlan(config, updated.players).startingLineup.assignments;
        updated = await getRepo().updateMatch(matchId, {
          subPlan: planFromLineup(config, updated.players, lineup),
        });
      } else {
        // Mid-match: changes already made are history and stay put; only the future re-plans.
        updated = await replanGuide(updated, live);
      }

      const plan = recalculate(config, updated.players, live);
      nextChange = deriveNextChange(updated.subPlan, plan, live.elapsedSeconds);
      targetMatchId = matchId;
      set({ match: updated, subPlan: plan, nextChange });
    },

    retirePlayer: async (playerId) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      // Guard the on-field invariant at the store boundary, not just in the UI: retiring someone
      // still on the pitch would silently leave the side a player short.
      if (live.players[playerId]?.onField === true) return;
      const minute = live.elapsedSeconds / SECONDS_PER_MINUTE;
      const players = match.players.map((p) =>
        p.id === playerId
          ? {
              ...p,
              availableUntilMinute: minute,
              // "Always on" and "must start" are promises about a player who is IN the match. Left
              // set, initLiveState would re-seed them locked on the next crash-restore and the
              // plan-guide sanitiser would quietly drop windows around a player who isn't there.
              alwaysOn: undefined,
              mustStart: undefined,
            }
          : p,
      );
      let updated = await getRepo().updateMatch(matchId, { players });
      // One fewer player to share the remaining minutes — the guide re-plans around that now.
      updated = await replanGuide(updated, live);
      set({ match: updated });
      // Release a keep-on lock through the event log (not by editing state), so a rebuild from the
      // log agrees — otherwise they'd come back from an un-retire still locked and never rotate.
      const wasLocked = live.players[playerId]?.locked === true;
      await commit(
        wasLocked ? [{ type: "PLAYER_LOCKED", atSeconds: live.elapsedSeconds, playerId, locked: false }] : [],
      );
    },

    unretirePlayer: async (playerId) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      // Clear the mark entirely rather than modelling a second availability window: they're a full
      // squad member again, so the minutes they missed read as debt and the re-plan catches them
      // up — the same treatment a late arrival gets when they turn up.
      const players = match.players.map((p) =>
        p.id === playerId ? { ...p, availableUntilMinute: undefined } : p,
      );
      let updated = await getRepo().updateMatch(matchId, { players });
      updated = await replanGuide(updated, live);
      set({ match: updated });
      await commit([]);
    },

    markArrived: async (playerId) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      // They're here — treat them as a full squad member (coach's rule: "10 min late = 10 min on
      // the bench"). Flip to plain "available" so their fair-time TARGET is the whole-game equal
      // share, not pro-rated to the minutes remaining. Their 0 seconds-so-far now reads as a debt
      // (the fair share of the elapsed time they missed), so the re-plan catches them up toward
      // equal total minutes with everyone else.
      const players = match.players.map((p) =>
        p.id === playerId
          ? { ...p, availability: "available" as const, unavailableUntilMinute: undefined }
          : p,
      );
      let updated = await getRepo().updateMatch(matchId, { players });
      // Now in the rotation — the whole remaining plan re-computes to catch them up immediately.
      updated = await replanGuide(updated, live);
      set({ match: updated });
      await commit([]); // recalc + re-pin the countdown against the fresh guide
    },

    addPlayerToMatch: async (player) => {
      const { matchId, match, live } = get();
      if (!matchId || !match || !live) return;
      if (match.players.some((p) => p.id === player.id)) return; // already in the squad
      const minute = Math.floor(live.elapsedSeconds / 60);
      const record: Player =
        live.status === "pre-match"
          ? { ...player, availability: "available", unavailableUntilMinute: undefined }
          : { ...player, availability: "arrives-late", unavailableUntilMinute: minute };
      const players = [...match.players, record];
      // The engine reads the squad from config.availableSquad (not the players list) — the newcomer
      // must be in BOTH or they're invisible to init/rebuild/fairness.
      const config = { ...match.config, availableSquad: [...match.config.availableSquad, record.id] };
      let updated = await getRepo().updateMatch(matchId, { players, config });
      // Seed a fresh live entry (benched, 0 minutes) so the bench shows them immediately; a later
      // rebuild from the log derives the same state, since players are an input to the replay.
      const fresh = initLiveState(updated.config, updated.players).players[record.id];
      const nextLive = fresh ? { ...live, players: { ...live.players, [record.id]: fresh } } : live;
      // Re-plan the whole remaining guide with the newcomer in it (nextLive: the planner only sees
      // players that exist in the state).
      updated = await replanGuide(updated, nextLive);
      set({ match: updated, live: nextLive });
      await commit([]); // recalc + re-pin against the fresh guide
    },

    toggleLock: async (playerId) => {
      const live = get().live;
      if (!live) return;
      const locked = live.players[playerId]?.locked ?? false;
      await commit([{ type: "PLAYER_LOCKED", atSeconds: live.elapsedSeconds, playerId, locked: !locked }]);
    },

    restNow: async (playerId) => {
      const { live, match } = get();
      if (!live || !match) return;
      await commit([restPlayerNow(match.config, match.players, live, playerId, live.elapsedSeconds)]);
    },

    pin: async (playerId, slot) => {
      const live = get().live;
      if (!live) return;
      await commit([{ type: "PLAYER_PINNED", atSeconds: live.elapsedSeconds, playerId, slot }]);
    },

    snooze: async (minutes) => {
      const live = get().live;
      if (!live) return;
      const until = live.elapsedSeconds + minutes * 60;
      await commit([snoozeNextSub(live.elapsedSeconds, minutes)]);
      // Pin the countdown to the snooze end so the bar shows the wait counting down, and the
      // window-due prompt re-fires (alert + suggestion sheet) the moment the snooze elapses (items 1b/3).
      const from = get().live?.elapsedSeconds ?? live.elapsedSeconds;
      nextChange = { atSeconds: until, fromSeconds: from };
      targetMatchId = get().matchId;
      set({ nextChange });
    },

    endMatch: async () => {
      const live = get().live;
      if (!live || live.status === "full-time") return;
      await commit([{ type: "MATCH_ENDED", atSeconds: live.elapsedSeconds }]);
      await writeAnchor(null);
      const match = get().match;
      if (match) {
        reportActivity("match_ended", `${match.name} · ended at ${Math.round(live.elapsedSeconds / 60)}′`);
      }
    },
  };
});
