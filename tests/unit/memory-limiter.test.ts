import { describe, it, expect } from "vitest";
import { createMemoryLimiter } from "@/lib/memory-limiter";

/**
 * The in-memory limiter is the fallback when Upstash is not configured. It is
 * a safety net rather than a real limiter, but a safety net that grows without
 * bound is a leak: one entry per distinct key, kept for the life of the
 * process. Since the key is derived from request headers, the set of distinct
 * keys is chosen by whoever is sending the requests.
 */

/** A clock the test moves by hand, so nothing here depends on real time. */
function clockAt(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("createMemoryLimiter", () => {
  it("allows up to max hits inside the window", () => {
    const limiter = createMemoryLimiter({ max: 3, windowMs: 1000 });
    expect(limiter.hit("a").success).toBe(true);
    expect(limiter.hit("a").success).toBe(true);
    expect(limiter.hit("a").success).toBe(true);
    expect(limiter.hit("a").success).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    const limiter = createMemoryLimiter({ max: 3, windowMs: 1000 });
    expect(limiter.hit("a").remaining).toBe(2);
    expect(limiter.hit("a").remaining).toBe(1);
    expect(limiter.hit("a").remaining).toBe(0);
    expect(limiter.hit("a").remaining).toBe(0);
  });

  it("keeps separate keys separate", () => {
    const limiter = createMemoryLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.hit("a").success).toBe(true);
    expect(limiter.hit("b").success).toBe(true);
    expect(limiter.hit("a").success).toBe(false);
  });

  it("starts a fresh window once the old one has passed", () => {
    const clock = clockAt();
    const limiter = createMemoryLimiter({ max: 1, windowMs: 1000, now: clock.now });
    expect(limiter.hit("a").success).toBe(true);
    expect(limiter.hit("a").success).toBe(false);
    clock.advance(1001);
    expect(limiter.hit("a").success).toBe(true);
  });

  it("forgets keys whose window has expired", () => {
    const clock = clockAt();
    const limiter = createMemoryLimiter({ max: 5, windowMs: 1000, now: clock.now });
    for (let i = 0; i < 500; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size).toBe(500);

    clock.advance(1001);
    limiter.hit("someone-else");
    // The 500 expired entries are dead weight; only the live one should remain.
    expect(limiter.size).toBe(1);
  });

  it("never grows past its capacity even while every window is live", () => {
    const clock = clockAt();
    const limiter = createMemoryLimiter({
      max: 5,
      windowMs: 60_000,
      capacity: 100,
      now: clock.now,
    });
    for (let i = 0; i < 10_000; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("evicts the oldest entries first when it hits capacity", () => {
    const clock = clockAt();
    const limiter = createMemoryLimiter({
      max: 1,
      windowMs: 60_000,
      capacity: 2,
      now: clock.now,
    });
    limiter.hit("first");
    clock.advance(10);
    limiter.hit("second");
    clock.advance(10);
    limiter.hit("third"); // pushes "first" out

    expect(limiter.size).toBe(2);
    // "first" was forgotten, so it gets a fresh allowance.
    expect(limiter.hit("first").success).toBe(true);
    // "third" is still tracked and is already out of allowance.
    expect(limiter.hit("third").success).toBe(false);
  });

  it("is honest that eviction under capacity pressure forgives a limit", () => {
    // Worth asserting rather than leaving implicit: an evicted key is an
    // allowance handed back. That is why capacity is large and why this
    // limiter is documented as a fallback, not a control.
    const limiter = createMemoryLimiter({ max: 1, windowMs: 60_000, capacity: 1 });
    expect(limiter.hit("a").success).toBe(true);
    limiter.hit("b");
    expect(limiter.hit("a").success).toBe(true);
  });
});
