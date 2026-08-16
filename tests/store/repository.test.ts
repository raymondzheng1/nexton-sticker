import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan, onFieldIds } from "../../src/engine/index";
import { InMemoryKeyValueStore, SnapshotRepository } from "../../src/store/index";
import {
  advanceClock,
  installSeams,
  makeMatchConfig,
  makePlayers,
  makeTeamInput,
  teardownSeams,
  setOwner,
} from "./_fixtures";

describe("SnapshotRepository — teams", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("creates, lists, updates, and soft-deletes teams (tombstone, not hard delete)", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    expect(team.id).toBe("id-1");
    expect(team.ownerId).toBe("local");
    expect(team.deletedAt).toBeNull();
    expect(await repo.listTeams()).toHaveLength(1);

    advanceClock();
    const updated = await repo.saveTeam({ ...makeTeamInput(players), id: team.id, name: "Lions B" });
    expect(updated.name).toBe("Lions B");
    expect(updated.createdAt).toBe(team.createdAt); // createdAt preserved
    expect(updated.updatedAt > team.updatedAt).toBe(true); // updatedAt bumped

    await repo.deleteTeam(team.id);
    expect(await repo.listTeams()).toHaveLength(0); // hidden from listings
    expect(await repo.getTeam(team.id)).toBeNull();
    // …but the tombstone is retained in the raw snapshot (for sync).
    const snap = await repo.loadSnapshot();
    expect(snap.teams[0]?.deletedAt).not.toBeNull();
  });

  it("scopes data by ownerId (capability code) — each owner sees only their own data", async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new SnapshotRepository(store);
    await repo.saveTeam(makeTeamInput(makePlayers(6)));
    expect(await repo.listTeams()).toHaveLength(1);

    setOwner("RVS-K27");
    expect(await repo.listTeams()).toHaveLength(0); // different owner, different snapshot

    await repo.saveTeam(makeTeamInput(makePlayers(6), { name: "Other Coach" }));
    expect(await repo.listTeams()).toHaveLength(1);

    setOwner("local");
    expect((await repo.listTeams())[0]?.name).toBe("Riverside Lions");
  });

  it("is deterministic with seams installed (same ops → same snapshot)", async () => {
    const run = async (): Promise<string> => {
      installSeams();
      const repo = new SnapshotRepository(new InMemoryKeyValueStore());
      await repo.saveTeam(makeTeamInput(makePlayers(7)));
      return JSON.stringify(await repo.loadSnapshot());
    };
    expect(await run()).toBe(await run());
  });
});

describe("SnapshotRepository — matches, event log, crash-safe restore", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("creates a match, appends events, transitions status, and restores live state after a crash", async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new SnapshotRepository(store);
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const match = await repo.createMatch({ teamId: team.id, name: "vs Rovers", config, players });
    expect(match.status).toBe("setup");

    const lineup = buildPlan(config, players).startingLineup.assignments;
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 300, deltaSeconds: 300 });

    expect((await repo.getMatch(match.id))?.status).toBe("live");
    const live = await repo.getLiveState(match.id);
    expect(live.elapsedSeconds).toBe(300);
    expect(onFieldIds(live)).toHaveLength(5);

    // Simulate a crash/kill: a brand-new repository over the SAME store rebuilds identical state.
    const recovered = new SnapshotRepository(store);
    const restored = await recovered.getLiveState(match.id);
    expect(restored).toEqual(live);

    await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 1500 });
    expect((await repo.getMatch(match.id))?.status).toBe("completed");
  });

  it("throws loudly when appending to a missing match", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    await expect(repo.appendEvent("nope", { type: "TICK", atSeconds: 1, deltaSeconds: 1 })).rejects.toThrow();
  });
});

/**
 * REGRESSION corpus for "my live match vanished mid-game" (2026-08-16). A coach mis-tapped the
 * team page's ✕ on a LIVE match — it sat 2px from the row you tap to reopen the game — reflex-
 * dismissed the native confirm, and the match was gone with no way back. Nothing had actually been
 * lost: deletion is a tombstone. These pin the recovery path the store now exposes.
 */
describe("SnapshotRepository — a deleted match is recoverable, minutes and all", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  async function liveMatch() {
    const store = new InMemoryKeyValueStore();
    const repo = new SnapshotRepository(store);
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const match = await repo.createMatch({ teamId: team.id, name: "vs Rovers", config, players });
    const lineup = buildPlan(config, players).startingLineup.assignments;
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
    return { store, repo, team, match };
  }

  it("REGRESSION: restoreMatch brings a mis-deleted LIVE match back exactly as it was — status, clock, minutes", async () => {
    const { repo, match } = await liveMatch();
    const before = await repo.getLiveState(match.id);

    await repo.deleteMatch(match.id);
    expect(await repo.getMatch(match.id)).toBeNull(); // gone from the shelf…

    const restored = await repo.restoreMatch(match.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.status).toBe("live"); // …and back, still LIVE
    expect(await repo.getLiveState(match.id)).toEqual(before); // every minute intact
  });

  it("listDeletedMatches is the recovery bin: only tombstones, newest deletion first, scoped to the team", async () => {
    const { repo, team, match } = await liveMatch();
    const other = await repo.createMatch({ teamId: team.id, name: "vs City", config: match.config, players: match.players });
    expect(await repo.listDeletedMatches(team.id)).toEqual([]);

    await repo.deleteMatch(match.id);
    advanceClock();
    await repo.deleteMatch(other.id);

    const bin = await repo.listDeletedMatches(team.id);
    expect(bin.map((m) => m.name)).toEqual(["vs City", "vs Rovers"]); // newest deletion first
    expect(await repo.listMatches(team.id)).toEqual([]); // and none of them on the shelf
    expect(await repo.listDeletedMatches("some-other-team")).toEqual([]);
  });

  it("restore is idempotent and honest: restoring a live match is a no-op, an unknown id is null", async () => {
    const { repo, match } = await liveMatch();
    const again = await repo.restoreMatch(match.id); // never deleted
    expect(again?.deletedAt).toBeNull();
    expect(await repo.restoreMatch("no-such-match")).toBeNull();
  });

  it("a restore bumps updatedAt past the delete, so it wins last-writer-wins on sync", async () => {
    const { repo, match } = await liveMatch();
    await repo.deleteMatch(match.id);
    const tomb = (await repo.loadSnapshot()).matches.find((m) => m.id === match.id);
    advanceClock();
    const restored = await repo.restoreMatch(match.id);
    expect(restored !== null && tomb !== undefined && restored.updatedAt > tomb.updatedAt).toBe(true);
  });
});
