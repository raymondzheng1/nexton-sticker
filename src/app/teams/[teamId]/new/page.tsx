"use client";
/**
 * "THE LINE-UP" — the pre-match page of the album.
 *
 * The wiring is the proven setup flow, ported 1:1: who's here (with 🕑 late arrivals and 🔒
 * always-on), the fixed-keeper picker, the format steppers, the rotation dial, and a live
 * projection that re-runs the engine's plan on every control change so the coach sees what a
 * decision COSTS while making it. On top of that, the plan itself is reviewed HERE: the starting
 * squad stands on the album pitch (tap two stickers to swap them), every planned change is an
 * editable timeline card, and the classic paper subbing sheet is printed from the same plan.
 *
 * The album grammar carries the meaning: chosen players are stickers, absent players grey out,
 * a late arrival gets the coach's handwritten "running late!", and the foil frame is reserved —
 * as everywhere in this app — for the ONE rare card, the first suggested change. Nothing here is
 * binding: the plan is a forecast, and the live page still asks before every change.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  buildPlan,
  isStartableAtKickoff,
  planFromLineup,
  stateAfterWindows,
  type GkPolicy,
  type LineupAssignment,
  type Match,
  type PlannedWindow,
  type Player,
  type RotationStyle,
} from "@/engine";
import { carryForwardSeeds } from "@/store";
import { useAppStore } from "@/store/appStore";
import { getRepo } from "@/store/clientRepo";
import type { SavedMatch } from "@/store/schema";
import { slotFullName, slotShortName, sportOf } from "@/features/sports";
import { AlbumPitch, type AlbumPlayer } from "@/features/live/AlbumPitch";
import { applyLineupDrag, benchFor } from "@/features/lineup/lineup";
import { PlanTimeline } from "@/features/plan/PlanTimeline";
import {
  ProjectedMinutes,
  fairShareSeconds,
  projectedRows,
  spreadSeconds,
  type ProjectedRow,
} from "@/features/plan/ProjectedMinutes";
import { SubFrequency, cadenceSummary, subLevelLabel } from "@/features/plan/SubFrequency";
import { SubbingSheet } from "@/features/match-setup/SubbingSheet";
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
  StickerFrame,
  cx,
  mins,
  styles,
  tilt,
} from "@/ui";
import ms from "@/features/match-setup/matchSetup.module.css";

// Clamps. Periods and minutes-per-period are the coach's format; the players-per-side range is the
// span of grassroots formats the surface layouts are drawn for — the number itself is never assumed
// anywhere downstream (invariant #1: everything derives from match.onFieldCount).
const PERIODS_MIN = 1;
const PERIODS_MAX = 4;
const SIDE_MIN = 3;
const SIDE_MAX = 11;
const PERIOD_LEN_MIN = 5;
const PERIOD_LEN_MAX = 45;
const TOLERANCE_MIN = 1;
const TOLERANCE_MAX = 6;

const ROTATIONS: { value: RotationStyle; label: string }[] = [
  { value: "continuous", label: "Continuous" },
  { value: "interval", label: "Interval" },
  { value: "period", label: "Period" },
];
const GK_POLICIES: { value: GkPolicy; label: string }[] = [
  { value: "countAsFieldTime", label: "Counts" },
  { value: "rotateSeparately", label: "Rotate" },
  { value: "fixedGK", label: "Fixed" },
];
const SUB_TIMINGS: { value: "settle" | "even"; label: string }[] = [
  { value: "settle", label: "Settle in" },
  { value: "even", label: "Even from kickoff" },
];
const CARRY_OPTIONS: { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "On (season)" },
  { value: "off", label: "Off (this match)" },
];

/** The step-badge colours cycle through the sticker faces. */
const BADGES: string[] = [ms.badgeRed ?? "", ms.badgeYellow ?? "", ms.badgeGreen ?? "", ms.badgeBlue ?? "", ms.badgePurple ?? ""];

/** Football's default, for a team record that predates the sport field. */
const FALLBACK_SIDE_SIZE = sportOf("football").defaultOnFieldCount;

/** m:ss, unpadded — how a change is written on the plan ("7:30", not "07:30"). */
function planTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "6 changes planned" — the caption beside the projection's kicker. */
function cadenceCaption(changes: number): string {
  return changes === 0 ? "no changes planned" : `${changes} change${changes === 1 ? "" : "s"} planned`;
}

/** What the footer strip of a squad sticker says pre-match: where they can play. */
function positionsLabel(p: Player): string {
  const spots = p.eligiblePositions.map((e) => slotShortName(e)).join(" · ");
  const base = spots === "" ? "any spot" : spots;
  return p.canPlayGK ? `🧤 ${base}` : base;
}

interface Projection {
  lineup: LineupAssignment[];
  windows: PlannedWindow[];
  rows: ProjectedRow[];
  /** The engine's reason it can't field this squad. Shown to the coach, never swallowed. */
  error: string | null;
}

export default function NewMatchPage() {
  const router = useRouter();
  const params = useParams<{ teamId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const ready = useAppStore((s) => s.ready);
  const team = useAppStore((s) => s.teams.find((t) => t.id === teamId));
  const createMatch = useAppStore((s) => s.createMatch);
  const listMatches = useAppStore((s) => s.listMatches);
  const prefs = useAppStore((s) => s.prefs);
  const sport = team?.sport ?? "football";
  const cfg = sportOf(sport);
  const [seasonMatches, setSeasonMatches] = useState<SavedMatch[]>([]);

  const [onFieldCount, setOnFieldCount] = useState(team?.defaultOnFieldCount ?? FALLBACK_SIDE_SIZE);
  const [periods, setPeriods] = useState(2);
  const [periodLength, setPeriodLength] = useState(25);
  const [rotationStyle, setRotationStyle] = useState<RotationStyle>(prefs.rotationStyle);
  // "settle" holds subs out of each period's opening minutes (default); "even" subs from minute 1.
  const [subTiming, setSubTiming] = useState<"settle" | "even">("settle");
  const [gkPolicy, setGkPolicy] = useState<GkPolicy>(prefs.gkPolicy);
  const [tolerance, setTolerance] = useState(prefs.fairnessToleranceMinutes);
  const [subFrequency, setSubFrequency] = useState(prefs.subFrequency);
  const [available, setAvailable] = useState<string[]>(() => team?.roster.map((p) => p.id) ?? []);
  const [lateIds, setLateIds] = useState<string[]>([]);
  // Not part of the rotation (e.g. keeper/captain): guaranteed starter, never planned/suggested off.
  const [alwaysOnIds, setAlwaysOnIds] = useState<string[]>([]);
  // Fixed keeper per period (football default): index 0 = 1st half. Same person every period ⇒ one
  // whole-match keeper; different ⇒ the keeper swaps at each break. Seeded to the first keeper.
  const [gkByPeriodSel, setGkByPeriodSel] = useState<(string | null)[]>([]);
  // Season fair-play: factor each player's season minutes into this match's targets. Defaults to the
  // team setting (absent ⇒ OFF: fair per game); overridable per match here.
  const [carryForward, setCarryForward] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [stamp, setStamp] = useState("");
  // The coach's board edits (tap two stickers to swap) — null means the engine's auto-pick stands.
  const [lineupOverride, setLineupOverride] = useState<LineupAssignment[] | null>(null);
  // The coach's timeline edits — null means the engine's fresh plan for the current lineup stands.
  const [planEdits, setPlanEdits] = useState<PlannedWindow[] | null>(null);
  const [boardSel, setBoardSel] = useState<string | null>(null);
  const [boardNote, setBoardNote] = useState<string | null>(null);

  // The stamp is a real stamp. Written after mount so the server and the phone can't disagree
  // about what time it is.
  useEffect(() => {
    const now = new Date();
    setStamp(
      `${now.toLocaleDateString(undefined, { weekday: "short" })} ${now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    );
  }, []);

  // The team may load AFTER first render (direct navigation / async store). Seed squad, on-field
  // count, and the coach's default rules once the team arrives, without clobbering later edits.
  useEffect(() => {
    if (team && !seeded) {
      const c = sportOf(team.sport);
      setAvailable(team.roster.map((p) => p.id));
      setOnFieldCount(team.defaultOnFieldCount);
      setPeriods(c.defaultPeriods); // both sports default to 2 periods (30′ football, 18′ basketball)
      setPeriodLength(c.defaultPeriodLengthMinutes);
      setRotationStyle(prefs.rotationStyle);
      // Football defaults to a FIXED keeper (the coach picks one per half); basketball keeps the
      // coach's default policy (it has no keeper anyway).
      setGkPolicy(c.hasGoalkeeper ? "fixedGK" : prefs.gkPolicy);
      const firstKeeper = team.roster.find((p) => p.canPlayGK)?.id ?? null;
      setGkByPeriodSel(Array.from({ length: c.defaultPeriods }, () => firstKeeper));
      setTolerance(prefs.fairnessToleranceMinutes);
      setSubFrequency(prefs.subFrequency);
      setCarryForward(team.seasonCarryForward === true); // team default (absent ⇒ OFF: fair per game)
      setSeeded(true);
    }
  }, [team, seeded, prefs]);

  // Prior matches power the season carry-forward seed applied at kickoff (if the coach has it on).
  useEffect(() => {
    void listMatches(teamId).then(setSeasonMatches);
  }, [teamId, listMatches]);

  const availablePlayers = useMemo(
    () =>
      (team?.roster ?? [])
        .filter((p) => available.includes(p.id))
        .map((p) => ({
          ...p,
          ...(lateIds.includes(p.id)
            ? { availability: "arrives-late" as const, unavailableUntilMinute: periodLength }
            : null),
          ...(alwaysOnIds.includes(p.id) ? { alwaysOn: true } : null),
        })),
    [team, available, lateIds, alwaysOnIds, periodLength],
  );
  const byId = useMemo(() => new Map(availablePlayers.map((p) => [p.id, p])), [availablePlayers]);
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;

  const keeperOptions = useMemo(
    () => (team?.roster ?? []).filter((p) => p.canPlayGK && available.includes(p.id)),
    [team, available],
  );
  const firstKeeperId = keeperOptions[0]?.id ?? null;
  // The resolved keeper for each period: the coach's pick if still valid, else the first keeper —
  // always `periods` entries long (so changing the period count just extends with the 1st keeper).
  const resolvedGkByPeriod = useMemo(
    () =>
      Array.from({ length: periods }, (_, i) => {
        const sel = gkByPeriodSel[i];
        return sel !== undefined && sel !== null && keeperOptions.some((k) => k.id === sel) ? sel : firstKeeperId;
      }),
    [periods, gkByPeriodSel, keeperOptions, firstKeeperId],
  );
  const usingFixedGk = gkPolicy === "fixedGK" && firstKeeperId !== null;

  const config = useMemo<Match>(
    () => ({
      sport,
      onFieldCount,
      periods,
      periodLengthMinutes: periodLength,
      rolloverSubsAllowed: true,
      // No keeper in basketball ⇒ everyone's court time counts equally. Otherwise fixedGK only takes
      // effect once a keeper is chosen; else treat as counts-as-field-time.
      gkPolicy: !cfg.hasGoalkeeper
        ? "countAsFieldTime"
        : gkPolicy === "fixedGK" && !usingFixedGk
          ? "countAsFieldTime"
          : gkPolicy,
      // Per-half keepers (football). fixedGkPlayerId mirrors the 1st-half keeper for back-compat.
      fixedGkPlayerId: cfg.hasGoalkeeper && usingFixedGk ? resolvedGkByPeriod[0] ?? undefined : undefined,
      gkByPeriod:
        cfg.hasGoalkeeper && usingFixedGk
          ? resolvedGkByPeriod.filter((id): id is string => id !== null)
          : undefined,
      fairnessToleranceMinutes: tolerance,
      rotationStyle,
      subFrequency,
      availableSquad: availablePlayers.map((p) => p.id),
      // Shortest stint worth playing: 3′ for a normal game, scaled down for SHORT games (quarter of
      // the match, floor 1′) — otherwise a tiny game can only fit one sub window and fairness is
      // structurally impossible (e.g. a 6′ game split 6′-vs-3′).
      minStintMinutes: Math.min(3, Math.max(1, Math.round((periods * periodLength) / 4))),
      stabilityHold: subTiming === "settle",
    }),
    [
      sport,
      cfg.hasGoalkeeper,
      onFieldCount,
      periods,
      periodLength,
      gkPolicy,
      usingFixedGk,
      resolvedGkByPeriod,
      tolerance,
      rotationStyle,
      subTiming,
      subFrequency,
      availablePlayers,
    ],
  );

  const totalSec = periods * periodLength * 60;

  // Any rule or squad change makes the coach's board/timeline edits stale — the engine re-derives
  // both from the new inputs (the projection below), exactly as the proven wiring rebuilds its plan.
  useEffect(() => {
    setLineupOverride(null);
    setPlanEdits(null);
    setBoardSel(null);
    setBoardNote(null);
  }, [config, availablePlayers]);

  // The whole screen in one calculation: pick the starting squad (unless the coach re-stuck the
  // stickers), plan the changes (unless the coach edited the timeline), forward-simulate, and read
  // off where everyone finishes. Re-runs on every control change — that live re-projection IS the
  // feature.
  const projection = useMemo<Projection>(() => {
    try {
      const lineup = lineupOverride ?? buildPlan(config, availablePlayers).startingLineup.assignments;
      const windows = planEdits ?? planFromLineup(config, availablePlayers, lineup);
      const finalState = stateAfterWindows(config, availablePlayers, lineup, windows, totalSec);
      return {
        lineup,
        windows,
        rows: projectedRows(config, availablePlayers, finalState, totalSec),
        error: null,
      };
    } catch (e) {
      // The engine refuses squads it can't field (too few here, nobody in goal). Say so out loud —
      // the coach can fix it from the controls on this page (never a silent default).
      return {
        lineup: [],
        windows: [],
        rows: [],
        error: e instanceof Error ? e.message : "Can’t pick a line-up from this squad.",
      };
    }
  }, [config, availablePlayers, lineupOverride, planEdits, totalSec]);

  const fair = fairShareSeconds(projection.rows);
  const spread = spreadSeconds(projection.rows, fair);

  // The spares, with when the plan first brings each of them on.
  const bench = useMemo(() => {
    const onAt = new Map<string, number>();
    for (const w of projection.windows) {
      for (const o of w.on) if (!onAt.has(o.playerId)) onAt.set(o.playerId, w.atSeconds);
    }
    return benchFor(availablePlayers, projection.lineup)
      .map((p) => ({
        player: p,
        atSeconds: onAt.get(p.id) ?? null,
        late: lateIds.includes(p.id),
      }))
      .sort(
        (a, b) =>
          (a.atSeconds ?? Infinity) - (b.atSeconds ?? Infinity) || (a.player.name < b.player.name ? -1 : 1),
      );
  }, [projection, availablePlayers, lateIds]);

  function toggleAvailable(id: string): void {
    setAvailable((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Tap two stickers (board or bench) to swap them — pure lineup.ts logic, refusals explained. */
  function tapBoard(id: string): void {
    setBoardNote(null);
    const sel = boardSel;
    if (sel === null || sel === id) {
      setBoardSel(sel === id ? null : id);
      return;
    }
    const prev = projection.lineup;
    const next = applyLineupDrag(prev, availablePlayers, sel, id);
    const changed =
      next.length !== prev.length || next.some((a, i) => a.playerId !== prev[i]?.playerId || a.slot !== prev[i]?.slot);
    if (changed) {
      setLineupOverride(next);
      setPlanEdits(null); // a new starting squad ⇒ the engine re-plans the changes around it
    } else {
      const onField = new Set(prev.map((a) => a.playerId));
      const blocked = [sel, id]
        .map((x) => byId.get(x))
        .find((p) => p !== undefined && !onField.has(p.id) && !isStartableAtKickoff(p));
      setBoardNote(
        blocked
          ? `🕑 ${blocked.name} arrives later — they can’t start; the plan brings them on once they’re here.`
          : "Pick one sticker on the board and one on the bench (or two on the board) to swap them.",
      );
    }
    setBoardSel(null);
  }

  async function create(): Promise<void> {
    if (!team || projection.error !== null || projection.lineup.length === 0) return;
    setCreating(true);
    setCreateError(null);
    const stampedName = new Date().toLocaleDateString();
    // Season fair-play (per-match toggle, seeded from the team default): seed each player's debt from
    // how far they are below the squad's season average, capped at one match's fair share so it nudges
    // rather than dominates. Off ⇒ this match is balanced on its own (no season seed).
    let playersForMatch = availablePlayers;
    if (carryForward) {
      const ids = availablePlayers.map((p) => p.id);
      const seeds = carryForwardSeeds(seasonMatches, ids);
      const matchSeconds = config.periods * config.periodLengthMinutes * 60;
      const cap = Math.round((matchSeconds * config.onFieldCount) / Math.max(1, ids.length));
      playersForMatch = availablePlayers.map((p) => ({
        ...p,
        carryForwardSeconds: Math.max(-cap, Math.min(cap, seeds[p.id] ?? 0)),
      }));
    }
    try {
      const created = await createMatch({
        teamId: team.id,
        name: `${team.name} · ${stampedName}`,
        config,
        players: playersForMatch,
        startingLineup: projection.lineup,
      });
      // The plan the coach just reviewed IS the approved plan — persist it as the live guide, so the
      // match page opens on exactly the timeline they saw here (their edits included).
      await getRepo().updateMatch(created.id, { subPlan: projection.windows });
      router.push(`/teams/${team.id}/match/${created.id}`);
    } catch (e) {
      // A failed write must never leave the coach staring at a dead button.
      setCreating(false);
      setCreateError(e instanceof Error ? e.message : "Couldn’t save the match. Try again.");
    }
  }

  if (!team) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <Logo href="/" />
          <HandNote size={20} rotate={2}>
            {ready ? "no such team" : "one sec…"}
          </HandNote>
        </header>
        <div className={styles.gutter}>
          <p className={styles.empty}>{ready ? "That team isn’t in the album." : "Fetching the team sheet…"}</p>
          {ready && (
            <HardButtonLink href="/" variant="outline">
              Back to the album
            </HardButtonLink>
          )}
        </div>
      </main>
    );
  }

  const periodNoun = cfg.periodLabel.toLowerCase();
  const surfaceNoun = cfg.surfaceLabel.toLowerCase();
  const inCount = availablePlayers.length;
  const lateCount = lateIds.filter((id) => available.includes(id)).length;
  const alwaysOnCount = alwaysOnIds.filter((id) => available.includes(id)).length;
  const inPlayers = team.roster.filter((p) => available.includes(p.id));
  const flagSummary =
    lateCount === 0 && alwaysOnCount === 0
      ? "none flagged"
      : [lateCount > 0 ? `${lateCount} late` : null, alwaysOnCount > 0 ? `${alwaysOnCount} always on` : null]
          .filter((x): x is string => x !== null)
          .join(" · ");
  const keeperNames = usingFixedGk
    ? [...new Set(resolvedGkByPeriod.filter((id): id is string => id !== null))].map((id) => nameOf(id))
    : [];
  const cadence = cadenceSummary(
    projection.windows.map((w) => w.atSeconds),
    totalSec,
  );
  const firstChange = projection.windows[0];

  /* ── the steps, in the coach's order ────────────────────────────────────── */

  const steps: { key: string; title: string; aside: string; body: ReactNode }[] = [];

  steps.push({
    key: "squad",
    title: "Who’s here",
    aside: `${inCount} of ${team.roster.length} in`,
    body: (
      <>
        <div className={ms.squadGrid}>
          {team.roster.map((p) => {
            const isIn = available.includes(p.id);
            const isLate = isIn && lateIds.includes(p.id);
            const isAlwaysOn = isIn && alwaysOnIds.includes(p.id);
            return (
              <div key={p.id} className={ms.cell}>
                {isLate && (
                  <span className={ms.lateNote} aria-hidden>
                    <HandNote size={17} rotate={-4} color="var(--red-deep)">
                      running late!
                    </HandNote>
                  </span>
                )}
                <PlayerSticker
                  playerId={p.id}
                  name={p.name}
                  gk={p.canPlayGK}
                  emoji={p.canPlayGK ? undefined : cfg.scoreIcon}
                  locked={isAlwaysOn}
                  footer={isIn ? positionsLabel(p) : "not here"}
                  className={cx(!isIn && ms.out)}
                  onClick={() => toggleAvailable(p.id)}
                  ariaLabel={`${p.name} is ${isIn ? "here" : "not here"} today${isLate ? ", arrives late" : ""}${
                    isAlwaysOn ? ", always on" : ""
                  } — tap to mark them ${isIn ? "out" : "in"}`}
                />
              </div>
            );
          })}
        </div>
        <p className={styles.note}>Tap a sticker to mark a player in or out for today.</p>
        <details className={ms.fold}>
          <summary className={ms.foldHead}>
            <span className={ms.foldTitle}>🕑 LATE · 🔒 ALWAYS ON</span>
            <span className={ms.foldSum}>{flagSummary}</span>
          </summary>
          <div className={ms.foldBody}>
            {inPlayers.map((p, i) => {
              const isLate = lateIds.includes(p.id);
              const isAlwaysOn = alwaysOnIds.includes(p.id);
              return (
                <div key={p.id} className={cx(ms.flagRow, i === inPlayers.length - 1 && ms.flagRowLast)}>
                  <span className={ms.flagName} title={p.name}>
                    {p.canPlayGK ? "🧤 " : ""}
                    {p.name}
                  </span>
                  <div className={ms.flagBtns}>
                    <button
                      type="button"
                      aria-pressed={isAlwaysOn}
                      aria-label={`${p.name} always on (not rotated)`}
                      className={cx(ms.chip, isAlwaysOn && ms.chipOn)}
                      onClick={() => {
                        // Mutually exclusive with 🕑 Late — a guaranteed starter can't also be
                        // absent at kickoff.
                        setAlwaysOnIds((prev) =>
                          prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                        );
                        setLateIds((prev) => prev.filter((x) => x !== p.id));
                      }}
                    >
                      🔒 Always on
                    </button>
                    <button
                      type="button"
                      aria-pressed={isLate}
                      aria-label={`${p.name} arrives late`}
                      className={cx(ms.chip, isLate && ms.chipOn)}
                      onClick={() => {
                        setLateIds((prev) =>
                          prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                        );
                        setAlwaysOnIds((prev) => prev.filter((x) => x !== p.id));
                      }}
                    >
                      🕑 Late
                    </button>
                  </div>
                </div>
              );
            })}
            <p className={styles.note}>
              <strong>🔒 Always on</strong> = out of the rotation (keeper, captain…): starts, is never
              suggested off, and the rest of the squad shares what’s left. <strong>🕑 Late</strong> ={" "}
              arrives at {cfg.breakLabel.toLowerCase()}; the engine targets fair time over the window
              they’re actually here for.
            </p>
          </div>
        </details>
      </>
    ),
  });

  steps.push({
    key: "format",
    title: "The format",
    aside: `${periods}×${periodLength}′ · ${onFieldCount}v${onFieldCount}`,
    body: (
      <>
        <StickerFrame tiltDeg={tilt("format-card", 1)} className={ms.formatCard}>
          <div className={ms.formatRow}>
            <span className={styles.label}>{cfg.periodLabel}s</span>
            <Stepper
              value={periods}
              min={PERIODS_MIN}
              max={PERIODS_MAX}
              noun="periods"
              display={`${periods}`}
              onChange={setPeriods}
            />
          </div>
          <div className={ms.formatRow}>
            <span className={styles.label}>Minutes per {periodNoun}</span>
            <Stepper
              value={periodLength}
              min={PERIOD_LEN_MIN}
              max={PERIOD_LEN_MAX}
              noun={`minutes per ${periodNoun}`}
              display={`${periodLength}′`}
              onChange={setPeriodLength}
            />
          </div>
          <div className={cx(ms.formatRow, ms.formatRowLast)}>
            <span className={styles.label}>On the {surfaceNoun}</span>
            <Stepper
              value={onFieldCount}
              min={SIDE_MIN}
              max={SIDE_MAX}
              noun={`players on the ${surfaceNoun}`}
              display={`${onFieldCount} v ${onFieldCount}`}
              onChange={setOnFieldCount}
            />
          </div>
        </StickerFrame>
        <p className={styles.note}>
          {periods} × {periodLength}′ = {periods * periodLength} minutes of game time all told.
        </p>
      </>
    ),
  });

  if (cfg.hasGoalkeeper) {
    steps.push({
      key: "gk",
      title: "In goal",
      aside:
        gkPolicy === "fixedGK"
          ? keeperNames.length === 0
            ? "no keeper marked"
            : keeperNames.join(" / ")
          : gkPolicy === "countAsFieldTime"
            ? "counts as field time"
            : "keeper rotates",
      body: (
        <>
          <Chips options={GK_POLICIES} value={gkPolicy} onChange={setGkPolicy} ariaLabel="Goalkeeper policy" />
          <p className={styles.note}>
            <strong>Counts</strong> — goal time counts as field time. <strong>Rotate</strong> — the
            gloves rotate through the squad. <strong>Fixed</strong> — you name a keeper per {periodNoun}.
          </p>
          {gkPolicy === "fixedGK" &&
            (keeperOptions.length === 0 ? (
              <p className={cx(styles.note, ms.warn)}>
                No available keeper — mark a player 🧤 in the squad, or pick another policy.
              </p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {Array.from({ length: periods }, (_, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <span className={styles.label}>
                      {periods === 2
                        ? i === 0
                          ? "1st half keeper"
                          : "2nd half keeper"
                        : `${cfg.periodLabel} ${i + 1} keeper`}
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {keeperOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={resolvedGkByPeriod[i] === p.id}
                          aria-label={`${p.name} keeps ${
                            periods === 2 ? (i === 0 ? "the first half" : "the second half") : `period ${i + 1}`
                          }`}
                          className={cx(ms.chip, resolvedGkByPeriod[i] === p.id && ms.chipOn)}
                          onClick={() =>
                            setGkByPeriodSel((prev) => {
                              const next = Array.from({ length: periods }, (_, k) => prev[k] ?? firstKeeperId);
                              next[i] = p.id;
                              return next;
                            })
                          }
                        >
                          🧤 {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className={styles.note}>
                  Pick a keeper for each {periodNoun} — the same player for both, or a different one.
                  The app puts the right keeper in goal each {periodNoun} and rotates them through
                  outfield the {periodNoun} they aren’t keeping.
                </p>
              </div>
            ))}
        </>
      ),
    });
  }

  steps.push({
    key: "rotation",
    title: "Rotation",
    aside: subLevelLabel(subFrequency),
    body: (
      <>
        <div style={{ marginTop: 10 }}>
          <SubFrequency
            value={subFrequency}
            onChange={setSubFrequency}
            summary={cadence}
            note="The whole plan below rebuilds as you change this — check the projected minutes to see what the extra changes buy."
          />
        </div>
        <details className={ms.fold}>
          <summary className={ms.foldHead}>
            <span className={ms.foldTitle}>MORE RULES</span>
            <span className={ms.foldSum}>
              {ROTATIONS.find((r) => r.value === rotationStyle)?.label ?? rotationStyle} · {tolerance}′ tolerance
            </span>
          </summary>
          <div className={ms.foldBody}>
            <div style={{ marginTop: 12 }}>
              <span className={styles.label}>Rotation style</span>
              <Chips options={ROTATIONS} value={rotationStyle} onChange={setRotationStyle} ariaLabel="Rotation style" />
              <p className={styles.note}>
                When sub windows happen. <strong>Continuous</strong> — whenever it keeps minutes
                fairest. <strong>Interval</strong> — on a fixed cadence. <strong>Period</strong> — only
                at {periodNoun} breaks.
              </p>
            </div>

            <div style={{ marginTop: 14 }}>
              <span className={styles.label}>Opening minutes</span>
              <Chips options={SUB_TIMINGS} value={subTiming} onChange={setSubTiming} ariaLabel="Opening-minute sub timing" />
              <p className={styles.note}>
                <strong>Settle in</strong> — no subs in the first 4 min of each {periodNoun}, so the
                shape settles after each restart. <strong>Even from kickoff</strong> — sub at equal
                intervals from the first minute.
                {periodLength <= 10 ? " (Only affects periods longer than 10 min.)" : ""}
              </p>
            </div>

            <div className={styles.spread} style={{ marginTop: 14 }}>
              <span className={styles.label} style={{ flex: 1 }}>
                Fairness tolerance
              </span>
              <Stepper
                value={tolerance}
                min={TOLERANCE_MIN}
                max={TOLERANCE_MAX}
                noun="minutes of fairness tolerance"
                display={`${tolerance}′`}
                onChange={setTolerance}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <span className={styles.label}>Season fair-play</span>
              <Chips
                options={CARRY_OPTIONS}
                value={carryForward ? "on" : "off"}
                onChange={(v) => setCarryForward(v === "on")}
                ariaLabel="Season fair-play carry-forward"
              />
              <p className={styles.note}>
                <strong>Off</strong> — balance this match on its own; season minutes are still tracked.{" "}
                <strong>On</strong> — players who’ve had less {cfg.onSurfaceLabel} time across the
                season are owed more today.{" "}
                <strong>This team’s saved default is {team.seasonCarryForward === true ? "On" : "Off"}</strong> —
                change it permanently in Edit team.
              </p>
            </div>
          </div>
        </details>
      </>
    ),
  });

  steps.push({
    key: "plan",
    title: "The plan",
    aside: cadenceCaption(projection.windows.length),
    body:
      projection.error !== null ? (
        <div className={ms.planError}>
          <p className={ms.planErrorTitle}>Can’t pick a line-up</p>
          <p className={ms.planErrorBody}>
            {`${projection.error}. Mark more players in above, take one off the ${surfaceNoun}${
              cfg.hasGoalkeeper ? ", or give someone the gloves in the squad" : ""
            }.`}
          </p>
        </div>
      ) : (
        <>
          {/* The starting squad, stuck on the page. Same control grammar as live: tap a sticker,
              tap another (board or bench) and they swap — pure lineup.ts logic. */}
          <div style={{ marginTop: 12 }}>
            <AlbumPitch
              surface={cfg.surface}
              players={projection.lineup.map(
                (a): AlbumPlayer => ({
                  id: a.playerId,
                  name: nameOf(a.playerId),
                  slot: a.slot,
                  locked: byId.get(a.playerId)?.alwaysOn === true,
                  secondsOnField: 0,
                  status: null,
                  flagged: false,
                  note: slotShortName(a.slot),
                }),
              )}
              caption={<HandNote>tap two stickers to swap ↑</HandNote>}
              legend={false}
              onSelect={tapBoard}
              selectedId={boardSel}
            />
          </div>
          {boardNote !== null && <p className={cx(styles.note, ms.warn)}>{boardNote}</p>}

          <Kicker>The bench</Kicker>
          {bench.length === 0 ? (
            <p className={styles.note}>Nobody spare — everyone starts.</p>
          ) : (
            <div className={ms.benchGrid}>
              {bench.map(({ player: p, atSeconds, late }) =>
                late ? (
                  // The signature device: a 🕑 player is the sticker that isn't here yet.
                  <MissingSlot
                    key={p.id}
                    name={p.name}
                    note="running late!"
                    detail={`arrives @ ${mins(periodLength * 60)}`}
                    onClick={() => tapBoard(p.id)}
                    selected={boardSel === p.id}
                    ariaLabel={`${p.name}, arrives late — can’t start`}
                  />
                ) : (
                  <PlayerSticker
                    key={p.id}
                    playerId={p.id}
                    name={p.name}
                    gk={p.canPlayGK}
                    emoji={p.canPlayGK ? undefined : cfg.scoreIcon}
                    footer={atSeconds !== null ? `on @ ${mins(atSeconds)}` : "not planned on"}
                    onClick={() => tapBoard(p.id)}
                    selected={boardSel === p.id}
                    ariaLabel={`${p.name}, on the bench — ${
                      atSeconds !== null ? `planned on at ${mins(atSeconds)}` : "not planned on"
                    }`}
                  />
                ),
              )}
            </div>
          )}

          {/* The ONE foil card on the page: the first suggested change — rare, shiny, advisory. */}
          {firstChange !== undefined && (
            <FoilCard badge="⇄ NEXT CHANGE" style={{ marginTop: 26 }}>
              <div className={ms.nextHead}>
                <span className={ms.nextLabel}>First planned change</span>
                <span className={ms.nextWhen}>
                  {planTime(firstChange.atSeconds)} · {cfg.periodLabel.charAt(0)}
                  {Math.min(config.periods, Math.floor(firstChange.atSeconds / (config.periodLengthMinutes * 60)) + 1)}
                </span>
              </div>
              {firstChange.on.map((o, i) => (
                <div key={o.playerId} className={ms.nextSwap}>
                  <span className={ms.offInk}>{nameOf(firstChange.off[i] ?? "")} ▼ off</span>
                  <span aria-hidden>→</span>
                  <span className={ms.onInk}>{nameOf(o.playerId)} ▲ on</span>
                  <span className={ms.nextPos}>{slotFullName(o.slot).toLowerCase()}</span>
                </div>
              ))}
            </FoilCard>
          )}

          <Kicker>The changes</Kicker>
          <PlanTimeline
            config={config}
            players={availablePlayers}
            startingLineup={projection.lineup}
            windows={projection.windows}
            onChange={setPlanEdits}
            totalSeconds={totalSec}
          />

          <div style={{ marginTop: 8 }}>
            <ProjectedMinutes
              rows={projection.rows}
              fairSeconds={fair}
              caption="if the plan runs"
              footnote={`everyone lands within ${mins(spread)} of it`}
            />
          </div>

          <SubbingSheet
            config={config}
            players={availablePlayers}
            startingLineup={projection.lineup}
            windows={projection.windows}
          />
        </>
      ),
  });

  /* ── the page ───────────────────────────────────────────────────────────── */

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Link href={`/teams/${team.id}`} className={styles.backLink} aria-label="Back to the team">
            ←
          </Link>
          <Logo />
        </span>
        <HandNote size={20} rotate={2}>
          {stamp === "" ? team.name : stamp}
        </HandNote>
      </header>

      <div className={styles.gutter}>
        <div className={styles.spread} style={{ marginTop: 14, alignItems: "baseline" }}>
          <h1 className={ms.title}>The line-up</h1>
          <Pill tone="neutral">{inCount} here today</Pill>
        </div>
        <p className={styles.body}>
          {team.name} · pick who’s here, set the format, and check the plan. It’s a forecast, not a
          contract — you confirm every change live.
        </p>

        {steps.map((s, i) => (
          <section key={s.key} className={ms.step}>
            <span
              className={cx(ms.stepBadge, BADGES[i % BADGES.length])}
              style={{ ["--tilt" as string]: `${tilt(`step-${s.key}`, 3)}deg` }}
              aria-hidden
            >
              {i + 1}
            </span>
            <div className={ms.stepBody}>
              <h2 className={ms.stepTitle}>
                <span>{s.title}</span>
                <span className={ms.stepAside}>{s.aside}</span>
              </h2>
              {s.body}
            </div>
          </section>
        ))}
      </div>

      {/* ── Kick off ── */}
      <div className={cx(styles.actionBar, ms.barCol)}>
        <HardButton
          variant="red"
          onClick={() => void create()}
          disabled={creating || projection.error !== null || projection.lineup.length === 0}
        >
          {creating ? "Starting…" : `${cfg.startLabel} ▶`}
        </HardButton>
        {createError !== null && <p className={cx(ms.barNote, ms.warn)}>{createError}</p>}
        <p className={ms.barNote}>Nothing is final — you confirm every change</p>
      </div>
    </main>
  );
}

/* ── local pieces ────────────────────────────────────────────────────────────
   Not in @/ui: none of these is shared with another screen yet, and a primitive earns its place by
   being used twice. */

interface StepperProps {
  value: number;
  min: number;
  max: number;
  /** What's being counted, for the −/+ aria-labels: "periods", "minutes per half". */
  noun: string;
  display: string;
  onChange: (n: number) => void;
}

/** − value + on one line; the buttons are 44px white mini-stickers. */
function Stepper({ value, min, max, noun, display, onChange }: StepperProps) {
  return (
    <span className={ms.stepperBtns}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`Fewer ${noun}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className={ms.stepperVal}>{display}</span>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`More ${noun}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={cx(ms.chip, value === o.value && ms.chipOn)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
