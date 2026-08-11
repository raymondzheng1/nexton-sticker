import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan, onFieldIds } from "../../src/engine/index";
import { InMemoryKeyValueStore, SnapshotRepository, carryForwardSeeds, seasonReport } from "../../src/store/index";
import {
  installSeams,
  makeMatchConfig,
  makePlayers,
  makeTeamInput,
  teardownSeams,
} from "./_fixtures";

describe("seasonReport — insights computed on read (Harness §3.5)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("aggregates minutes and starts per player across matches", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);

    // Two matches, each: kick off then run 10 minutes straight (starters bank 600s each).
    for (const name of ["M1", "M2"]) {
      const match = await repo.createMatch({ teamId: team.id, name, config, players });
      const lineup = buildPlan(config, players).startingLineup.assignments;
      await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
      await repo.appendEvent(match.id, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
      await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 600 });
    }

    const report = seasonReport(await repo.listMatches(team.id));
    // The same XI started both matches → those starters have 2 starts and 1200s.
    const topStarter = report[0]!;
    expect(topStarter.starts).toBe(2);
    expect(topStarter.matchesPlayed).toBe(2);
    expect(topStarter.totalSecondsOnField).toBe(1200);

    // Total field-seconds across the report = onFieldCount × elapsed × matches.
    const total = report.reduce((s, r) => s + r.totalSecondsOnField, 0);
    expect(total).toBe(5 * 600 * 2);
  });

  it("aggregates goals per player across the season", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const lineup = buildPlan(config, players).startingLineup.assignments;
    const scorer = lineup[1]!.playerId;
    for (const name of ["M1", "M2"]) {
      const match = await repo.createMatch({ teamId: team.id, name, config, players });
      await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
      await repo.appendEvent(match.id, { type: "GOAL_SCORED", atSeconds: 120, playerId: scorer });
      await repo.appendEvent(match.id, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
      await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 600 });
    }
    const report = seasonReport(await repo.listMatches(team.id));
    expect(report.find((r) => r.playerId === scorer)!.totalGoals).toBe(2); // 1 per match × 2
    expect(report.reduce((s, r) => s + r.totalGoals, 0)).toBe(2); // nobody else scored
  });

  it("aggregates PER-POSITION minutes across the season (player positional history)", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const lineup = buildPlan(config, players).startingLineup.assignments;
    const mover = lineup.find((a) => a.slot !== "GK")!;
    const other = lineup.find((a) => a.slot !== "GK" && a.slot !== mover.slot)!;
    const match = await repo.createMatch({ teamId: team.id, name: "P", config, players });
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 240, deltaSeconds: 240 });
    // repositioned at 4:00 — the report must attribute minutes to BOTH slots
    await repo.appendEvent(match.id, {
      type: "SUB_APPLIED",
      atSeconds: 240,
      off: [],
      on: [],
      positionChanges: [
        { playerId: mover.playerId, fromSlot: mover.slot, toSlot: other.slot },
        { playerId: other.playerId, fromSlot: other.slot, toSlot: mover.slot },
      ],
    });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 600, deltaSeconds: 360 });
    await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 600 });

    const report = seasonReport(await repo.listMatches(team.id));
    const row = report.find((r) => r.playerId === mover.playerId)!;
    expect(row.totalSecondsBySlot[mover.slot]).toBe(240);
    expect(row.totalSecondsBySlot[other.slot]).toBe(360);
    expect(row.totalSecondsOnField).toBe(600);
  });

  it("ignores matches that never kicked off", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(6);
    const team = await repo.saveTeam(makeTeamInput(players));
    await repo.createMatch({ teamId: team.id, name: "unplayed", config: makeMatchConfig(5, players), players });
    expect(seasonReport(await repo.listMatches(team.id))).toHaveLength(0);
  });

  it("counts GK time toward totalSecondsAsGk", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const match = await repo.createMatch({ teamId: team.id, name: "gk", config, players });
    const lineup = buildPlan(config, players).startingLineup.assignments;
    const gkId = lineup.find((a) => a.slot === "GK")!.playerId;
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 300, deltaSeconds: 300 });
    await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 300 });

    const report = seasonReport(await repo.listMatches(team.id));
    expect(report.find((r) => r.playerId === gkId)!.totalSecondsAsGk).toBe(300);
    // sanity: the lineup actually had 5 on the field
    const live = await repo.getLiveState(match.id);
    expect(onFieldIds(live)).toHaveLength(5);
  });
});

describe("carryForwardSeeds — season balance seed (PRD §8.6, item 4)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("owes under-played players minutes and debits over-played ones (sums ~0)", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    // One match: 5 starters bank 600s, the 3 bench players bank nothing.
    const match = await repo.createMatch({ teamId: team.id, name: "M1", config, players });
    const lineup = buildPlan(config, players).startingLineup.assignments;
    const starterIds = new Set(lineup.map((a) => a.playerId));
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 600, deltaSeconds: 600 });
    await repo.appendEvent(match.id, { type: "MATCH_ENDED", atSeconds: 600 });

    const ids = players.map((p) => p.id);
    const seeds = carryForwardSeeds(await repo.listMatches(team.id), ids);

    // avg = 5*600/8 = 375 → bench owed +375, starters −225.
    for (const id of ids) {
      if (starterIds.has(id)) expect(seeds[id]).toBeLessThan(0);
      else expect(seeds[id]).toBeGreaterThan(0);
    }
    const sum = ids.reduce((s, id) => s + (seeds[id] ?? 0), 0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(8); // self-balancing (rounding only)
  });

  it("seeds zero when there's no season history yet", () => {
    const players = makePlayers(6);
    const seeds = carryForwardSeeds([], players.map((p) => p.id));
    for (const p of players) expect(seeds[p.id]).toBe(0);
  });
});

describe("resetMatch — restart wipes the log back to pre-match (item 5)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("clears events, clock anchor, and status; keeps config + squad", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    const players = makePlayers(8);
    const team = await repo.saveTeam(makeTeamInput(players));
    const config = makeMatchConfig(5, players);
    const match = await repo.createMatch({ teamId: team.id, name: "M", config, players });
    const lineup = buildPlan(config, players).startingLineup.assignments;
    await repo.appendEvent(match.id, { type: "MATCH_STARTED", atSeconds: 0, lineup });
    await repo.appendEvent(match.id, { type: "TICK", atSeconds: 120, deltaSeconds: 120 });
    await repo.updateMatch(match.id, { clockAnchor: { elapsedSeconds: 0, wallClockISO: "2026-06-14T00:00:00.000Z" } });

    const reset = await repo.resetMatch(match.id);
    expect(reset.events).toHaveLength(0);
    expect(reset.status).toBe("setup");
    expect(reset.clockAnchor).toBeNull();
    expect(reset.players).toHaveLength(players.length);
    expect(reset.config.onFieldCount).toBe(5);
    // rebuilt live state is back to pre-match
    const live = await repo.getLiveState(match.id);
    expect(live.status).toBe("pre-match");
  });
});
