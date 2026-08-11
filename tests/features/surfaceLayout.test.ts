import { describe, expect, it } from "vitest";
import { pitchLayout } from "../../src/features/live/surfaceLayout";

const e = (id: string, slot: string): { id: string; slot: string } => ({ id, slot });

describe("pitchLayout — conventional football formation spots", () => {
  it("4-4-2: back four spans the width, double centre-backs straddle the middle, front two sits narrow", () => {
    const layout = pitchLayout([
      e("gk", "GK"),
      e("dl", "DL"), e("dc1", "DC"), e("dc2", "DC"), e("dr", "DR"),
      e("ml", "ML"), e("mc1", "MC"), e("mc2", "MC"), e("mr", "MR"),
      e("fl", "FL"), e("fr", "FR"),
    ]);
    expect(layout.get("gk")).toEqual({ x: 50, y: 82 });
    // back four: fullbacks hug the flanks, the two DCs fan around centre
    expect(layout.get("dl")!.x).toBe(22);
    expect(layout.get("dr")!.x).toBe(78);
    expect(layout.get("dc1")!.x).toBeLessThan(50);
    expect(layout.get("dc2")!.x).toBeGreaterThan(50);
    // front two: NARROW pair (strikers, not wingers)
    expect(layout.get("fl")!.x).toBe(34);
    expect(layout.get("fr")!.x).toBe(66);
    // all defenders share a row deeper (bigger y) than the forwards
    expect(layout.get("dl")!.y).toBeGreaterThan(layout.get("fl")!.y);
  });

  it("4-2-3-1: double pivot fans around centre; wide mids stay WIDE; CAM band sits between MID and FWD", () => {
    const layout = pitchLayout([
      e("gk", "GK"),
      e("dl", "DL"), e("dc1", "DC"), e("dc2", "DC"), e("dr", "DR"),
      e("dm1", "DM"), e("dm2", "DM"),
      e("ml", "ML"), e("am", "AM"), e("mr", "MR"),
      e("fc", "FC"),
    ]);
    // double pivot: both central, fanned
    const dm1 = layout.get("dm1")!;
    const dm2 = layout.get("dm2")!;
    expect(dm1.y).toBe(dm2.y);
    expect(dm1.x).toBeLessThan(50);
    expect(dm2.x).toBeGreaterThan(50);
    // ML/MR flank the CAM — they are true wingers, NOT a narrow pair
    expect(layout.get("ml")!.x).toBe(22);
    expect(layout.get("mr")!.x).toBe(78);
    expect(layout.get("am")!.x).toBe(50);
    // vertical ordering back→front: DEF > DM > MID > AM > FWD (y grows toward our goal)
    const y = (id: string): number => layout.get(id)!.y;
    expect(y("dl")).toBeGreaterThan(y("dm1"));
    expect(y("dm1")).toBeGreaterThan(y("ml"));
    expect(y("ml")).toBeGreaterThan(y("am"));
    expect(y("am")).toBeGreaterThan(y("fc"));
  });

  it("empty bands collapse: 2-3-1 spreads across exactly three outfield rows", () => {
    const layout = pitchLayout([
      e("gk", "GK"),
      e("dl", "DL"), e("dr", "DR"),
      e("ml", "ML"), e("mc", "MC"), e("mr", "MR"),
      e("fc", "FC"),
    ]);
    expect(layout.get("dl")!.y).toBe(66); // back line
    expect(layout.get("mc")!.y).toBe(40); // middle band (empty CDM/CAM bands collapsed)
    expect(layout.get("fc")!.y).toBe(14); // front line
    // a defender PAIR (no centre-back) sits narrow, like a front two
    expect(layout.get("dl")!.x).toBe(34);
    expect(layout.get("dr")!.x).toBe(66);
    expect(layout.get("mc")!.x).toBe(50);
  });

  it("no hard-coded count: an oversized line fans out and stays inside the surface", () => {
    const many = Array.from({ length: 6 }, (_, i) => e(`mc${i}`, "MC"));
    const layout = pitchLayout([e("gk", "GK"), ...many]);
    for (const m of many) {
      const p = layout.get(m.id)!;
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(92);
    }
    // all on one row (only the MID band is occupied)
    expect(new Set(many.map((m) => layout.get(m.id)!.y)).size).toBe(1);
  });
});
