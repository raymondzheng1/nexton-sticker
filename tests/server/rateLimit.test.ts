import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../../src/server/rateLimit";

describe("InMemoryRateLimiter (fail-closed fixed window, Harness §6.4)", () => {
  it("allows up to max within the window, then blocks", async () => {
    const t = 1000;
    const limiter = new InMemoryRateLimiter(3, 60_000, () => t);
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false); // 4th in-window → blocked
  });

  it("resets after the window elapses", async () => {
    let t = 1000;
    const limiter = new InMemoryRateLimiter(1, 60_000, () => t);
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);
    t += 60_000; // window passes
    expect((await limiter.check("ip")).allowed).toBe(true);
  });

  it("tracks separate keys independently", async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, () => 1000);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true); // different ip, own budget
    expect((await limiter.check("a")).allowed).toBe(false);
  });
});
