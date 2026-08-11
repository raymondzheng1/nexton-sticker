/**
 * Subbing grid (the coach's paper "sub sheet", generated + auto-totalled). Mirrors the real manual
 * sheet a coach shared: 5 on the field, 7 in the squad, 2 periods.
 */
import { describe, expect, it } from "vitest";
import { chooseStartingLineup, getFormation, planFromLineup } from "../../src/engine/index";
import { buildSubbingGrid } from "../../src/features/plan/subbingGrid";
import { makeMatch, makeSquad } from "../engine/_fixtures";

function grid() {
  const players = makeSquad(7); // 7-player squad
  const match = makeMatch(5, players, { periods: 2, periodLengthMinutes: 18 }); // 5-a-side, 2×18
  const startingLineup = chooseStartingLineup(match, players, getFormation(5)).assignments;
  const windows = planFromLineup(match, players, startingLineup);
  return { ...buildSubbingGrid(match, players, startingLineup, windows), players, match, startingLineup };
}

describe("subbing grid", () => {
  it("every column has exactly onFieldCount players marked on", () => {
    const { columns, rows } = grid();
    for (let c = 0; c < columns.length; c++) {
      const onCount = rows.filter((r) => r.cells[c] !== null).length;
      expect(onCount).toBe(5);
    }
  });

  it("total player-minutes equal onFieldCount × match length (nothing lost or double-counted)", () => {
    const { rows, match } = grid();
    const total = rows.reduce((sum, r) => sum + r.totalSeconds, 0);
    expect(total).toBe(5 * match.periods * match.periodLengthMinutes * 60);
  });

  it("lists the starters first, then the rest of the squad", () => {
    const { rows, startingLineup } = grid();
    const starterIds = new Set(startingLineup.map((a) => a.playerId));
    // The first N rows (N = onFieldCount) are exactly the starters.
    const firstFive = rows.slice(0, 5).map((r) => r.playerId);
    for (const id of firstFive) expect(starterIds.has(id)).toBe(true);
    expect(new Set(firstFive).size).toBe(5);
  });

  it("marks a fresh column at each period break (like the sheet's halves)", () => {
    const { columns, match } = grid();
    const periodStarts = columns.filter((c) => c.isPeriodStart);
    // First period always starts; the second period boundary shows up too.
    expect(periodStarts.length).toBeGreaterThanOrEqual(match.periods);
    expect(columns[0]?.startSeconds).toBe(0);
  });

  it("a starter's first-column cell shows their kickoff position", () => {
    const { rows, startingLineup } = grid();
    const firstRow = rows[0]!;
    const slot = startingLineup.find((a) => a.playerId === firstRow.playerId)?.slot;
    // DM/AM render as CDM/CAM; otherwise the raw slot code.
    const expected = slot === "DM" ? "CDM" : slot === "AM" ? "CAM" : slot;
    expect(firstRow.cells[0]).toBe(expected);
  });
});
