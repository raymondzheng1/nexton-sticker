/**
 * Rate limiter behaviour, especially its FAILURE paths.
 *
 * The load-bearing test here is the immortal-counter one. The limiter guards the two endpoints that
 * send email, so a limiter that jams shut doesn't just throttle someone — it silently stops the
 * operator's alerts arriving, with a 429 that looks identical to working-as-intended.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, UpstashRateLimiter, type UpstashCommandRunner } from "../../src/server/rateLimit";

const CONFIG = { url: "https://kv.example", token: "t" };

/**
 * A tiny fake Redis: INCR / EXPIRE / TTL over a map, with hooks to make a command fail. Enough to
 * exercise exactly the sequence the limiter issues, without a live Upstash.
 */
function fakeRedis(opts: { failCommands?: Set<string>; failOnce?: Set<string> } = {}) {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const calls: string[] = [];
  const failOnce = new Set(opts.failOnce ?? []);

  const run: UpstashCommandRunner = (_cfg, args) => {
    const cmd = String(args[0]);
    const key = String(args[1]);
    calls.push(cmd);
    if (opts.failCommands?.has(cmd) || failOnce.has(cmd)) {
      failOnce.delete(cmd);
      return Promise.reject(new Error(`Upstash command failed: 500 (${cmd})`));
    }
    switch (cmd) {
      case "INCR": {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return Promise.resolve(next);
      }
      case "EXPIRE":
        ttls.set(key, Number(args[2]));
        return Promise.resolve(1);
      case "TTL":
        return Promise.resolve(ttls.has(key) ? (ttls.get(key) as number) : -1);
      default:
        return Promise.resolve(null);
    }
  };

  return { run, counts, ttls, calls };
}

describe("in-memory rate limiter", () => {
  it("allows up to the max in a window, then denies, then resets on the next window", async () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(3, 1000, () => now);
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) seen.push((await limiter.check("ip")).allowed);
    expect(seen).toEqual([true, true, true, false]);

    now += 1001; // window rolls over
    expect((await limiter.check("ip")).allowed).toBe(true);
  });
});

describe("upstash rate limiter", () => {
  it("allows up to the max, then denies", async () => {
    const redis = fakeRedis();
    const limiter = new UpstashRateLimiter(CONFIG, 3, 60, redis.run);
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) seen.push((await limiter.check("ip")).allowed);
    expect(seen).toEqual([true, true, true, false]);
  });

  it("sets the expiry once, on the first hit of the window", async () => {
    const redis = fakeRedis();
    const limiter = new UpstashRateLimiter(CONFIG, 5, 60, redis.run);
    await limiter.check("ip");
    await limiter.check("ip");
    expect(redis.ttls.get("rl:ip")).toBe(60);
    // One EXPIRE, not one per request — resetting the window on every hit would make the limit
    // unreachable under sustained load.
    expect(redis.calls.filter((c) => c === "EXPIRE")).toHaveLength(1);
  });

  it("does not lock a caller out forever when the EXPIRE never lands", async () => {
    // THE REGRESSION. INCR succeeds, EXPIRE fails, so the counter exists with no TTL. Before the
    // repair path, `count === 1` was never true again, the expiry was never retried, and every
    // later request incremented an immortal counter — a permanent 429 for that IP, which reads
    // exactly like "I passed some threshold and email stopped working".
    const redis = fakeRedis({ failOnce: new Set(["EXPIRE"]) });
    const limiter = new UpstashRateLimiter(CONFIG, 2, 60, redis.run);

    // The failed EXPIRE must not cost the caller their request.
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect(redis.ttls.has("rl:ip")).toBe(false); // no expiry — the counter is currently immortal

    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false); // over the max, correctly denied

    // …and on the way to denying, it noticed the missing TTL and repaired it, so the block lasts a
    // window instead of forever.
    expect(redis.ttls.get("rl:ip")).toBe(60);
  });

  it("keeps denying when the TTL can't even be checked — never fails open", async () => {
    // If the repair itself is broken we must still honour the count. Failing open here would hand
    // an attacker an unlimited email endpoint.
    const redis = fakeRedis({ failCommands: new Set(["EXPIRE", "TTL"]) });
    const limiter = new UpstashRateLimiter(CONFIG, 1, 60, redis.run);
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);
    expect((await limiter.check("ip")).allowed).toBe(false);
  });

  it("counts each caller separately", async () => {
    const redis = fakeRedis();
    const limiter = new UpstashRateLimiter(CONFIG, 1, 60, redis.run);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);
  });
});
