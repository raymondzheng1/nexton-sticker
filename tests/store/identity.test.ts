import { afterEach, describe, expect, it } from "vitest";
import { getOwnerId, resetOwnerId, setOwnerId } from "../../src/store/index";

describe("identity seam (getOwnerId)", () => {
  afterEach(resetOwnerId);

  it("defaults to the implicit local owner", () => {
    expect(getOwnerId()).toBe("local");
  });

  it("accepts the local owner and a valid capability code", () => {
    setOwnerId("RVS-K27");
    expect(getOwnerId()).toBe("RVS-K27");
    setOwnerId("local");
    expect(getOwnerId()).toBe("local");
  });

  it("rejects an invalid capability code loudly (no silent bad identity)", () => {
    expect(() => setOwnerId("LIO-N7F")).toThrow(); // contains excluded L, I, O
    expect(() => setOwnerId("nonsense")).toThrow();
    expect(getOwnerId()).toBe("local"); // unchanged after a rejected set
  });

  it("resets to local", () => {
    setOwnerId("RVS-K27");
    resetOwnerId();
    expect(getOwnerId()).toBe("local");
  });
});
