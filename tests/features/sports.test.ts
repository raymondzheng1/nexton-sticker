/**
 * Period wording follows the FORMAT, not the sport. A four-period football match used to be
 * narrated as "Half 3 of 4" everywhere — live pill, buttons, break panel, match log, the parents'
 * swapsies note (QA sweep, 2026-08-17).
 */
import { describe, expect, it } from "vitest";
import { breakLabelFor, periodLabelFor } from "../../src/features/sports";

describe("periodLabelFor / breakLabelFor", () => {
  it("two periods are halves, four are quarters, anything else is a period", () => {
    expect(periodLabelFor(2)).toBe("Half");
    expect(periodLabelFor(4)).toBe("Quarter");
    expect(periodLabelFor(1)).toBe("Period");
    expect(periodLabelFor(3)).toBe("Period");
  });

  it("the break heading matches the noun", () => {
    expect(breakLabelFor(2)).toBe("Half time");
    expect(breakLabelFor(4)).toBe("Quarter time");
    expect(breakLabelFor(3)).toBe("Period break");
  });
});
