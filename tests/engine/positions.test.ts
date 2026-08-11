import { describe, expect, it } from "vitest";
import {
  ALL_SLOTS,
  canFillSlot,
  columnOf,
  groupOf,
  groupsAdjacent,
  positionFit,
  slotsForGroup,
  type Player,
  type PositionSlot,
} from "../../src/engine/index";

function player(p: Partial<Player>): Player {
  return {
    id: "x",
    name: "X",
    eligiblePositions: [],
    preferredPositions: [],
    canPlayGK: false,
    minutesWeight: 1,
    ...p,
  };
}

describe("position taxonomy", () => {
  it("maps every slot to a group", () => {
    expect(groupOf("GK")).toBe("GK");
    expect(groupOf("DC")).toBe("DEF");
    expect(groupOf("MC")).toBe("MID");
    expect(groupOf("AM")).toBe("MID");
    expect(groupOf("FC")).toBe("FWD");
  });

  it("lists slots for a group", () => {
    expect(slotsForGroup("DEF").sort()).toEqual(["DC", "DL", "DR"]);
    expect(slotsForGroup("GK")).toEqual(["GK"]);
  });

  it("places slots left/centre/right for pitch layout (MC is central, not on a wing)", () => {
    expect((["DL", "ML", "FL"] as PositionSlot[]).map(columnOf)).toEqual([0, 0, 0]);
    expect((["DR", "MR", "FR"] as PositionSlot[]).map(columnOf)).toEqual([2, 2, 2]);
    expect((["GK", "DC", "DM", "MC", "AM", "FC"] as PositionSlot[]).map(columnOf)).toEqual([1, 1, 1, 1, 1, 1]);
    // a 3-mid line sorts to L, C, R regardless of input order
    expect((["MR", "MC", "ML"] as PositionSlot[]).slice().sort((a, b) => columnOf(a) - columnOf(b))).toEqual([
      "ML",
      "MC",
      "MR",
    ]);
  });

  it("knows group adjacency (GK-DEF-MID-FWD chain; DEF-FWD not adjacent)", () => {
    expect(groupsAdjacent("DEF", "MID")).toBe(true);
    expect(groupsAdjacent("GK", "DEF")).toBe(true);
    expect(groupsAdjacent("MID", "FWD")).toBe(true);
    expect(groupsAdjacent("DEF", "FWD")).toBe(false);
    expect(groupsAdjacent("GK", "FWD")).toBe(false);
  });
});

describe("positionFit (PRD §7.4)", () => {
  it("gates GK on canPlayGK", () => {
    expect(positionFit(player({ canPlayGK: true }), "GK")).toBe(1);
    expect(positionFit(player({ canPlayGK: false, eligiblePositions: ["GK"] }), "GK")).toBe(0);
  });

  it("ranks preferred > eligible exact > same group > adjacent > non-adjacent", () => {
    const preferred = positionFit(player({ preferredPositions: ["DC"], eligiblePositions: ["DC"] }), "DC");
    const eligibleExact = positionFit(player({ eligiblePositions: ["DC"] }), "DC");
    const sameGroup = positionFit(player({ eligiblePositions: ["DL"] }), "DC");
    const adjacent = positionFit(player({ eligiblePositions: ["MC"] }), "DC"); // MID adjacent to DEF
    const nonAdjacent = positionFit(player({ eligiblePositions: ["FC"] }), "DC"); // FWD not adjacent to DEF

    expect(preferred).toBeGreaterThan(eligibleExact);
    expect(eligibleExact).toBeGreaterThan(sameGroup);
    expect(sameGroup).toBeGreaterThan(adjacent);
    expect(adjacent).toBeGreaterThan(nonAdjacent);
  });

  it("treats a group in eligiblePositions as covering every slot in that group", () => {
    const p = player({ eligiblePositions: ["DEF"] });
    expect(positionFit(p, "DL")).toBeGreaterThanOrEqual(0.65);
    expect(positionFit(p, "DC")).toBeGreaterThanOrEqual(0.65);
  });

  it("canFillSlot is true for any outfield slot (everyone can flex) but false for GK without canPlayGK", () => {
    const p = player({ eligiblePositions: ["FC"], canPlayGK: false });
    for (const slot of ALL_SLOTS) {
      if (slot === "GK") expect(canFillSlot(p, slot)).toBe(false);
      else expect(canFillSlot(p, slot)).toBe(true);
    }
  });
});

describe("preferredSide refines the flank within a line", () => {
  it("favours the matching side over the opposite wing and the centre", () => {
    const lefty = player({ eligiblePositions: ["DEF"], preferredSide: "left" });
    expect(positionFit(lefty, "DL")).toBeGreaterThan(positionFit(lefty, "DR"));
    expect(positionFit(lefty, "DL")).toBeGreaterThan(positionFit(lefty, "DC"));

    const righty = player({ eligiblePositions: ["MID"], preferredSide: "right" });
    expect(positionFit(righty, "MR")).toBeGreaterThan(positionFit(righty, "ML"));

    const centre = player({ eligiblePositions: ["MID"], preferredSide: "centre" });
    expect(positionFit(centre, "MC")).toBeGreaterThan(positionFit(centre, "ML"));
    expect(positionFit(centre, "MC")).toBeGreaterThan(positionFit(centre, "MR"));
  });

  it("no preference leaves both flanks equal (unchanged behaviour)", () => {
    const any = player({ eligiblePositions: ["DEF"] });
    expect(positionFit(any, "DL")).toBe(positionFit(any, "DR"));
  });

  it("never gates — still fillable on the wrong wing, and tier order is preserved", () => {
    const lefty = player({ eligiblePositions: ["DEF"], preferredSide: "left" });
    expect(canFillSlot(lefty, "DR")).toBe(true);
    // same-group on the wrong wing still beats an adjacent-group fit on the matching side
    const sameGroupWrongWing = positionFit(lefty, "DR");
    const adjacentRightSide = positionFit(player({ eligiblePositions: ["MC"], preferredSide: "right" }), "DR");
    expect(sameGroupWrongWing).toBeGreaterThan(adjacentRightSide);
  });
});
