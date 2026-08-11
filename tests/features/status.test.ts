import { describe, expect, it } from "vitest";
import { STATUS_TOL_SECONDS, statusFor, statusTolFor } from "../../src/features/live/status";

describe("status tolerance scales with match length (short-game fairness display)", () => {
  it("is 10% of the scheduled match, clamped to [30s, 4min]", () => {
    expect(statusTolFor(6 * 60)).toBe(36); // 6′ game → 36s band
    expect(statusTolFor(20 * 60)).toBe(120); // 20′ game → 2′ band
    expect(statusTolFor(50 * 60)).toBe(STATUS_TOL_SECONDS); // standard game → capped at 4′ (unchanged)
    expect(statusTolFor(60)).toBe(30); // absurdly tiny → floor 30s
  });

  it('REGRESSION: a 6′ game split 6′-vs-3′ must NOT read "100% fair"', () => {
    // 6′ match, 5 on court, 7 in squad → fair share = 30/7 ≈ 4.29′ (257s).
    const fairSeconds = (6 * 60 * 5) / 7;
    const tol = statusTolFor(6 * 60);
    const debtSixMin = fairSeconds - 6 * 60; // ≈ −103s (played 6′ — well over fair share)
    const debtThreeMin = fairSeconds - 3 * 60; // ≈ +77s (played 3′ — under fair share)
    expect(statusFor(debtSixMin, tol)).toBe("over"); // was "on" with the fixed 4′ band
    expect(statusFor(debtThreeMin, tol)).toBe("under");
    // The same debts in a standard-length game ARE fine — the fixed band stays for those.
    expect(statusFor(debtSixMin)).toBe("on");
    expect(statusFor(debtThreeMin)).toBe("on");
  });
});
