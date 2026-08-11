import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryKeyValueStore,
  SnapshotRepository,
  exportSnapshotJson,
  importSnapshotJson,
  withOwner,
} from "../../src/store/index";
import { installSeams, makePlayers, makeTeamInput, teardownSeams } from "./_fixtures";

describe("JSON export / import (Harness §2.3 backup + §12.2 upload seam)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("round-trips the full snapshot exactly", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    await repo.saveTeam(makeTeamInput(makePlayers(8)));
    const snap = await repo.loadSnapshot();
    expect(importSnapshotJson(exportSnapshotJson(snap))).toEqual(snap);
  });

  it("rejects malformed JSON loudly", () => {
    expect(() => importSnapshotJson("{not json")).toThrow();
  });

  it("rejects a snapshot from a newer schema version (can't read the future)", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    await repo.saveTeam(makeTeamInput(makePlayers(6)));
    const snap = await repo.loadSnapshot();
    const future = { ...snap, schemaVersion: snap.schemaVersion + 999 };
    expect(() => importSnapshotJson(JSON.stringify(future))).toThrow();
  });

  it("withOwner re-stamps the snapshot and every record (claim local data under a code)", async () => {
    const repo = new SnapshotRepository(new InMemoryKeyValueStore());
    await repo.saveTeam(makeTeamInput(makePlayers(6)));
    const snap = await repo.loadSnapshot();
    const claimed = withOwner(snap, "RVS-K27");
    expect(claimed.ownerId).toBe("RVS-K27");
    expect(claimed.teams.every((t) => t.ownerId === "RVS-K27")).toBe(true);
    expect(snap.ownerId).toBe("local"); // input not mutated
  });
});
