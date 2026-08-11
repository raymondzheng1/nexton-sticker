import { describe, expect, it } from "vitest";
import {
  EngineError,
  buildCustomFormation,
  generateFormation,
  getFormation,
  groupOf,
  listFormations,
  styleFormation,
} from "../../src/engine/index";

describe("formation library + generator (flexible format, PRD §6.1)", () => {
  it("uses the PRD-specified curated defaults", () => {
    expect(getFormation(7).name).toBe("2-3-1");
    expect(getFormation(10).name).toBe("3-3-3");
  });

  it("builds basketball lineups (PG/SG/SF/PF/C, no GK, any count)", () => {
    const five = getFormation(5, undefined, "basketball");
    expect(five.slots).toHaveLength(5);
    expect(five.slots).toContain("PG");
    expect(five.slots).toContain("C");
    expect(five.slots).not.toContain("GK");
    // guards + forwards + centre all represented for a standard 5
    expect(new Set(five.slots.map(groupOf))).toEqual(new Set(["G", "F", "C"]));
    // no hard-coded count — any size yields that many court slots
    for (let n = 3; n <= 12; n++) {
      expect(getFormation(n, undefined, "basketball").slots, `basketball ${n}`).toHaveLength(n);
    }
    // football is unaffected by the sport param default
    expect(getFormation(7).slots).toContain("GK");
  });

  it("offers CDM/CAM formations using the DM/AM slots (vertical midfield roles)", () => {
    const f = getFormation(11, "4-2-3-1");
    expect(f.slots.filter((s) => s === "DM")).toHaveLength(2); // double pivot
    expect(f.slots).toContain("AM"); // CAM
    expect(f.slots).toHaveLength(11);
    // a CDM option exists at 7-a-side and a CAM option at 9-a-side
    expect(listFormations(7).some((o) => o.slots.includes("DM"))).toBe(true);
    expect(listFormations(9).some((o) => o.slots.includes("AM"))).toBe(true);
  });

  it("DRIFT DEFENCE: every formation's slot count equals its onFieldCount (no hard-coded 7/11)", () => {
    // The single most important invariant — exercised across a wide arbitrary range incl. 10v10.
    for (let n = 3; n <= 18; n++) {
      const f = getFormation(n);
      expect(f.slots.length, `default formation for ${n}`).toBe(n);
      expect(f.onFieldCount).toBe(n);
      const gen = generateFormation(n);
      expect(gen.slots.length, `generated formation for ${n}`).toBe(n);
      for (const opt of listFormations(n)) {
        expect(opt.slots.length, `listed formation ${opt.name} for ${n}`).toBe(n);
      }
    }
  });

  it("always includes exactly one GK", () => {
    for (let n = 3; n <= 14; n++) {
      const gkCount = getFormation(n).slots.filter((s) => s === "GK").length;
      expect(gkCount, `GK count for ${n}`).toBe(1);
    }
  });

  it("generates a balanced formation for an uncommon count (e.g. 13v13)", () => {
    const f = generateFormation(13); // 12 outfield → 4-4-4
    expect(f.generated).toBe(true);
    expect(f.slots.length).toBe(13);
    expect(f.name).toBe("4-4-4");
  });

  it("lists multiple options for common counts", () => {
    expect(listFormations(7).map((f) => f.name)).toContain("2-3-1");
    expect(listFormations(11).length).toBeGreaterThan(1);
  });

  it("throws (loud failure) when an unknown formation name is requested", () => {
    expect(() => getFormation(7, "9-9-9")).toThrow(EngineError);
  });

  it("throws on an invalid on-field count", () => {
    expect(() => getFormation(0)).toThrow(EngineError);
    expect(() => generateFormation(2.5)).toThrow(EngineError);
  });
});

describe("styleFormation (tactical big-picture, PRD §6.1)", () => {
  const defCount = (slots: string[]): number => slots.filter((s) => /^D/.test(s)).length;
  const fwdCount = (slots: string[]): number => slots.filter((s) => /^F/.test(s)).length;

  it("biases defenders vs forwards by style, for a range of counts, always summing to onFieldCount", () => {
    for (let n = 7; n <= 11; n++) {
      const def = styleFormation(n, "defensive");
      const att = styleFormation(n, "attacking");
      const agg = styleFormation(n, "aggressive");
      for (const f of [def, att, agg]) expect(f.slots.length).toBe(n);
      expect(defCount(def.slots)).toBeGreaterThanOrEqual(fwdCount(def.slots)); // defensive: DEF ≥ FWD
      expect(fwdCount(att.slots)).toBeGreaterThanOrEqual(defCount(att.slots)); // attacking: FWD ≥ DEF
      expect(fwdCount(agg.slots)).toBeGreaterThanOrEqual(fwdCount(att.slots)); // aggressive most forward
    }
  });

  it('"balanced" matches generateFormation', () => {
    expect(styleFormation(10, "balanced").slots).toEqual(generateFormation(10).slots);
  });
});

describe("buildCustomFormation (custom builder, PRD §6.1)", () => {
  it("builds from explicit line counts that sum to onFieldCount − 1", () => {
    const f = buildCustomFormation(11, [4, 4, 2]); // GK + 4-4-2
    expect(f.slots.length).toBe(11);
    expect(f.name).toBe("4-4-2");
    expect(f.slots[0]).toBe("GK");
  });

  it("throws when the lines don't fit the on-field count", () => {
    expect(() => buildCustomFormation(11, [4, 4, 4])).toThrow(EngineError); // sums to 12 ≠ 10
    expect(() => buildCustomFormation(7, [-1, 4, 3])).toThrow(EngineError);
  });

  it("supports optional CDM/CAM lines in a custom shape", () => {
    // 9-a-side: 3 DEF, 1 CDM, 2 MID, 1 CAM, 1 ATT (+GK) = 9
    const f = buildCustomFormation(9, [3, 2, 1], { dm: 1, am: 1 });
    expect(f.slots).toHaveLength(9);
    expect(f.name).toBe("3-1-2-1-1");
    expect(f.slots.filter((s) => s === "DM")).toHaveLength(1);
    expect(f.slots.filter((s) => s === "AM")).toHaveLength(1);
    expect(f.slots[0]).toBe("GK");
    // roles count toward the outfield total — over-allocating throws
    expect(() => buildCustomFormation(9, [3, 3, 1], { dm: 1, am: 1 })).toThrow(EngineError);
  });
});
