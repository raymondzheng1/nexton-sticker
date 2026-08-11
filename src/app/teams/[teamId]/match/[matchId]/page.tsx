"use client";
/**
 * THE ALBUM PAGE — the match screen. One route, three states, because a match is one continuous
 * thing: the team sheet before kick-off, the album page during play, the finished page after the
 * whistle.
 *
 * The engine only ever ADVISES here. Nothing on this screen substitutes anyone: every suggestion is
 * a row the coach taps, edits, snoozes or ignores, and every confirmation goes through the store's
 * serialised commit queue so two fast taps can never double-book a slot.
 *
 * The wiring is a straight port of the proven live screen; the presentation is the sticker album.
 * The squad is printed as an album spread: the players ON stand on the pitch as mini stickers, the
 * bench is a row of stickers below — and anyone the engine names to come ON renders as a MISSING
 * sticker slot (dashed red outline), because the album has a gap waiting for them. That rule is the
 * design's whole thesis: fair minutes are a collection you complete.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  applyEvent,
  buildPlan,
  DEFAULT_SUB_FREQUENCY,
  fairnessReport,
  groupOf,
  isRetiredAt,
  planFromLineup,
  projectFromLive,
  recommendationFromWindow,
  recommendSwaps,
  stateAfterWindows,
  type LineupAssignment,
  type LiveState,
  type PlannedWindow,
  type Player,
  type PlayerLiveState,
  type PositionGroup,
  type PositionSlot,
  type Recommendation,
} from "@/engine";
import { useAppStore } from "@/store/appStore";
import { useLiveStore } from "@/store/liveStore";
import { newId } from "@/store/ids";
import { canEndPeriodEarly, regulationEndSeconds, remainingInPeriodSeconds, totalSeconds } from "@/store/clock";
import { slotFullName, slotShortName, sportOf } from "@/features/sports";
import {
  buildMatchFeed,
  countActualSubs,
  feedLineText,
  statusFor,
  statusTolFor,
  wallClockLabel,
  type FeedLabels,
  type TokenStatus,
} from "@/features/live";
import { AlbumPitch, type FigurePlayer } from "@/features/live/AlbumPitch";
import { ProjectedMinutes, projectedRows } from "@/features/plan/ProjectedMinutes";
import { PlanTimeline, UpcomingTimeline } from "@/features/plan/PlanTimeline";
import { SubFrequency, cadenceSummary } from "@/features/plan/SubFrequency";
import {
  FoilCard,
  HandNote,
  HardButton,
  HardButtonLink,
  Kicker,
  Logo,
  MissingSlot,
  Pill,
  PlayerSticker,
  ProgressTrack,
  Sheet,
  StatusChip,
  Toast,
  clockTime,
  cx,
  mins,
  styles,
  tilt,
} from "@/ui";
import la from "@/features/live/liveAlbum.module.css";

/* ── small pure helpers ─────────────────────────────────────────────────── */

/** m:ss, unpadded — how a countdown is written on a scoreboard ("3:50", not "03:50"). */
function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Outfield lines back→front, per sport (GK is implicit and printed separately). */
const PITCH_LINES: PositionGroup[] = ["DEF", "MID", "FWD"];
const COURT_LINES: PositionGroup[] = ["G", "F", "C"];

/* ── the alert cue ───────────────────────────────────────────────────────── */

// One reused AudioContext (browsers cap how many you can create over a session).
let sharedAudioCtx: AudioContext | null = null;
const ALERT_SECONDS = 5;

/** A loud, ~5-second pulsing two-tone alarm so the coach can't miss a due change. */
function playAlarm(): void {
  try {
    sharedAudioCtx = sharedAudioCtx ?? new AudioContext();
    const ctx = sharedAudioCtx;
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square"; // harsher = more audible outdoors
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    const pulse = 0.6;
    gain.gain.setValueAtTime(0.0001, t0);
    for (let i = 0; i * pulse < ALERT_SECONDS; i++) {
      const t = t0 + i * pulse;
      osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 988, t);
      gain.gain.setValueAtTime(0.22, t + 0.0005); // on
      gain.gain.setValueAtTime(0.0001, t + 0.38); // off (gap before the next pulse)
    }
    osc.start(t0);
    osc.stop(t0 + ALERT_SECONDS);
  } catch {
    // Audio blocked (no user gesture yet) — the visual cue still fires; benign.
  }
}

function alertCue(sound: boolean, vibrate: boolean): void {
  if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([600, 150, 600, 150, 600, 150, 600, 150, 600, 150, 600]); // ~5s
  }
  if (sound) playAlarm();
}

/**
 * Keep the screen awake while the clock runs. On the web the in-app countdown IS the alert — there
 * are no reliable backgrounded notifications — so the page has to stay alive. Re-acquires on return
 * to the foreground; no-ops where unsupported (iOS < 16.4).
 */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async (): Promise<void> => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Unsupported or denied (e.g. low battery) — benign; the in-app timers still run.
      }
    };
    void acquire();

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
    };
  }, [active]);
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export default function LiveMatchPage() {
  const params = useParams<{ teamId: string; matchId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const matchId = typeof params.matchId === "string" ? params.matchId : "";

  const { match, live, nextChange, loading, error } = useLiveStore();
  const open = useLiveStore((s) => s.open);
  const close = useLiveStore((s) => s.close);
  const tick = useLiveStore((s) => s.tick);
  const autosave = useLiveStore((s) => s.autosave);
  const resync = useLiveStore((s) => s.resync);
  const store = useLiveStore;

  const prefs = useAppStore((s) => s.prefs);
  const teams = useAppStore((s) => s.teams);
  const saveTeam = useAppStore((s) => s.saveTeam);

  const [selected, setSelected] = useState<string | null>(null);
  // Row handlers can be invoked from a render or two ago, so the CURRENT selection is read from this
  // ref (and live state straight from the store) — reading the closed-over value gave a second tap a
  // stale null and re-selected instead of swapping.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const [sheet, setSheet] = useState<Recommendation | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [confirmKind, setConfirmKind] = useState<"end" | "endperiod" | "restart" | "fulltime" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [goalOpen, setGoalOpen] = useState(false);
  // Retiring an ON-FIELD player runs through the normal sub-off flow first, so the side is never
  // left short. This remembers who to retire once that replacement is confirmed; cleared on back-out.
  const retireAfterRef = useRef<string | null>(null);
  const [shortHandedRetire, setShortHandedRetire] = useState<string | null>(null);
  const promptedRef = useRef<number | null>(null);
  const fullTimePromptedRef = useRef(false);
  const timers = useRef<number[]>([]);
  // Pre-match substitution plan (coach-editable; persisted as the live guide).
  const [planWindows, setPlanWindows] = useState<PlannedWindow[] | null>(null);
  const planSeeded = useRef(false);

  useWakeLock(live?.status === "running");

  useEffect(() => {
    void open(matchId);
    return () => {
      void autosave();
      close();
    };
  }, [matchId, open, close, autosave]);

  // 1s clock tick + ~10s autosave checkpoint while running.
  useEffect(() => {
    const t = setInterval(() => tick(), 1000);
    const a = setInterval(() => void autosave(), 10_000);
    return () => {
      clearInterval(t);
      clearInterval(a);
    };
  }, [tick, autosave]);

  // Clear any pending flash/toast timers on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => clearTimeout(id));
  }, []);

  // Back in the foreground (tab re-shown, app re-focused, BFCache restore): snap the clock to real
  // wall time at once rather than waiting for the throttled interval, which reads as a stall.
  useEffect(() => {
    const onVisible = (): void => {
      if (typeof document === "undefined" || document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [resync]);

  const rows = useMemo(
    () => (match && live ? fairnessReport(match.config, match.players, live).rows : []),
    [match, live],
  );
  const debtById = useMemo(() => new Map(rows.map((r) => [r.playerId, r.debtSeconds])), [rows]);

  // The match log: what actually happened, newest first, straight off the event log.
  const feed = useMemo(() => (match ? buildMatchFeed(match.events) : []), [match]);
  const subsMade = useMemo(() => countActualSubs(feed), [feed]);

  /** Where everyone finishes if the rest of the plan runs: minutes on the clock now + what's ahead. */
  const liveProjection = useMemo(() => {
    if (!match || !live || live.status === "pre-match") return [];
    const totalSec = totalSeconds(match);
    const finalState = projectFromLive(match.config, match.players, live, match.subPlan ?? [], totalSec);
    return projectedRows(match.config, match.players, finalState, totalSec);
  }, [match, live]);

  // Starting lineup the plan is based on: the coach's confirmed XI, else the engine's auto-pick.
  const startingLineup = useMemo<LineupAssignment[]>(() => {
    if (!match) return [];
    const confirmed = match.startingLineup;
    return confirmed && confirmed.length === match.config.onFieldCount
      ? confirmed
      : buildPlan(match.config, match.players).startingLineup.assignments;
  }, [match]);

  // Seed the editable plan once at pre-match: the saved plan if any, else build + persist a default
  // so the live guide always exists. Edits flow back through `updatePlan` (auto-saved).
  useEffect(() => {
    if (!match || !live || live.status !== "pre-match" || planSeeded.current || startingLineup.length === 0) return;
    planSeeded.current = true;
    if (match.subPlan != null) {
      setPlanWindows(match.subPlan);
      return;
    }
    const seeded = planFromLineup(match.config, match.players, startingLineup);
    setPlanWindows(seeded);
    void store.getState().approvePlan(seeded);
  }, [match, live, startingLineup, store]);

  const updatePlan = useCallback(
    (windows: PlannedWindow[]) => {
      setPlanWindows(windows);
      void store.getState().approvePlan(windows);
    },
    [store],
  );

  /** Where everyone lands if the whole pre-match plan runs — the projection under the dial. */
  const planProjection = useMemo(() => {
    if (!match || live?.status !== "pre-match" || !planWindows || startingLineup.length === 0) return [];
    const totalSec = totalSeconds(match);
    const final = stateAfterWindows(match.config, match.players, startingLineup, planWindows, totalSec);
    return projectedRows(match.config, match.players, final, totalSec);
  }, [match, live?.status, planWindows, startingLineup]);

  const nameOf = useCallback(
    (id: string): string => match?.players.find((p) => p.id === id)?.name ?? id,
    [match],
  );

  /**
   * The change to offer right now, from fresh state.
   *
   * Follow the approved plan first: if the pinned target matches a planned window, suggest exactly
   * that change. The window is sanitised against the LIVE state (a keep-on player is never suggested
   * off — invariant #3), so it can collapse to nothing; then — as when there's no plan, it's
   * exhausted, or the coach deviated — fall back to the live engine (also lock-aware).
   */
  const deriveSuggestion = useCallback((): Recommendation | null => {
    const { match: m, live: l, nextChange: nc } = store.getState();
    if (!m || !l) return null;
    const planned = nc ? m.subPlan?.find((w) => w.atSeconds === nc.atSeconds) : undefined;
    if (planned && planned.on.length > 0) {
      const fromPlan = recommendationFromWindow(m.config, m.players, l, planned);
      if (fromPlan.primary.length > 0) return fromPlan;
    }
    const rec = recommendSwaps(m.config, m.players, l);
    return rec.primary.length > 0 ? rec : recommendSwaps(m.config, m.players, l, { forceImmediate: true });
  }, [store]);

  const openSuggestion = useCallback(() => {
    const rec = deriveSuggestion();
    if (rec) setSheet(rec); // an empty `primary` is a real answer — the sheet says "all balanced"
  }, [deriveSuggestion]);

  // Window-due prompt: when the clock reaches the pinned target, cue + open the sheet once.
  const nextChangeAt = nextChange?.atSeconds ?? null;
  useEffect(() => {
    if (!live || live.status !== "running" || nextChangeAt === null) return;
    if (live.elapsedSeconds >= nextChangeAt && promptedRef.current !== nextChangeAt) {
      promptedRef.current = nextChangeAt;
      alertCue(prefs.sound, prefs.vibrate);
      openSuggestion();
    }
  }, [live, nextChangeAt, openSuggestion, prefs.sound, prefs.vibrate]);

  // Full time reached: don't auto-freeze — alert + ask once whether to end or play on (added time).
  // Measured against regulationEndSeconds, not the scheduled total: once a period has been ended
  // early the clock lags the schedule for good, and a fixed total would ask "play on?" minutes after
  // the game was actually over.
  useEffect(() => {
    if (!match || !live || live.status !== "running") return;
    if (live.elapsedSeconds < regulationEndSeconds(match, live)) {
      fullTimePromptedRef.current = false; // re-arm (e.g. after a restart)
      return;
    }
    if (!fullTimePromptedRef.current) {
      fullTimePromptedRef.current = true;
      alertCue(prefs.sound, prefs.vibrate);
      setConfirmKind((k) => k ?? "fulltime");
    }
  }, [match, live, prefs.sound, prefs.vibrate]);

  /**
   * The change the foil card prints while the clock runs.
   *
   * Recomputed on a COARSE cadence rather than every tick. When the answer comes from the engine it
   * is re-ranked by live debt, and rows that renamed themselves every second would be unreadable —
   * and untrustworthy, since the coach is asked to confirm exactly what they just read. A new pinned
   * target, a new event in the log, or fifteen seconds of play are the things that can genuinely
   * change who should come off.
   */
  const cadence =
    match && live && live.status === "running"
      ? `${nextChangeAt ?? "-"}|${match.events.length}|${Math.floor(live.elapsedSeconds / 15)}`
      : null;
  const panelRec = useMemo<Recommendation | null>(() => {
    const rec = cadence === null ? null : deriveSuggestion();
    return rec && rec.primary.length > 0 ? rec : null;
  }, [cadence, deriveSuggestion]);

  /**
   * The lineup AFTER the open suggestion's swaps (pure apply, never persisted), so the coach can see
   * what "Confirm all" leaves on the pitch before committing. Recomputes when they skip a row.
   */
  const previewState = useMemo<LiveState | null>(() => {
    if (!live || !sheet || sheet.primary.length === 0) return null;
    const off = sheet.primary.map((s) => s.playerOff).filter((id): id is string => id !== null);
    const on = sheet.primary.map((s) => ({ playerId: s.playerOn, slot: s.toSlot }));
    try {
      return applyEvent(live, {
        type: "SUB_APPLIED",
        atSeconds: live.elapsedSeconds,
        off,
        on,
        positionChanges: sheet.positionChanges,
      });
    } catch {
      return null; // invalid combo (shouldn't happen for a valid suggestion) — just skip the preview
    }
  }, [live, sheet]);

  /** Dismiss the suggestion sheet — and drop any retirement that was waiting on it. */
  const closeSheet = useCallback(() => {
    retireAfterRef.current = null;
    setSheet(null);
  }, []);

  const flash = useCallback((ids: string[]) => {
    setFlashIds(ids);
    timers.current.push(window.setTimeout(() => setFlashIds([]), 1400));
  }, []);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    timers.current.push(window.setTimeout(() => setToast(null), 2600));
  }, []);

  if (loading) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <span className={la.brand}>
            <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
              ←
            </Link>
            <Logo />
          </span>
        </header>
        <div className={styles.gutter}>
          <p className={styles.empty}>Peeling the page open…</p>
        </div>
      </main>
    );
  }

  if (error || !match || !live) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <span className={la.brand}>
            <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
              ←
            </Link>
            <Logo />
          </span>
        </header>
        <div className={styles.gutter}>
          <div className={la.panelCard} style={{ ["--tilt" as string]: "-0.6deg" }}>
            <span className={la.panelTitle}>{error ?? "Match unavailable"}</span>
            <p className={styles.body}>That match isn&apos;t in the album any more.</p>
            <div style={{ marginTop: 14 }}>
              <HardButtonLink href={`/teams/${teamId}`} variant="outline" size="md">
                Back to the team
              </HardButtonLink>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── derived view state ────────────────────────────────────────────────── */

  const cfg = sportOf(match.config.sport);
  const isBasketball = cfg.id === "basketball";
  const onField = Object.values(live.players).filter((p) => p.onField);
  // Players retired for the rest of the match sit in their own "Out" list, not the bench — the bench
  // is who you can bring on, and they aren't.
  const retiredPlayers = match.players.filter((p) => isRetiredAt(p, live.elapsedSeconds));
  const retiredIds = new Set(retiredPlayers.map((p) => p.id));
  const benchPlayers = match.players
    .filter((p) => !live.players[p.id]?.onField)
    .filter((p) => p.availability !== "unavailable")
    .filter((p) => !retiredIds.has(p.id));

  const total = totalSeconds(match);
  // Status band scales with match length (a fixed 4′ band would mark everything "on target" in a
  // short game).
  const statusTol = statusTolFor(total);
  const squadById = new Map(match.players.map((p) => [p.id, p]));
  const statusOf = (id: string): TokenStatus => statusFor(debtById.get(id) ?? 0, statusTol);
  const scoreOf = (lp: PlayerLiveState | undefined): number =>
    isBasketball ? (lp?.points ?? 0) : (lp?.goals ?? 0);
  const teamScore = Object.values(live.players).reduce((sum, p) => sum + scoreOf(p), 0);
  /** "⚽" / "⚽ 2" / "🏀 5" — the scorer's mark stuck on a face. */
  const scoreMarkOf = (lp: PlayerLiveState | undefined): string | undefined => {
    const n = scoreOf(lp);
    return n > 0 ? `${cfg.scoreIcon}${n > 1 ? ` ${n}` : ""}` : undefined;
  };

  /** 🕑 late player who hasn't arrived (or played) yet. */
  const lateWaiting = (id: string): boolean => {
    const rec = squadById.get(id);
    const lp = live.players[id];
    return (
      rec?.availability === "arrives-late" &&
      (lp?.secondsOnField ?? 0) === 0 &&
      !(lp?.onField ?? false) &&
      (rec.unavailableUntilMinute ?? 0) * 60 > live.elapsedSeconds
    );
  };

  const formationLabel = (cfg.hasGoalkeeper ? PITCH_LINES : COURT_LINES)
    .map(
      (group) =>
        onField.filter((p) => p.currentSlot && p.currentSlot !== "GK" && groupOf(p.currentSlot) === group).length,
    )
    .filter((n) => n > 0)
    .join("-");

  const running = live.status === "running";
  const inExtraTime = running && live.elapsedSeconds >= regulationEndSeconds(match, live);
  const periodRemaining = remainingInPeriodSeconds(match, live);
  const canEndPeriod = canEndPeriodEarly(match, live);
  // The sport's own word, lowercased for mid-sentence use: "half" (football) / "period" (basketball).
  const periodWord = cfg.periodLabel.toLowerCase();
  const pulseId = sheet?.primary[0]?.playerOff ?? panelRec?.primary[0]?.playerOff ?? null;
  // Only the windows still AHEAD — past ones are history and belong in the match log, where what
  // really happened is recorded rather than what was planned.
  const upcomingWindows = (match.subPlan ?? []).filter((w) => w.atSeconds > live.elapsedSeconds);
  const subFrequency = match.config.subFrequency ?? DEFAULT_SUB_FREQUENCY;
  const feedLabels: FeedLabels = {
    nameOf,
    slotLabel: slotShortName,
    startLabel: cfg.startLabel,
    periodLabel: cfg.periodLabel,
    breakLabel: cfg.breakLabel,
    endLabel: cfg.endLabel,
    scoreIcon: cfg.scoreIcon,
    showScoreValue: cfg.scoreOptions.length > 1,
  };
  // Snooze in progress: the countdown is pinned to the snooze end, so it reads as a snooze timeline.
  const snoozed = live.snoozedUntilSeconds != null && live.snoozedUntilSeconds > live.elapsedSeconds;

  // Countdown to the next planned change — driven by the stable pinned target (see liveStore), so it
  // counts down smoothly and doesn't jump when you leave and return.
  const remaining = nextChange !== null ? Math.max(0, nextChange.atSeconds - live.elapsedSeconds) : 0;
  const cdTotal = nextChange !== null ? Math.max(60, nextChange.atSeconds - nextChange.fromSeconds) : 60;
  const cdPct = Math.max(0, Math.min(1, remaining / cdTotal));
  const due = running && nextChange !== null && remaining <= 0;

  // THE signature rule: whoever the current suggestion names to come ON is a MISSING sticker on the
  // bench — the album showing the gap it wants filled. The open sheet wins over the ambient card.
  const suggestedOnIds = new Set((sheet ?? panelRec)?.primary.map((s) => s.playerOn) ?? []);

  const selectedPlayer = selected ? live.players[selected] : null;
  // A 🕑 late player on the bench who hasn't played can be marked "arrived" at any time — before OR
  // after their estimated minute — re-anchoring their fair-share window to the real arrival.
  const selectedLate =
    selectedPlayer !== null &&
    selectedPlayer !== undefined &&
    !selectedPlayer.onField &&
    selectedPlayer.secondsOnField === 0 &&
    squadById.get(selectedPlayer.playerId)?.availability === "arrives-late";

  const team = teams.find((t) => t.id === teamId) ?? null;
  const rosterNotInSquad = (team?.roster ?? []).filter((p) => !squadById.has(p.id));

  /* ── actions ───────────────────────────────────────────────────────────── */

  async function addExistingPlayer(p: Player): Promise<void> {
    setAddOpen(false);
    await store.getState().addPlayerToMatch(p);
    showToast(`${p.name} joined the squad`);
  }

  async function addNewPlayer(): Promise<void> {
    const name = newName.trim();
    if (name.length === 0) return;
    const player: Player = {
      id: newId(),
      name,
      eligiblePositions: isBasketball ? ["G", "F", "C"] : ["DEF", "MID", "FWD"],
      preferredPositions: [],
      canPlayGK: false,
      minutesWeight: 1,
    };
    setAddOpen(false);
    setNewName("");
    await store.getState().addPlayerToMatch(player);
    // Save to the team roster too, so they're pickable in future matches.
    if (team) await saveTeam({ ...team, roster: [...team.roster, player] });
    showToast(`${name} joined the squad`);
  }

  /**
   * Move the rotation dial and rebuild the plan around it. Pre-match the timeline lives in component
   * state (seeded once), so the regenerated plan is pulled back in — otherwise the coach would move
   * the dial and still see the old windows.
   */
  async function changeSubFrequency(level: number): Promise<void> {
    await store.getState().setSubFrequency(level);
    const next = store.getState().match?.subPlan;
    if (next) setPlanWindows(next);
  }

  function logScore(playerId: string, points: number): void {
    void store.getState().logGoal(playerId, points);
    flash([playerId]);
    showToast(
      cfg.scoreOptions.length > 1
        ? `${cfg.scoreIcon} ${points} pt · ${nameOf(playerId)}`
        : `${cfg.scoreIcon} ${cfg.scoreLabel} · ${nameOf(playerId)}`,
    );
    setSelected(null);
    setGoalOpen(false);
  }

  /**
   * Retire a player for the rest of the match. Off the bench it's immediate. On the pitch it can't
   * be — the side would silently drop below its on-field count — so it runs through the normal
   * replacement flow first and the retirement lands once that sub is confirmed. With an empty bench
   * there IS no replacement, which is a real touchline situation (an injury with no subs left), so
   * the coach is asked to confirm playing a player short rather than being blocked.
   */
  function startRetire(playerId: string): void {
    setSelected(null);
    // Fresh state only — this can run from a stale row closure (see handleSelect).
    const { match: matchNow, live: liveNow } = store.getState();
    if (!matchNow || !liveNow) return;
    if (!liveNow.players[playerId]?.onField) {
      void store.getState().retirePlayer(playerId);
      showToast(`${nameOf(playerId)} is out for the rest of the match`);
      return;
    }
    const rec = recommendSwaps(matchNow.config, matchNow.players, liveNow, { forceOff: [playerId] });
    if (rec.primary.length === 0) {
      setShortHandedRetire(playerId); // no one to bring on — confirm playing a player down
      return;
    }
    retireAfterRef.current = playerId;
    setSheet(rec);
  }

  /** Take the player off with no replacement and retire them — the team plays one short. */
  async function retireShortHanded(playerId: string): Promise<void> {
    setShortHandedRetire(null);
    await store.getState().manualSwap([playerId], []);
    await store.getState().retirePlayer(playerId);
    showToast(`${nameOf(playerId)} is out — you're a player short`);
  }

  /** Tap one player to select, a second to swap them (pitch↔pitch = positions, bench↔pitch = a sub). */
  function handleSelect(id: string): void {
    const liveNow = store.getState().live;
    const sel = selectedRef.current;
    if (!liveNow) return;
    if (sel === null) {
      setSelected(id);
      return;
    }
    if (sel === id) {
      setSelected(null);
      return;
    }
    const a = liveNow.players[sel];
    const b = liveNow.players[id];
    setSelected(null);
    if (!a || !b) return;
    const aSlot = a.currentSlot;
    const bSlot = b.currentSlot;
    if (a.onField && b.onField && aSlot && bSlot) {
      void store.getState().confirmSwaps(
        [],
        [
          { playerId: a.playerId, fromSlot: aSlot, toSlot: bSlot },
          { playerId: b.playerId, fromSlot: bSlot, toSlot: aSlot },
        ],
      );
    } else if (a.onField && !b.onField && aSlot) {
      void store.getState().manualSwap([a.playerId], [{ playerId: b.playerId, slot: aSlot }]);
      flash([b.playerId]);
      showToast(`Sub made · ${nameOf(b.playerId)} on`);
    } else if (b.onField && !a.onField && bSlot) {
      void store.getState().manualSwap([b.playerId], [{ playerId: a.playerId, slot: bSlot }]);
      flash([a.playerId]);
      showToast(`Sub made · ${nameOf(a.playerId)} on`);
    }
  }

  /**
   * Move the selected on-field player to a specific slot — no swap partner needed, the formation
   * simply reshapes. Complements tap-two swapping for the "move someone elsewhere" case.
   */
  function moveSelectedTo(toSlot: PositionSlot): void {
    const liveNow = store.getState().live;
    const sel = selectedRef.current;
    if (!liveNow || !sel) return;
    const p = liveNow.players[sel];
    if (!p || !p.onField || !p.currentSlot || p.currentSlot === toSlot) return;
    setSelected(null);
    void store.getState().confirmSwaps([], [{ playerId: p.playerId, fromSlot: p.currentSlot, toSlot }]);
    flash([p.playerId]);
    showToast(`${nameOf(p.playerId)} → ${slotShortName(toSlot)}`);
  }

  /**
   * Apply a suggestion ONE SWAP AT A TIME, ~1.5s apart, so the coach watches each sticker land
   * rather than the whole album rearranging at once. Subs are like-for-like, so each stands alone.
   */
  async function confirmSheet(rec: Recommendation): Promise<void> {
    const swaps = rec.primary;
    setSheet(null);
    // A retirement waiting on this sub is applied AFTER the swaps land. The live store serialises
    // commits, so awaiting the loop guarantees the player is off the field before they're retired —
    // the store then refuses any retirement of an on-field player as a second line of defence.
    const retiring = retireAfterRef.current;
    retireAfterRef.current = null;
    if (swaps.length === 0) return;
    for (let i = 0; i < swaps.length; i++) {
      const s = swaps[i];
      if (!s) continue;
      // Position changes (only ever GK-policy ones) ride with the first swap.
      await store.getState().confirmSwaps([s], i === 0 ? rec.positionChanges : []);
      flash([s.playerOn]);
      showToast(`${nameOf(s.playerOn)} on${s.playerOff ? ` · ${nameOf(s.playerOff)} off` : ""}`);
      if (i < swaps.length - 1) {
        await new Promise<void>((resolve) => {
          timers.current.push(window.setTimeout(resolve, 1500));
        });
      }
    }
    if (swaps.length > 1) showToast(`✓ ${swaps.length} subs made`);
    if (retiring) {
      await store.getState().retirePlayer(retiring);
      showToast(`${nameOf(retiring)} is out for the rest of the match`);
    }
  }

  /* ── shared bits ───────────────────────────────────────────────────────── */

  /** One line of a suggestion: who peels off, who sticks on, into which position. */
  const swapLine = (offId: string | null, onId: string, slot: PositionSlot, onTap?: () => void, skip?: () => void) => {
    const body = (
      <>
        {offId !== null && <span className={la.swapOff}>{nameOf(offId)} ▼ off</span>}
        {offId !== null && <span className={la.swapArrow}>→</span>}
        <span className={la.swapOn}>{nameOf(onId)} ▲ on</span>
        <span className={la.swapPos}>{slotFullName(slot)}</span>
        {/* Only ever rendered when the row itself is NOT a button (the sheet's rows). */}
        {skip && (
          <button
            type="button"
            className={la.skipBtn}
            aria-label={`Skip subbing ${nameOf(onId)}`}
            onClick={skip}
          >
            ×
          </button>
        )}
      </>
    );
    return onTap ? (
      <button key={onId} type="button" className={la.swapRow} onClick={onTap}>
        {body}
      </button>
    ) : (
      <div key={onId} className={la.swapRow}>
        {body}
      </div>
    );
  };

  /** A bench player as a sticker — or, when the suggestion names them ON, as the MISSING slot. */
  const benchSticker = (p: Player) => {
    const lp = live.players[p.id];
    const sec = lp?.secondsOnField ?? 0;
    const st = statusOf(p.id);
    const frozen = live.status === "full-time";
    if (suggestedOnIds.has(p.id) && !frozen) {
      return (
        <MissingSlot
          key={p.id}
          name={p.name}
          note="on next!"
          detail={
            <>
              {mins(sec)} <StatusChip kind={st} />
            </>
          }
          selected={selected === p.id}
          onClick={() => handleSelect(p.id)}
          ariaLabel={`${p.name} — suggested on next. ${Math.round(sec / 60)} minutes played.`}
        />
      );
    }
    return (
      <PlayerSticker
        key={p.id}
        playerId={p.id}
        name={lateWaiting(p.id) ? `🕑 ${p.name}` : p.name}
        seconds={sec}
        status={st}
        scoreMark={scoreMarkOf(lp)}
        selected={selected === p.id}
        disabled={frozen}
        onClick={() => handleSelect(p.id)}
      />
    );
  };

  /* ── PRE-MATCH — the team sheet ────────────────────────────────────────── */

  if (live.status === "pre-match") {
    const windows = planWindows ?? [];
    const benchFirst = match.players.filter(
      (p) => !startingLineup.some((a) => a.playerId === p.id) && p.availability !== "unavailable",
    );
    return (
      <main className={styles.page} style={{ display: "flex", flexDirection: "column", paddingBottom: 0 }}>
        <header className={styles.header}>
          <span className={la.brand}>
            <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
              ←
            </Link>
            <Logo />
          </span>
          <HandNote size={19} rotate={2}>
            {match.config.onFieldCount}
            {cfg.formatSuffix} · {match.config.periods}×{match.config.periodLengthMinutes}′
          </HandNote>
        </header>

        <div className={cx(styles.gutter, la.grow)}>
          <h1 style={{ fontSize: 26, marginTop: 12 }}>{match.name}</h1>
          <p className={styles.body}>
            Review the planned changes — retime them, swap who&apos;s involved, or add and remove one.
            The projected minutes update as you edit. Tap <strong>{cfg.startLabel}</strong> when
            you&apos;re happy; the match follows this as a guide, and you can change any of it live.
          </p>

          <Kicker>Rotation</Kicker>
          <SubFrequency
            value={subFrequency}
            onChange={(level) => void changeSubFrequency(level)}
            summary={cadenceSummary(windows.map((w) => w.atSeconds), total)}
            note="The whole plan below rebuilds as you move this — check the projected minutes to see what it costs."
          />

          {/* Renders its own kicker — the plan and the live screen must show one card. */}
          <ProjectedMinutes
            rows={planProjection}
            caption="if the plan runs"
            footnote="retime or edit the changes below to shift it"
          />

          <Kicker>The changes</Kicker>
          <PlanTimeline
            config={match.config}
            players={match.players}
            startingLineup={startingLineup}
            windows={windows}
            onChange={updatePlan}
            totalSeconds={total}
          />

          <Kicker>Starting {match.config.onFieldCount}</Kicker>
          {/* The team sheet as a picture, before it's a list. Nothing is selectable yet — there are
              no live actions before kick-off — so this prints as a plain album spread. */}
          <AlbumPitch
            surface={cfg.surface}
            players={startingLineup.map(
              (a): FigurePlayer => ({
                id: a.playerId,
                name: nameOf(a.playerId),
                slot: a.slot,
                locked: false,
                secondsOnField: 0,
                status: null,
                flagged: false,
                note: slotShortName(a.slot),
              }),
            )}
            caption={
              <HandNote size={19} rotate={-1}>
                how you line up at {cfg.startLabel.toLowerCase()} ↑
              </HandNote>
            }
            legend={false}
          />
          <div>
            {startingLineup.map((a, i) => (
              <div key={a.playerId} className={cx(styles.row, i === startingLineup.length - 1 && styles.rowLast)}>
                <span className={la.rowName}>
                  {a.slot === "GK" ? "🧤 " : ""}
                  {nameOf(a.playerId)}
                </span>
                <span className={la.previewTag}>{slotFullName(a.slot)}</span>
              </div>
            ))}
          </div>

          <Kicker>The bench</Kicker>
          {benchFirst.length === 0 ? (
            <p className={styles.note}>No substitutes — everyone starts.</p>
          ) : (
            <div className={la.benchGrid}>
              {benchFirst.map((p) => {
                const on = windows.find((w) => w.on.some((o) => o.playerId === p.id));
                return (
                  <PlayerSticker
                    key={p.id}
                    playerId={p.id}
                    name={p.availability === "arrives-late" ? `🕑 ${p.name}` : p.name}
                    footer={on ? `on @ ${Math.round(on.atSeconds / 60)}′` : "not planned in"}
                  />
                );
              })}
            </div>
          )}
          <p className={la.footnote}>Late arrival? Mark them in — the plan rebuilds.</p>
        </div>

        <div className={cx(styles.actionBar, la.barCol)}>
          <HardButton variant="green" onClick={() => void store.getState().kickOff()}>
            {cfg.startLabel} ▶
          </HardButton>
          <p className={cx(la.footnote, la.footnoteBar)}>Nothing is final · change any of it live</p>
        </div>
      </main>
    );
  }

  /* ── LIVE / FULL TIME ──────────────────────────────────────────────────── */

  const periodBug = `${cfg.periodLabel.charAt(0)}${live.period} of ${match.config.periods}`;
  const bugText =
    live.status === "full-time"
      ? cfg.endLabel
      : live.status === "period-break"
        ? cfg.breakLabel
        : inExtraTime
          ? `Added time · ${periodBug}`
          : `${running ? "Live" : "Paused"} · ${periodBug}`;

  const clockAction = running
    ? { label: "Pause the clock", text: "⏸ Hold", run: () => void store.getState().pause() }
    : live.status === "paused"
      ? { label: "Resume the clock", text: "▶ Play", run: () => void store.getState().resume() }
      : null;

  const clockNote =
    teamScore > 0
      ? `${match.name} · ${cfg.scoreIcon} ${teamScore}`
      : `${match.name} · ${match.config.onFieldCount}${cfg.formatSuffix}${formationLabel ? ` · ${formationLabel}` : ""}`;

  const frozen = live.status === "full-time";

  return (
    <main className={styles.page} style={{ display: "flex", flexDirection: "column", paddingBottom: 0 }}>
      {/* Header: the logo vs the LIVE pill — the album's masthead during play. */}
      <header className={styles.header}>
        <span className={la.brand}>
          <Link href={`/teams/${teamId}`} className={styles.backLink} aria-label="Back to the team">
            ←
          </Link>
          <Logo />
        </span>
        <Pill tone={running ? "red" : "neutral"} dot={running}>
          {bugText}
        </Pill>
      </header>

      {/* Clock row: the big tabular clock, the handwritten margin note, and the clock's own
          controls — Hold, and End half when a period can legitimately finish early. */}
      <div className={cx(styles.gutter, la.clockRow)}>
        <div className={la.clockCol}>
          <span className={la.clock} aria-label={`${Math.floor(live.elapsedSeconds / 60)} minutes played`}>
            {clockTime(live.elapsedSeconds)}
          </span>
          <span className={la.clockNote}>
            <HandNote size={19}>{clockNote}</HandNote>
          </span>
        </div>
        {/* Basketball's period clock runs DOWN, and that's the number everyone is watching —
            but elapsed still leads, because minutes PLAYED is what this app is about. */}
        {cfg.clockCountsDown && (
          <span
            className={la.clockAside}
            aria-label={`${Math.floor(periodRemaining / 60)} minutes left in ${periodWord} ${live.period}`}
          >
            <span className={la.clockAsideValue}>{clockTime(periodRemaining)}</span>
            <span className={la.clockAsideLabel}>left in {cfg.periodLabel}</span>
          </span>
        )}
        {/* Grouped so they wrap to a second line TOGETHER when basketball's aside eats the width. */}
        <div className={la.clockBtns}>
          {clockAction && (
            <button type="button" className={la.holdBtn} onClick={clockAction.run} aria-label={clockAction.label}>
              {clockAction.text}
            </button>
          )}
          {/* Youth games finish a period early all the time — the ref blows up, it's freezing, a
              team has to leave. It sits BESIDE Hold because it is a clock action and the clock is
              what the coach is looking at when the whistle goes early; it is also a long way from
              "Sub now" in the sticky bar. Deliberately absent in the FINAL period — ending that
              early is ending the match, and "End match" already does it properly. */}
          {canEndPeriod && (
            <button
              type="button"
              className={la.holdBtn}
              onClick={() => setConfirmKind("endperiod")}
              aria-label={`End ${periodWord} ${live.period} now`}
            >
              End {periodWord}
            </button>
          )}
        </div>
      </div>

      <div className={cx(styles.gutter, la.grow)}>
        {/* Half time / period break */}
        {live.status === "period-break" && (
          <div className={la.panelCard} style={{ ["--tilt" as string]: `${tilt("break", 1)}deg` }}>
            <span className={la.panelTitle}>{cfg.breakLabel}</span>
            <p className={styles.body}>
              Behind on minutes:{" "}
              {rows
                .filter((r) => r.eligible && r.debtSeconds > 60)
                .sort((x, y) => y.debtSeconds - x.debtSeconds)
                .slice(0, 3)
                .map((r) => nameOf(r.playerId))
                .join(", ") || "everyone's even"}
            </p>
            <div style={{ marginTop: 12 }}>
              <HardButton variant="green" size="md" onClick={() => void store.getState().startNextPeriod()}>
                Start {cfg.periodLabel} {live.period + 1} ▶
              </HardButton>
            </div>
          </div>
        )}

        {/* Full time */}
        {live.status === "full-time" && (
          <div className={la.panelCard} style={{ ["--tilt" as string]: `${tilt("fulltime", 1)}deg` }}>
            <span className={la.panelTitle}>{cfg.endLabel}</span>
            <p className={styles.body}>
              Every minute is in the album. The final page has the box score, the fairness spread and
              the swapsies note for the parents&apos; chat.
            </p>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <HardButtonLink href={`/teams/${teamId}/match/${matchId}/review`} variant="red" size="md">
                See the finished page →
              </HardButtonLink>
              <HardButton variant="outline" size="md" onClick={() => setConfirmKind("restart")}>
                Restart match
              </HardButton>
            </div>
          </div>
        )}

        {/* THE ALBUM PAGE — the players on, standing in formation as mini stickers. Tapping a
            sticker runs the same handler as tapping anywhere else that player appears. */}
        <div style={{ marginTop: 16 }}>
          <AlbumPitch
            surface={cfg.surface}
            players={onField.map(
              (p): FigurePlayer => ({
                id: p.playerId,
                name: nameOf(p.playerId),
                slot: p.currentSlot,
                locked: p.locked,
                secondsOnField: p.secondsOnField,
                status: statusOf(p.playerId),
                flagged: pulseId === p.playerId,
                scoreMark: scoreMarkOf(p),
              }),
            )}
            onSelect={handleSelect}
            selectedId={selected}
            flashIds={flashIds}
            frozen={frozen}
            caption={
              <HandNote size={19} rotate={-1}>
                {frozen
                  ? `${cfg.endLabel.toLowerCase()} — the page as it finished`
                  : "tap a sticker to swap ↑"}
              </HandNote>
            }
          />
        </div>

        {/* THE BENCH — stickers waiting to go on. Anyone the suggestion names ON is a MISSING slot:
            the album has a gap where they should be. */}
        <Kicker>The bench</Kicker>
        {benchPlayers.length === 0 ? (
          <p className={styles.note}>Nobody on the bench.</p>
        ) : (
          <div className={la.benchGrid}>{benchPlayers.map((p) => benchSticker(p))}</div>
        )}

        {/* Out for the match — visible, not hidden away, so the coach can see who they've lost and
            put anyone back if they're fit again. */}
        {retiredPlayers.length > 0 && (
          <>
            <Kicker>🚑 Out for the match</Kicker>
            <div className={la.outList}>
              {retiredPlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={la.outBtn}
                  aria-label={`Bring ${p.name} back into the rotation`}
                  disabled={frozen}
                  onClick={() => {
                    void store.getState().unretirePlayer(p.id);
                    showToast(`${p.name} is back in the rotation`);
                  }}
                >
                  ↩ {p.name}{" "}
                  <span className={la.outMins}>· {mins(live.players[p.id]?.secondsOnField ?? 0)}</span>
                </button>
              ))}
            </div>
            <p className={la.footnote}>Their minutes share out among everyone still playing · tap to bring one back</p>
          </>
        )}

        {live.status !== "full-time" && (
          <div style={{ marginTop: 14 }}>
            <HardButton variant="outline" size="md" auto onClick={() => setAddOpen(true)}>
              + Add player
            </HardButton>
          </div>
        )}

        {/* NEXT CHANGE — the shiny rare. The pinned countdown and, when the plan names one, the
            change itself: swap rows, progress, confirm/snooze. It never subs by itself. */}
        {running && nextChange !== null && (
          <div className={la.foilWrap}>
            <FoilNextChange
              badge={due ? "⇄ Change due" : snoozed ? "⏱ Snoozed" : "⇄ Next change"}
              title={snoozed ? "Snoozed — back in" : due ? "Change due now" : "Next change"}
              count={due ? "NOW" : countdown(remaining)}
              pct={due ? 100 : cdPct * 100}
            >
              {panelRec ? (
                <>
                  <div>
                    {panelRec.primary.map((s) => swapLine(s.playerOff, s.playerOn, s.toSlot, openSuggestion))}
                  </div>
                  <div className={la.foilBtns}>
                    <span className={la.foilConfirm}>
                      <HardButton variant="green" size="md" onClick={() => void confirmSheet(panelRec)}>
                        {panelRec.primary.length > 1 ? `Confirm all (${panelRec.primary.length})` : "Confirm sub"}
                      </HardButton>
                    </span>
                    <button type="button" className={la.snoozeBtn} onClick={() => void store.getState().snooze(1)}>
                      ⏱ Snooze 1′
                    </button>
                  </div>
                  {panelRec.note !== undefined && panelRec.note !== "" && (
                    <p className={styles.note}>{panelRec.note}</p>
                  )}
                  <p className={la.footnote}>Tap a row to edit · it never subs by itself</p>
                </>
              ) : (
                <>
                  <div className={la.foilBtns}>
                    <span className={la.foilConfirm}>
                      <HardButton variant="green" size="md" onClick={openSuggestion}>
                        ⇄ See the suggestion
                      </HardButton>
                    </span>
                    <button type="button" className={la.snoozeBtn} onClick={() => void store.getState().snooze(1)}>
                      ⏱ Snooze 1′
                    </button>
                  </div>
                  <p className={la.footnote}>Nothing is applied until you confirm it</p>
                </>
              )}
            </FoilNextChange>
          </div>
        )}

        {/* What ACTUALLY happened. Open by default and above the plan: mid-match this is the
            question the coach is asking — the plan is a forecast, this is the record. */}
        {feed.length > 0 && (
          <details className={la.details} open>
            <summary className={la.detailsHead}>
              <span>Match log · {subsMade} sub{subsMade === 1 ? "" : "s"}</span>
              <span className={la.detailsMark} aria-hidden>
                <span className={la.markOpen}>▾</span>
                <span className={la.markClosed}>▸</span>
              </span>
            </summary>
            <div className={styles.cardInset} style={{ marginTop: 10 }}>
              {feed.map((e, i) => {
                const wall = wallClockLabel(e.wallClockISO);
                return (
                  <div key={e.key} className={cx(la.logRow, i === feed.length - 1 && la.logRowLast)}>
                    <span className={la.logTime}>{clockTime(e.atSeconds)}</span>
                    <span className={la.logText}>{feedLineText(e, feedLabels)}</span>
                    {wall !== null && <span className={la.logClock}>{wall}</span>}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* The plan from here on — only what's still ahead, so it can never be mistaken for a
            record of what was done. Plus the rotation dial, which re-plans these windows live. */}
        {live.status !== "full-time" && (
          <details className={la.details}>
            <summary className={la.detailsHead}>
              <span>
                Still to come · {upcomingWindows.length} change{upcomingWindows.length === 1 ? "" : "s"}
              </span>
              <span className={la.detailsMark} aria-hidden>
                <span className={la.markOpen}>▾</span>
                <span className={la.markClosed}>▸</span>
              </span>
            </summary>
            <div style={{ marginTop: 10 }}>
              <UpcomingTimeline
                windows={upcomingWindows}
                players={match.players}
                nextAtSeconds={nextChange?.atSeconds ?? null}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <SubFrequency
                value={subFrequency}
                onChange={(level) => void changeSubFrequency(level)}
                summary={cadenceSummary(upcomingWindows.map((w) => w.atSeconds), total)}
                note="Changes already made stay as they are — only what's ahead is re-planned."
              />
            </div>
            {/* Where everyone LANDS: minutes played plus what the remaining plan adds. Same card as
                before kick-off, so moving the dial mid-match shows its cost the same way. */}
            <ProjectedMinutes
              rows={liveProjection}
              caption="played + still planned"
              footnote="move the dial above, or make a change yourself"
            />
          </details>
        )}

        {/* End / restart live under everything else rather than in the sticky bar: they're the two
            things you must never hit by accident, and "Sub now" is the button you hit all game. */}
        {live.status !== "full-time" && (
          <>
            <Kicker>Match control</Kicker>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <HardButton variant="outline" size="md" auto onClick={() => setConfirmKind("restart")}>
                Restart
              </HardButton>
              <HardButton variant="red" size="md" auto onClick={() => setConfirmKind("end")}>
                End match
              </HardButton>
            </div>
          </>
        )}
      </div>

      {/* Sticky actions. With a player selected this becomes their action desk, so tap-two-to-swap
          still works — the selection survives, because nothing here is a modal. */}
      {live.status !== "full-time" && (
        <div className={cx(styles.actionBar, la.barCol)}>
          {selectedPlayer ? (
            <>
              <div className={la.selHead}>
                <span>{nameOf(selectedPlayer.playerId)}</span>
                <span className={la.selSlot}>
                  {selectedPlayer.onField
                    ? selectedPlayer.currentSlot
                      ? slotFullName(selectedPlayer.currentSlot)
                      : "on"
                    : "bench"}
                </span>
              </div>

              {/* Basketball: a score is worth 1, 2 or 3, so the coach has to say which. */}
              {selectedPlayer.onField && cfg.scoreOptions.length > 1 && (
                <div className={la.chipRow}>
                  <span className={styles.label}>{cfg.scoreLabel}</span>
                  {cfg.scoreOptions.map((pts) => (
                    <button
                      key={pts}
                      type="button"
                      className={la.chip}
                      aria-label={`${nameOf(selectedPlayer.playerId)} scored ${pts} point${pts === 1 ? "" : "s"}`}
                      onClick={() => logScore(selectedPlayer.playerId, pts)}
                    >
                      {cfg.scoreIcon} {pts} pt
                    </button>
                  ))}
                </div>
              )}

              {/* Move to any position — one tap, no swap partner needed. */}
              {selectedPlayer.onField && selectedPlayer.currentSlot && (
                <div className={la.chipRow}>
                  <span className={styles.label}>Move to</span>
                  {cfg.moveTargets.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={cx(la.chip, selectedPlayer.currentSlot === slot && la.chipOn)}
                      disabled={selectedPlayer.currentSlot === slot}
                      aria-label={`Move ${nameOf(selectedPlayer.playerId)} to ${slotFullName(slot)}`}
                      onClick={() => moveSelectedTo(slot)}
                    >
                      {slotShortName(slot)}
                    </button>
                  ))}
                </div>
              )}

              <div className={la.actionGrid}>
                {selectedLate && (
                  <button
                    type="button"
                    className={cx(la.miniBtn, la.miniBtnInk)}
                    onClick={() => {
                      const id = selectedPlayer.playerId;
                      void store.getState().markArrived(id);
                      showToast(`🕑 ${nameOf(id)} is here — in the rotation now`);
                      setSelected(null);
                    }}
                  >
                    🕑 Arrived
                  </button>
                )}
                {selectedPlayer.onField && (
                  <button
                    type="button"
                    className={la.miniBtn}
                    onClick={() => {
                      void store.getState().toggleLock(selectedPlayer.playerId);
                      setSelected(null);
                    }}
                  >
                    {selectedPlayer.locked ? "🔓 Release" : "🔒 Keep on"}
                  </button>
                )}
                {/* One-value sports log a score in a single tap; 1/2/3 sports get the row above. */}
                {selectedPlayer.onField && cfg.scoreOptions.length === 1 && (
                  <button
                    type="button"
                    className={la.miniBtn}
                    onClick={() => logScore(selectedPlayer.playerId, cfg.scoreOptions[0] ?? 1)}
                  >
                    {cfg.scoreIcon} {cfg.scoreLabel}
                  </button>
                )}
                {selectedPlayer.onField && (
                  <button
                    type="button"
                    className={cx(la.miniBtn, la.miniBtnInk)}
                    onClick={() => {
                      setSheet(
                        recommendSwaps(match.config, match.players, live, {
                          forceOff: [selectedPlayer.playerId],
                        }),
                      );
                      setSelected(null);
                    }}
                  >
                    Sub off →
                  </button>
                )}
                <button
                  type="button"
                  className={cx(la.miniBtn, la.miniBtnRed)}
                  onClick={() => startRetire(selectedPlayer.playerId)}
                >
                  🚑 Out
                </button>
                <button type="button" className={la.miniBtn} onClick={() => setSelected(null)}>
                  Cancel
                </button>
              </div>
              <p className={cx(la.footnote, la.footnoteBar)}>
                {selectedPlayer.onField
                  ? "Tap another player to swap · tap a bench sticker to sub them on"
                  : "Now tap a sticker on the pitch to bring this one on in their place"}
              </p>
            </>
          ) : (
            <>
              <div className={la.actionRow}>
                <button type="button" className={la.actionBtn} onClick={() => setGoalOpen(true)}>
                  {cfg.scoreIcon} {cfg.scoreLabel}
                </button>
                <button type="button" className={la.actionBtn} onClick={openSuggestion}>
                  ⇄ Sub now
                </button>
              </div>
              <p className={cx(la.footnote, la.footnoteBar)}>
                Tap a player for their actions · tap two to swap
              </p>
            </>
          )}
        </div>
      )}

      {toast !== null && <Toast message={toast} />}

      {/* Suggested change — editable, skippable, never automatic. */}
      {sheet && (
        <Sheet onClose={closeSheet}>
          {sheet.primary.length === 0 ? (
            <>
              <h2 className={styles.sheetTitle}>All balanced</h2>
              <p className={styles.body}>Squad&apos;s even on minutes — no change needed right now.</p>
            </>
          ) : (
            <>
              <h2 className={styles.sheetTitle}>
                {sheet.primary.length > 1 ? `${sheet.primary.length} suggested changes` : "Suggested change"}
              </h2>
              <p className={styles.body}>Keeps minutes fair. You&apos;re in control — edit or skip any.</p>

              <div>
                {sheet.primary.map((s, i) =>
                  swapLine(
                    s.playerOff,
                    s.playerOn,
                    s.toSlot,
                    undefined,
                    sheet.primary.length > 1
                      ? () => setSheet({ ...sheet, primary: sheet.primary.filter((_, j) => j !== i) })
                      : undefined,
                  ),
                )}
              </div>

              {/* What confirming leaves on the pitch — the effect before the commit. */}
              {previewState && (
                <>
                  <Kicker>After the change</Kicker>
                  <div>
                    {Object.values(previewState.players)
                      .filter((p) => p.onField)
                      .map((p) => {
                        const incoming = sheet.primary.some((s) => s.playerOn === p.playerId);
                        return (
                          <div key={p.playerId} className={la.previewRow}>
                            <span className={incoming ? la.previewIn : undefined}>
                              {p.currentSlot === "GK" ? "🧤 " : ""}
                              {nameOf(p.playerId)}
                            </span>
                            <span className={la.previewTag}>
                              {incoming ? "▲ coming on · " : ""}
                              {p.currentSlot ? slotFullName(p.currentSlot) : ""}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}

              {sheet.note !== undefined && sheet.note !== "" && <p className={styles.body}>{sheet.note}</p>}
              <div className={la.sheetStack}>
                <HardButton variant="green" onClick={() => void confirmSheet(sheet)}>
                  {sheet.primary.length > 1 ? `Confirm all (${sheet.primary.length})` : "Confirm sub"}
                </HardButton>
              </div>
            </>
          )}
          <div className={la.sheetRow}>
            <button
              type="button"
              className={la.snoozeBtn}
              onClick={() => {
                void store.getState().snooze(1);
                closeSheet();
              }}
            >
              ⏱ Snooze 1′
            </button>
            <HardButton variant="outline" size="md" auto onClick={closeSheet}>
              Dismiss
            </HardButton>
          </div>
        </Sheet>
      )}

      {/* Who scored — logging never touches minutes, fairness or the countdown. */}
      {goalOpen && (
        <Sheet onClose={() => setGoalOpen(false)}>
          <h2 className={styles.sheetTitle}>Who scored?</h2>
          <p className={styles.body}>
            It goes on their sticker and into their season page. Minutes and the plan are untouched.
          </p>
          <div style={{ marginTop: 12 }}>
            {onField.map((p, i) => (
              <div key={p.playerId} className={cx(styles.row, i === onField.length - 1 && styles.rowLast)}>
                <span className={la.rowName}>
                  {p.currentSlot === "GK" ? "🧤 " : ""}
                  {nameOf(p.playerId)}
                </span>
                {cfg.scoreOptions.length > 1 ? (
                  cfg.scoreOptions.map((pts) => (
                    <button
                      key={pts}
                      type="button"
                      className={la.chip}
                      aria-label={`${nameOf(p.playerId)} scored ${pts} point${pts === 1 ? "" : "s"}`}
                      onClick={() => logScore(p.playerId, pts)}
                    >
                      {pts}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    className={la.chip}
                    aria-label={`${nameOf(p.playerId)} scored`}
                    onClick={() => logScore(p.playerId, cfg.scoreOptions[0] ?? 1)}
                  >
                    {cfg.scoreIcon} {cfg.scoreLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className={la.sheetStack}>
            <HardButton variant="outline" onClick={() => setGoalOpen(false)}>
              Cancel
            </HardButton>
          </div>
        </Sheet>
      )}

      {/* A surprise arrival joins mid-match: a roster pick, or a brand-new name (also saved to the
          team roster). They join the bench with a fair share pro-rated from this minute. */}
      {addOpen && (
        <Sheet onClose={() => setAddOpen(false)}>
          <h2 className={styles.sheetTitle}>Add a player</h2>
          <p className={styles.body}>
            They join the bench and the rotation from now — minutes already played stay as they are,
            and their fair share counts from this minute.
          </p>
          {rosterNotInSquad.length > 0 && (
            <>
              <Kicker>From the team</Kicker>
              <div className={la.outList}>
                {rosterNotInSquad.map((p) => (
                  <button key={p.id} type="button" className={la.outBtn} onClick={() => void addExistingPlayer(p)}>
                    + {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <Kicker>Someone new</Kicker>
          <div className={la.addRow}>
            <input
              placeholder="First name"
              aria-label="New player's first name"
              value={newName}
              maxLength={40}
              onChange={(e) => setNewName(e.target.value)}
            />
            <HardButton
              variant="green"
              size="md"
              auto
              onClick={() => void addNewPlayer()}
              disabled={newName.trim().length === 0}
            >
              Add
            </HardButton>
          </div>
          <p className={la.footnote}>New names are saved to the team roster for next time</p>
          <div className={la.sheetStack}>
            <HardButton variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </HardButton>
          </div>
        </Sheet>
      )}

      {/* Retiring an on-field player with an empty bench is a real situation (injury, no subs left),
          so it's a confirmation rather than a block — but the cost is stated plainly first. */}
      {shortHandedRetire !== null && (
        <Sheet onClose={() => setShortHandedRetire(null)}>
          <h2 className={styles.sheetTitle}>No one left on the bench</h2>
          <p className={styles.body}>
            {nameOf(shortHandedRetire)} will come off with no replacement, so you&apos;ll finish with{" "}
            {match.config.onFieldCount - 1} {cfg.onSurfaceLabel}. Everyone still playing picks up the
            extra minutes.
          </p>
          <div className={la.sheetStack}>
            <HardButton variant="red" onClick={() => void retireShortHanded(shortHandedRetire)}>
              Take them off anyway
            </HardButton>
            <HardButton variant="outline" onClick={() => setShortHandedRetire(null)}>
              Cancel
            </HardButton>
          </div>
        </Sheet>
      )}

      {/* End period / end match / restart / full-time. Every one of these is costly to mis-tap in
          the middle of a game, so they all come through this one sheet. */}
      {confirmKind !== null && (
        <Sheet onClose={() => setConfirmKind(null)}>
          <h2 className={styles.sheetTitle}>
            {confirmKind === "fulltime"
              ? cfg.endLabel
              : confirmKind === "restart"
                ? "Restart the match?"
                : confirmKind === "endperiod"
                  ? `End the ${periodWord} now?`
                  : "End the match?"}
          </h2>
          <p className={styles.body}>
            {confirmKind === "fulltime"
              ? "Regulation time is up. End the match, or play on into added time?"
              : confirmKind === "restart"
                ? "This wipes the clock and every change and returns to your starting lineup. It can't be undone."
                : confirmKind === "endperiod"
                  ? `The clock stops at ${clockTime(live.elapsedSeconds)} and it's ${cfg.breakLabel.toLowerCase()}. ${cfg.periodLabel} ${live.period + 1} still gets its full ${match.config.periodLengthMinutes} minutes from the restart, and nobody's minutes change.`
                  : "You'll go to the finished page and these minutes carry into the season. It can't be undone."}
          </p>
          <div className={la.sheetStack}>
            {confirmKind === "restart" ? (
              <HardButton
                variant="red"
                onClick={() => {
                  void store.getState().restart();
                  setConfirmKind(null);
                }}
              >
                Restart match
              </HardButton>
            ) : confirmKind === "endperiod" ? (
              <HardButton
                variant="green"
                onClick={() => {
                  void store.getState().endPeriod();
                  setConfirmKind(null);
                }}
              >
                End {periodWord}
              </HardButton>
            ) : (
              <HardButton
                variant="red"
                onClick={() => {
                  void store.getState().endMatch();
                  setConfirmKind(null);
                }}
              >
                End match
              </HardButton>
            )}
            <HardButton variant="outline" onClick={() => setConfirmKind(null)}>
              {confirmKind === "fulltime" ? "Play on (added time)" : "Cancel"}
            </HardButton>
          </div>
        </Sheet>
      )}
    </main>
  );
}

/* ── the foil card's fixed furniture ─────────────────────────────────────── */

/** The "⇄ NEXT CHANGE" shiny rare: badge, title vs countdown, progress track, then the caller's
 * swap rows and buttons. Kept beside the page (not in src/ui) because only this screen prints it. */
function FoilNextChange({
  badge,
  title,
  count,
  pct,
  children,
}: {
  badge: string;
  title: string;
  count: string;
  pct: number;
  children: ReactNode;
}) {
  return (
    <FoilCard badge={badge} tiltDeg={0.6}>
      <div className={la.foilHead}>
        <span className={la.foilTitle}>{title}</span>
        <span className={la.foilCount}>{count}</span>
      </div>
      <div className={la.foilProgress}>
        <ProgressTrack pct={pct} />
      </div>
      {children}
    </FoilCard>
  );
}
