import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MatchEvent } from "../../src/engine/index";
import {
  InMemoryKeyValueStore,
  SnapshotRepository,
  emptySnapshot,
  mergeEvents,
  mergeSnapshots,
  syncNow,
  type AppSnapshot,
  type SavedMatch,
} from "../../src/store/index";
import { rebuildLiveState } from "../../src/engine/index";
import {
  advanceClock,
  installSeams,
  makePlayers,
  makeTeamInput,
  teardownSeams,
} from "./_fixtures";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("mergeEvents — monotone event-log union (Harness §18.2)", () => {
  const e = (atSeconds: number, deltaSeconds: number): MatchEvent => ({ type: "TICK", atSeconds, deltaSeconds });

  it("keeps the longer log when one extends the other (the common case)", () => {
    const a = [e(0, 0), e(60, 60)];
    const b = [e(0, 0), e(60, 60), e(120, 60)];
    expect(mergeEvents(a, b)).toEqual(b);
    expect(mergeEvents(b, a)).toEqual(b);
  });

  it("keeps the longer COHERENT log when logs diverge (never interleaves into an un-replayable order)", () => {
    // Causal logs must replay in order, so divergence keeps one side's coherent log — NOT a
    // time-sorted union (which could place e.g. a 2nd MATCH_STARTED mid-stream and brick rebuild).
    const a = [e(0, 0), e(60, 60), e(120, 60)];
    const b = [e(0, 0), e(90, 90)];
    expect(mergeEvents(a, b)).toEqual(a); // longer side wins
    expect(mergeEvents(b, a)).toEqual(a);
  });
});

describe("sync is restart-safe — a wiped/re-played log never corrupts (#4 root cause)", () => {
  const owner = "LIONS-7F3K";
  const ms: MatchEvent = { type: "MATCH_STARTED", atSeconds: 0, lineup: [{ slot: "FC", playerId: "p1", positionFit: 1 }] };
  const players = [
    { id: "p1", name: "P1", eligiblePositions: ["FWD" as const], preferredPositions: [], canPlayGK: false, minutesWeight: 1 },
    { id: "p2", name: "P2", eligiblePositions: ["FWD" as const], preferredPositions: [], canPlayGK: false, minutesWeight: 1 },
  ];
  const config = {
    onFieldCount: 1, periods: 1, periodLengthMinutes: 10, rolloverSubsAllowed: true,
    gkPolicy: "countAsFieldTime" as const, fairnessToleranceMinutes: 2, rotationStyle: "continuous" as const,
    availableSquad: ["p1", "p2"], minStintMinutes: 3,
  };
  const match = (epoch: number, events: MatchEvent[], updatedAt: string): SavedMatch => ({
    id: "m1", ownerId: owner, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, deletedAt: null,
    teamId: "t1", name: "M", config, players, status: "live",
    startingLineup: [{ slot: "FC", playerId: "p1", positionFit: 1 }], events, eventEpoch: epoch,
  });
  const snap = (m: SavedMatch): AppSnapshot => ({ schemaVersion: 1, ownerId: owner, updatedAt: m.updatedAt, teams: [], matches: [m] });

  it("a restarted (new-epoch) log replaces the old one — no duplicate MATCH_STARTED, stays replayable", () => {
    // The exact bug: device synced a full log (epoch 0); coach restarted + re-played (epoch 1). The
    // old union-by-time merge produced TWO MATCH_STARTED → rebuild threw → match wouldn't display.
    const oldLog: MatchEvent[] = [ms, { type: "TICK", atSeconds: 300, deltaSeconds: 300 }, { type: "SUB_APPLIED", atSeconds: 300, off: ["p1"], on: [{ playerId: "p2", slot: "FC" }], positionChanges: [] }];
    const freshLog: MatchEvent[] = [ms, { type: "TICK", atSeconds: 120, deltaSeconds: 120 }];
    const server = snap(match(0, oldLog, "2026-01-01T00:00:00.000Z"));
    const local = snap(match(1, freshLog, "2026-01-02T00:00:00.000Z"));

    for (const merged of [mergeSnapshots(server, local), mergeSnapshots(local, server)]) {
      const m = merged.matches[0]!;
      expect(m.eventEpoch).toBe(1);
      expect(m.events).toEqual(freshLog); // fresh wins wholesale — old log not resurrected/interleaved
      expect(m.events.filter((e) => e.type === "MATCH_STARTED")).toHaveLength(1); // no corruption
      // and it actually replays cleanly to the fresh state
      const state = rebuildLiveState(config, players, m.events);
      expect(state.elapsedSeconds).toBe(120);
      expect(state.players.p1?.onField).toBe(true);
    }
  });

  it("within one generation, a clean extend keeps the longer log (anti-shrink preserved)", () => {
    const short: MatchEvent[] = [ms, { type: "TICK", atSeconds: 300, deltaSeconds: 300 }];
    const long: MatchEvent[] = [...short, { type: "TICK", atSeconds: 600, deltaSeconds: 300 }];
    const a = snap(match(0, short, "2026-01-01T00:00:00.000Z"));
    const b = snap(match(0, long, "2026-01-02T00:00:00.000Z"));
    expect(mergeSnapshots(a, b).matches[0]!.events).toEqual(long);
    expect(mergeSnapshots(b, a).matches[0]!.events).toEqual(long);
  });
});

describe("mergeSnapshots — last-writer-wins + tombstones", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  async function oneTeamSnapshot(): Promise<AppSnapshot> {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    await repo.saveTeam(makeTeamInput(makePlayers(6)));
    return repo.loadSnapshot();
  }

  it("a newer edit wins", async () => {
    const a = await oneTeamSnapshot();
    const b = clone(a);
    b.teams[0]!.name = "Newer Name";
    b.teams[0]!.updatedAt = "2999-01-01T00:00:00.000Z";
    expect(mergeSnapshots(a, b).teams[0]?.name).toBe("Newer Name");
    expect(mergeSnapshots(b, a).teams[0]?.name).toBe("Newer Name");
  });

  it("a newer delete tombstones; a newer edit revives", async () => {
    const a = await oneTeamSnapshot();
    const deleted = clone(a);
    deleted.teams[0]!.deletedAt = "2999-01-01T00:00:00.000Z";
    deleted.teams[0]!.updatedAt = "2999-01-01T00:00:00.000Z";
    expect(mergeSnapshots(a, deleted).teams[0]?.deletedAt).not.toBeNull();

    const revived = clone(deleted);
    revived.teams[0]!.deletedAt = null;
    revived.teams[0]!.updatedAt = "3000-01-01T00:00:00.000Z";
    expect(mergeSnapshots(deleted, revived).teams[0]?.deletedAt).toBeNull();
  });

  it("refuses to merge across different owners (loud)", () => {
    const a = emptySnapshot("local", "2026-01-01T00:00:00.000Z");
    const b = emptySnapshot("RVS-K27", "2026-01-01T00:00:00.000Z");
    expect(() => mergeSnapshots(a, b)).toThrow();
  });
});

describe("syncNow — two-device flow (phone A → cloud → phone B)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("propagates each device's data through the cloud to the other, and is idempotent", async () => {
    const remote = new InMemoryKeyValueStore();
    const storeA = new InMemoryKeyValueStore();
    const storeB = new InMemoryKeyValueStore();

    // Device A creates T1 and pushes.
    const repoA = new SnapshotRepository(storeA);
    await repoA.saveTeam(makeTeamInput(makePlayers(6), { name: "T1" }));
    await syncNow(storeA, remote, "local");

    // Device B pulls → sees T1; creates T2; pushes.
    await syncNow(storeB, remote, "local");
    const repoB = new SnapshotRepository(storeB);
    expect((await repoB.listTeams()).map((t) => t.name)).toEqual(["T1"]);
    advanceClock();
    await repoB.saveTeam(makeTeamInput(makePlayers(6), { name: "T2" }));
    await syncNow(storeB, remote, "local");

    // Device A pulls → now has both.
    const merged = await syncNow(storeA, remote, "local");
    const names = (await new SnapshotRepository(storeA).listTeams()).map((t) => t.name).sort();
    expect(names).toEqual(["T1", "T2"]);

    // Idempotent: syncing again changes nothing.
    const again = await syncNow(storeA, remote, "local");
    expect(again).toEqual(merged);
  });
});
