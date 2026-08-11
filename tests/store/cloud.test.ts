import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryKeyValueStore,
  SnapshotRepository,
  saveSnapshotTo,
  withOwner,
  type AppSnapshot,
} from "../../src/store/index";
import { handleSyncRequest } from "../../src/store/cloud";
import {
  advanceClock,
  installSeams,
  makePlayers,
  makeTeamInput,
  teardownSeams,
  setOwner,
} from "./_fixtures";

const CODE = "RVS-K27";

/** Build a snapshot owned by CODE with one team. */
async function snapshotForCode(): Promise<AppSnapshot> {
  setOwner(CODE);
  const repo = new SnapshotRepository(new InMemoryKeyValueStore());
  await repo.saveTeam(makeTeamInput(makePlayers(6)));
  return repo.loadSnapshot();
}

describe("handleSyncRequest — server-authoritative cloud merge (Harness §18.2)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("first push stores the client snapshot; a fresh device then pulls it", async () => {
    const kv = new InMemoryKeyValueStore();
    const snap = await snapshotForCode();

    const pushed = await handleSyncRequest(kv, { code: CODE, snapshot: snap });
    expect(pushed.teams).toHaveLength(1);

    // Fresh device: pull-only (no local snapshot) gets the stored data back.
    const pulled = await handleSyncRequest(kv, { code: CODE, snapshot: null });
    expect(pulled.teams).toHaveLength(1);
  });

  it("merges a second device's data without losing the first's (anti-shrink)", async () => {
    const kv = new InMemoryKeyValueStore();
    const first = await snapshotForCode();
    await handleSyncRequest(kv, { code: CODE, snapshot: first });

    // A second device adds another team locally, then syncs.
    setOwner(CODE);
    const repo2 = new SnapshotRepository(new InMemoryKeyValueStore());
    advanceClock();
    await repo2.saveTeam(makeTeamInput(makePlayers(6), { name: "Second Team" }));
    const second = await repo2.loadSnapshot();

    const merged = await handleSyncRequest(kv, { code: CODE, snapshot: second });
    expect(merged.teams.length).toBeGreaterThanOrEqual(2); // both kept
  });

  it("rejects an invalid capability code and an owner/code mismatch (loud)", async () => {
    const kv = new InMemoryKeyValueStore();
    const snap = await snapshotForCode();
    await expect(handleSyncRequest(kv, { code: "bad", snapshot: snap })).rejects.toThrow();

    const wrongOwner = withOwner(snap, "ABC-DEF"); // code says RVS-K27 but snapshot owned by ABC-DEF
    await expect(handleSyncRequest(kv, { code: CODE, snapshot: wrongOwner })).rejects.toThrow();
  });

  it("persists the merged snapshot back to the KV under the code's key", async () => {
    const kv = new InMemoryKeyValueStore();
    const snap = await snapshotForCode();
    await handleSyncRequest(kv, { code: CODE, snapshot: snap });
    // A subsequent pull reflects what was written.
    const again = await handleSyncRequest(kv, { code: CODE, snapshot: null });
    expect(again.ownerId).toBe(CODE);
    expect(saveSnapshotTo).toBeTypeOf("function"); // exported helper is part of the public surface
  });
});
