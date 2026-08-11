import { describe, expect, it } from "vitest";
import { buildPlan, type MatchEvent } from "../../src/engine/index";
import {
  emptySnapshot,
  parseAppSnapshot,
  zMatch,
  zMatchEvent,
  zPlayer,
} from "../../src/store/index";
import { makeMatchConfig, makePlayers } from "./_fixtures";

describe("Zod IO schemas accept real engine data (drift defence)", () => {
  it("validates engine-produced Players and Match config", () => {
    const players = makePlayers(8);
    const config = makeMatchConfig(7, players);
    for (const p of players) expect(zPlayer.safeParse(p).success).toBe(true);
    expect(zMatch.safeParse(config).success).toBe(true);
  });

  it("validates every MatchEvent variant the engine/store emits", () => {
    const players = makePlayers(8);
    const config = makeMatchConfig(5, players);
    const lineup = buildPlan(config, players).startingLineup.assignments;
    const events: MatchEvent[] = [
      { type: "MATCH_STARTED", atSeconds: 0, lineup },
      { type: "TICK", atSeconds: 60, deltaSeconds: 60 },
      { type: "CLOCK_PAUSED", atSeconds: 60 },
      { type: "CLOCK_RESUMED", atSeconds: 60 },
      { type: "PERIOD_ENDED", atSeconds: 1500, period: 1 },
      { type: "PERIOD_STARTED", atSeconds: 1500, period: 2 },
      {
        type: "SUB_APPLIED",
        atSeconds: 600,
        off: [lineup[1]!.playerId],
        on: [{ playerId: "pl-8", slot: lineup[1]!.slot }],
        positionChanges: [],
      },
      { type: "PLAYER_LOCKED", atSeconds: 600, playerId: "pl-1", locked: true },
      { type: "PLAYER_PINNED", atSeconds: 600, playerId: "pl-1", slot: null },
      { type: "SNOOZE_SET", atSeconds: 600, untilSeconds: 900 },
      { type: "MATCH_ENDED", atSeconds: 3000 },
    ];
    for (const e of events) {
      expect(zMatchEvent.safeParse(e).success, e.type).toBe(true);
    }
  });

  it("parseAppSnapshot accepts a valid snapshot and rejects garbage / a future version", () => {
    const ok = emptySnapshot("local", "2026-01-01T00:00:00.000Z");
    expect(parseAppSnapshot(ok)).toEqual(ok);
    expect(() => parseAppSnapshot({})).toThrow();
    expect(() => parseAppSnapshot({ ...ok, schemaVersion: 9999 })).toThrow();
  });
});
