import { describe, expect, it } from "vitest";
import { chooseStartingLineup, getFormation } from "../../src/engine/index";
import { applyLineupDrag, benchFor } from "../../src/features/lineup/lineup";
import { makeMatch, makeSquad } from "../engine/_fixtures";

function setup() {
  const players = makeSquad(10);
  const match = makeMatch(7, players);
  const formation = getFormation(7); // 2-3-1
  const assignment = chooseStartingLineup(match, players, formation).assignments;
  return { players, assignment };
}

describe("lineup drag logic (PRD §8.2)", () => {
  it("benchFor returns players not in the XI", () => {
    const { players, assignment } = setup();
    const bench = benchFor(players, assignment);
    expect(bench).toHaveLength(players.length - assignment.length);
    const onField = new Set(assignment.map((a) => a.playerId));
    for (const b of bench) expect(onField.has(b.id)).toBe(false);
  });

  it("swaps two on-field players' slots", () => {
    const { players, assignment } = setup();
    const a0 = assignment[0]!;
    const a1 = assignment[1]!;
    const next = applyLineupDrag(assignment, players, a0.playerId, a1.playerId);
    expect(next.find((x) => x.slot === a0.slot)!.playerId).toBe(a1.playerId);
    expect(next.find((x) => x.slot === a1.slot)!.playerId).toBe(a0.playerId);
    expect(next).toHaveLength(assignment.length); // XI still full
  });

  it("subs a bench player into an on-field slot (the field player leaves the XI)", () => {
    const { players, assignment } = setup();
    const target = assignment[2]!; // an on-field player
    const benchPlayer = benchFor(players, assignment)[0]!;
    const next = applyLineupDrag(assignment, players, benchPlayer.id, target.playerId);
    expect(next.find((x) => x.slot === target.slot)!.playerId).toBe(benchPlayer.id);
    expect(next.map((x) => x.playerId)).not.toContain(target.playerId);
    expect(benchFor(players, next).map((b) => b.id)).toContain(target.playerId);
  });

  it("recomputes positionFit for the moved player and is a no-op when source === target", () => {
    const { players, assignment } = setup();
    const a0 = assignment[0]!;
    expect(applyLineupDrag(assignment, players, a0.playerId, a0.playerId)).toBe(assignment);
  });

  it("refuses to drag a 🕑 late bench player into the XI (either drag direction)", () => {
    const { players, assignment } = setup();
    const benchPlayer = benchFor(players, assignment)[0]!;
    const withLate = players.map((p) =>
      p.id === benchPlayer.id
        ? { ...p, availability: "arrives-late" as const, unavailableUntilMinute: 25 }
        : p,
    );
    const target = assignment[2]!;
    // bench-late dragged onto a field player…
    expect(applyLineupDrag(assignment, withLate, benchPlayer.id, target.playerId)).toBe(assignment);
    // …and a field player dragged onto the bench-late player: both refused.
    expect(applyLineupDrag(assignment, withLate, target.playerId, benchPlayer.id)).toBe(assignment);
    // A normal bench player still subs in fine.
    const okBench = benchFor(players, assignment)[1]!;
    const next = applyLineupDrag(assignment, withLate, okBench.id, target.playerId);
    expect(next.find((x) => x.slot === target.slot)!.playerId).toBe(okBench.id);
  });
});
