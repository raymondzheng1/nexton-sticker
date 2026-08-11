"use client";
/**
 * The reactive app store (Zustand) — the binding the UI uses, over the framework-agnostic
 * {@link SnapshotRepository}. Local IndexedDB is the instant working store; when a capability code
 * is active, mutations debounce a cloud sync (PRD §12.2). Offline-first: every action works against
 * the local layer; sync is best-effort and never blocks the UI (Harness §7.x).
 */
import { create } from "zustand";
import { DEFAULT_SUB_FREQUENCY, type GkPolicy, type RotationStyle } from "@/engine";
import { getLocalKvs, getRepo } from "./clientRepo";
import { requestCloudSync } from "./cloud";
import { exportSnapshotJson, importSnapshotJson, withOwner } from "./exportImport";
import { getOwnerId, resetOwnerId, setOwnerId } from "./identity";
import { isValidCapabilityCode, normalizeCapabilityCode } from "./ids";
import type { CreateMatchInput, TeamInput } from "./repository";
import type { SavedMatch, Team } from "./schema";
import { mergeSnapshots, saveSnapshotTo } from "./sync";
import { reportActivity } from "./telemetry";

const CODE_KEY = "nexton:code";
const PREFS_KEY = "nexton:prefs";
const SYNC_DEBOUNCE_MS = 1500;

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

/** Coach-level defaults + alert preferences (device-local, not synced team data — PRD §8.7). */
export interface MatchPrefs {
  rotationStyle: RotationStyle;
  gkPolicy: GkPolicy;
  fairnessToleranceMinutes: number;
  /** How often this coach likes to substitute (1–5, 3 = balanced) — seeds every new match. */
  subFrequency: number;
  sound: boolean;
  vibrate: boolean;
}

const DEFAULT_PREFS: MatchPrefs = {
  rotationStyle: "continuous",
  gkPolicy: "countAsFieldTime",
  fairnessToleranceMinutes: 2,
  subFrequency: DEFAULT_SUB_FREQUENCY,
  sound: true,
  vibrate: true,
};

function loadPrefs(): MatchPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<MatchPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface AppState {
  ready: boolean;
  teams: Team[];
  code: string | null;
  syncStatus: SyncStatus;
  prefs: MatchPrefs;
  /**
   * Bumped whenever a match is created/deleted/changed (incl. kickoff/subs/end from the live store).
   * Lists that show match status depend on this so they never render a stale snapshot after the
   * router restores a cached screen (PRD §8.x — the live match must reflect on the team page).
   */
  matchRev: number;

  init: () => Promise<void>;
  /** Signal that match data changed (called by the live store after a status-changing event). */
  bumpMatchRev: () => void;
  refreshTeams: () => Promise<void>;
  saveTeam: (input: TeamInput) => Promise<Team>;
  deleteTeam: (id: string) => Promise<void>;
  createMatch: (input: CreateMatchInput) => Promise<SavedMatch>;
  deleteMatch: (id: string) => Promise<void>;
  listMatches: (teamId?: string) => Promise<SavedMatch[]>;
  setPrefs: (patch: Partial<MatchPrefs>) => void;
  /** Activate a capability code. `opts.created` distinguishes minting a new one from linking an
   *  existing one on another device (drives which operator ping fires). */
  setCode: (rawCode: string, opts?: { created?: boolean }) => Promise<void>;
  clearCode: () => Promise<void>;
  syncCloud: () => Promise<void>;
  exportData: () => Promise<string>;
  importData: (json: string) => Promise<void>;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => {
  function scheduleSync(): void {
    if (!get().code) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void get().syncCloud(), SYNC_DEBOUNCE_MS);
  }

  return {
    ready: false,
    teams: [],
    code: null,
    syncStatus: "idle",
    prefs: DEFAULT_PREFS,
    matchRev: 0,

    bumpMatchRev: () => set((s) => ({ matchRev: s.matchRev + 1 })),

    init: async () => {
      if (get().ready) return;
      set({ prefs: loadPrefs() });
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem(CODE_KEY) : null;
      if (saved && isValidCapabilityCode(saved)) {
        setOwnerId(saved);
        set({ code: saved });
      }
      await get().refreshTeams();
      set({ ready: true });
      if (get().code) void get().syncCloud();
    },

    setPrefs: (patch) => {
      const next = { ...get().prefs, ...patch };
      set({ prefs: next });
      if (typeof localStorage !== "undefined") localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    },

    refreshTeams: async () => {
      set({ teams: await getRepo().listTeams() });
    },

    saveTeam: async (input) => {
      const isNew = input.id === undefined;
      const team = await getRepo().saveTeam(input);
      await get().refreshTeams();
      scheduleSync();
      if (isNew) {
        reportActivity(
          "team_created",
          `${team.name} · ${team.sport ?? "football"} · ${team.roster.length} players`,
        );
      }
      return team;
    },

    deleteTeam: async (id) => {
      const team = get().teams.find((t) => t.id === id); // capture the name before it's gone
      await getRepo().deleteTeam(id);
      await get().refreshTeams();
      scheduleSync();
      if (team) reportActivity("team_deleted", `${team.name} · ${team.roster.length} players`);
    },

    createMatch: async (input) => {
      const match = await getRepo().createMatch(input);
      get().bumpMatchRev();
      scheduleSync();
      const cfg = match.config;
      reportActivity(
        "match_created",
        `${match.name} · ${cfg.sport ?? "football"} · ${cfg.onFieldCount}-a-side · ${match.players.length} available · ${cfg.periods}×${cfg.periodLengthMinutes}′`,
      );
      return match;
    },

    deleteMatch: async (id) => {
      await getRepo().deleteMatch(id);
      get().bumpMatchRev();
      scheduleSync();
    },

    listMatches: (teamId) => getRepo().listMatches(teamId),

    setCode: async (rawCode, opts) => {
      const code = normalizeCapabilityCode(rawCode);
      if (!code) throw new Error("That code isn't valid. Use the format ABC-DEF.");
      // Migrate the current (local) data to the code so nothing is lost on activation.
      const current = await getRepo().loadSnapshot();
      setOwnerId(code);
      if (typeof localStorage !== "undefined") localStorage.setItem(CODE_KEY, code);
      await saveSnapshotTo(getLocalKvs(), withOwner(current, code));
      await getRepo().loadSnapshot();
      set({ code });
      await get().refreshTeams();
      await get().syncCloud();
      // The code itself is a bearer credential — report the EVENT, never the value.
      reportActivity(
        opts?.created === true ? "sync_code_created" : "sync_code_linked",
        `${get().teams.length} team(s) on this device`,
      );
    },

    clearCode: async () => {
      resetOwnerId();
      if (typeof localStorage !== "undefined") localStorage.removeItem(CODE_KEY);
      set({ code: null, syncStatus: "idle" });
      await getRepo().loadSnapshot();
      await get().refreshTeams();
    },

    syncCloud: async () => {
      const code = get().code;
      if (!code) return;
      set({ syncStatus: "syncing" });
      try {
        const local = await getRepo().loadSnapshot();
        const merged = await requestCloudSync(code, local);
        await saveSnapshotTo(getLocalKvs(), merged);
        await getRepo().loadSnapshot();
        await get().refreshTeams();
        set({ syncStatus: "idle" });
      } catch {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        set({ syncStatus: offline ? "offline" : "error" });
      }
    },

    exportData: async () => exportSnapshotJson(await getRepo().loadSnapshot()),

    importData: async (json) => {
      const incoming = importSnapshotJson(json);
      const current = await getRepo().loadSnapshot();
      const merged = mergeSnapshots(current, withOwner(incoming, getOwnerId()));
      await saveSnapshotTo(getLocalKvs(), merged);
      await getRepo().loadSnapshot();
      await get().refreshTeams();
      scheduleSync();
    },
  };
});
