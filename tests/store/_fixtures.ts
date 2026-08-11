/** Shared fixtures for the store corpus. Installs deterministic id/clock seams. Not a test file. */
import {
  __setIdGeneratorForTests,
  __setNowForTests,
  resetOwnerId,
  setOwnerId,
  type TeamInput,
} from "../../src/store/index";
import type { Match, Player } from "../../src/engine/index";

let idCounter = 0;
let clockMs = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Install deterministic ids (`id-1`, `id-2`, …) and a pinned, manually-advanced clock. */
export function installSeams(): void {
  idCounter = 0;
  clockMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  __setIdGeneratorForTests(() => `id-${++idCounter}`);
  __setNowForTests(() => new Date(clockMs).toISOString());
  resetOwnerId();
}

export function teardownSeams(): void {
  __setIdGeneratorForTests(null);
  __setNowForTests(null);
  resetOwnerId();
}

/** Advance the pinned clock so the next timestamp is strictly newer (drives sync's LWW). */
export function advanceClock(ms = 1000): void {
  clockMs += ms;
}

export function setOwner(code: string): void {
  setOwnerId(code);
}

/** Engine players pl-1..pl-N, broad eligibility so the engine can always place/rotate them. */
export function makePlayers(n: number, keepers = 2): Player[] {
  const groups = ["DEF", "MID", "FWD"] as const;
  return Array.from({ length: n }, (_, i) => {
    const primary = groups[i % 3] ?? "MID";
    const secondary = groups[(i + 1) % 3] ?? "MID";
    return {
      id: `pl-${i + 1}`,
      name: `Player ${i + 1}`,
      squadNumber: i + 1,
      eligiblePositions: [primary, secondary],
      preferredPositions: [primary],
      canPlayGK: i < keepers,
      minutesWeight: 1,
    };
  });
}

export function makeTeamInput(players: Player[], overrides: Partial<TeamInput> = {}): TeamInput {
  return {
    name: "Riverside Lions",
    ageGroup: "U10",
    colour: "#16a34a",
    defaultOnFieldCount: 7,
    roster: players,
    ...overrides,
  };
}

export function makeMatchConfig(onFieldCount: number, players: Player[], overrides: Partial<Match> = {}): Match {
  return {
    onFieldCount,
    periods: 2,
    periodLengthMinutes: 25,
    rolloverSubsAllowed: true,
    gkPolicy: "countAsFieldTime",
    fairnessToleranceMinutes: 3,
    rotationStyle: "continuous",
    availableSquad: players.map((p) => p.id),
    minStintMinutes: 3,
    ...overrides,
  };
}
