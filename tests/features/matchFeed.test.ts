/**
 * The match log — what actually happened, versus what was planned.
 *
 * The bug this exists to prevent was reported from a real match: the live screen showed PLANNED
 * substitutions as though they were a record of the game. The moment a coach subs off-script (which
 * is most matches) the plan stops describing reality, so the log must be derived from the event
 * log and nothing else.
 */
import { describe, expect, it } from "vitest";
import type { MatchEvent } from "../../src/engine/index";
import {
  buildMatchFeed,
  countActualSubs,
  feedLineText,
  wallClockLabel,
  type FeedLabels,
} from "../../src/features/live/matchFeed";

const LABELS: FeedLabels = {
  nameOf: (id) => ({ p1: "Sam", p2: "Alex", p3: "Kim" })[id] ?? id,
  slotLabel: (slot) => (slot === "DM" ? "CDM" : slot),
  startLabel: "Kick off",
  periodLabel: "Half",
  breakLabel: "Half time",
  endLabel: "Full time",
  scoreIcon: "⚽",
  showScoreValue: false,
};

const KICKOFF: MatchEvent = {
  type: "MATCH_STARTED",
  atSeconds: 0,
  lineup: [{ slot: "MC", playerId: "p1", positionFit: 1 }],
};

describe("match log", () => {
  it("records the real minute a sub happened, not the minute it was planned for", () => {
    const feed = buildMatchFeed([
      KICKOFF,
      { type: "TICK", atSeconds: 1000, deltaSeconds: 1000 },
      // The plan said 20:00; the coach actually made it at 23:20.
      { type: "SUB_APPLIED", atSeconds: 1400, off: ["p1"], on: [{ playerId: "p2", slot: "MC" }], positionChanges: [] },
    ]);
    const sub = feed.find((e) => e.kind === "sub");
    expect(sub?.atSeconds).toBe(1400);
    expect(feedLineText(sub!, LABELS)).toBe("Sam off, Alex on (MC)");
  });

  it("is newest first, so the change just made is the one you see", () => {
    const feed = buildMatchFeed([
      KICKOFF,
      { type: "SUB_APPLIED", atSeconds: 600, off: ["p1"], on: [{ playerId: "p2", slot: "MC" }], positionChanges: [] },
      { type: "SUB_APPLIED", atSeconds: 1200, off: ["p2"], on: [{ playerId: "p3", slot: "MC" }], positionChanges: [] },
    ]);
    expect(feed.map((e) => e.atSeconds)).toEqual([1200, 600, 0]);
  });

  it("leaves out clock housekeeping — ticks, pauses, locks and snoozes aren't events in the game", () => {
    const feed = buildMatchFeed([
      KICKOFF,
      { type: "TICK", atSeconds: 60, deltaSeconds: 60 },
      { type: "CLOCK_PAUSED", atSeconds: 60 },
      { type: "CLOCK_RESUMED", atSeconds: 60 },
      { type: "PLAYER_LOCKED", atSeconds: 60, playerId: "p1", locked: true },
      { type: "PLAYER_PINNED", atSeconds: 60, playerId: "p1", slot: "MC" },
      { type: "SNOOZE_SET", atSeconds: 60, untilSeconds: 120 },
    ]);
    expect(feed.map((e) => e.kind)).toEqual(["kickoff"]);
  });

  it("tells a position change apart from a substitution", () => {
    const feed = buildMatchFeed([
      {
        type: "SUB_APPLIED",
        atSeconds: 300,
        off: [],
        on: [],
        positionChanges: [{ playerId: "p1", fromSlot: "MC", toSlot: "DM" }],
      },
    ]);
    expect(feed[0]?.kind).toBe("move");
    expect(feedLineText(feed[0]!, LABELS)).toBe("Sam moved to CDM");
    // A reshuffle is not a substitution, so it must not inflate the "subs made" count.
    expect(countActualSubs(feed)).toBe(0);
  });

  it("counts every pair in a multi-sub, not the event", () => {
    const feed = buildMatchFeed([
      {
        type: "SUB_APPLIED",
        atSeconds: 300,
        off: ["p1", "p2"],
        on: [
          { playerId: "p3", slot: "MC" },
          { playerId: "p4", slot: "DM" },
        ],
        positionChanges: [],
      },
    ]);
    expect(countActualSubs(feed)).toBe(2);
    expect(feedLineText(feed[0]!, LABELS)).toBe("Sam off, Kim on (MC) · Alex off, p4 on (CDM)");
  });

  it("reads a score logged before points existed as one point", () => {
    // Stored football goals (and early basketball baskets) carry no `points` field.
    const feed = buildMatchFeed([{ type: "GOAL_SCORED", atSeconds: 300, playerId: "p1" }]);
    expect(feed[0]).toMatchObject({ kind: "score", points: 1 });
  });

  it("says what a basket was worth when the sport has more than one value", () => {
    const feed = buildMatchFeed([{ type: "GOAL_SCORED", atSeconds: 300, playerId: "p1", points: 3 }]);
    expect(feedLineText(feed[0]!, { ...LABELS, scoreIcon: "🏀", showScoreValue: true })).toBe("🏀 Sam scored 3");
    // Football never shows a number — "Sam scored 1" would read as a scoreline.
    expect(feedLineText(feed[0]!, LABELS)).toBe("⚽ Sam scored");
  });

  it("survives an event log with no wall-clock stamps (matches recorded before stamping)", () => {
    const feed = buildMatchFeed([KICKOFF]);
    expect(feed[0]?.wallClockISO).toBeUndefined();
    expect(wallClockLabel(undefined)).toBeNull();
    expect(wallClockLabel("not-a-date")).toBeNull();
    expect(wallClockLabel("2026-08-06T14:32:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
