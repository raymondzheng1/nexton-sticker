/**
 * Rate limiting for the public sync endpoint (Harness §6.4 — fail-closed). The route denies when no
 * limiter is available in production. The in-memory limiter is for tests + local dev (per-instance);
 * production uses the Upstash-backed one so the limit is shared across serverless invocations.
 */
import { upstashCommand, type UpstashConfig } from "../store/adapters/upstashKvStore";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

/** Fixed-window in-memory limiter. Clock injected for deterministic tests. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  check(key: string): Promise<RateLimitResult> {
    const now = this.clock();
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return Promise.resolve({ allowed: true, remaining: this.max - 1 });
    }
    if (entry.count >= this.max) {
      return Promise.resolve({ allowed: false, remaining: 0 });
    }
    entry.count += 1;
    return Promise.resolve({ allowed: true, remaining: this.max - entry.count });
  }
}

/** Injection seam so the limiter's failure paths can be tested without a live Upstash. */
export type UpstashCommandRunner = (config: UpstashConfig, args: (string | number)[]) => Promise<unknown>;

/**
 * Distributed fixed-window limiter backed by Upstash (INCR + EXPIRE). Used in production.
 *
 * THE HAZARD THIS GUARDS AGAINST: INCR and EXPIRE are two separate round trips, and the expiry is
 * only set on the first hit of a window. If that EXPIRE never lands — a network blip, an Upstash
 * 5xx, the instance dying in between — the counter exists with NO TTL. It is then immortal: `count`
 * is never 1 again, so the expiry is never retried, the tally only climbs, and once it passes `max`
 * that caller is locked out **permanently**. A limiter that jams shut forever is a far worse failure
 * than one that briefly lets an extra request through, so the count is repaired rather than trusted.
 */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly config: UpstashConfig,
    private readonly max: number,
    private readonly windowSeconds: number,
    private readonly run: UpstashCommandRunner = upstashCommand,
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const rlKey = `rl:${key}`;
    const count = Number(await this.run(this.config, ["INCR", rlKey]));

    if (count === 1) {
      // First hit of a window: start the clock. A failure here must not cost the caller their
      // request — the counter self-heals below once it would otherwise start denying.
      try {
        await this.run(this.config, ["EXPIRE", rlKey, this.windowSeconds]);
      } catch {
        // Swallowed deliberately: see the class comment. The repair path covers it.
      }
      return { allowed: true, remaining: this.max - 1 };
    }

    if (count > this.max) {
      // About to deny — first make sure this counter is actually going to expire. Checked only on
      // the deny path, so the common case stays a single round trip.
      try {
        const ttl = Number(await this.run(this.config, ["TTL", rlKey]));
        if (ttl < 0) {
          // No expiry set (-1) or key vanished mid-flight (-2): give it one, so the block lasts a
          // window rather than the rest of time.
          await this.run(this.config, ["EXPIRE", rlKey, this.windowSeconds]);
        }
      } catch {
        // Can't verify the TTL — deny this request as the count says, and try the repair again next
        // time. Failing open here would hand an attacker an unlimited endpoint.
      }
    }

    return { allowed: count <= this.max, remaining: Math.max(0, this.max - count) };
  }
}
