import { describe, it, expect, vi, beforeEach } from "vitest";

// No Upstash env vars are set in tests, so this exercises the in-memory
// fallback path — the one that runs when someone deploys without Redis.
const { limitLookup, limitLogin, clientIp } = await import("@/lib/ratelimit");

// These first two assertions used to require the *first* hop, which is the
// entry the client supplies and can change per request. They were asserting
// the bug fixed on 2026-09-25 as the expected result; see tests/unit/clientip.test.ts
// for what goes wrong when the leftmost hop is trusted.
describe("clientIp", () => {
  it("takes the last hop from x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" });
    expect(clientIp(h)).toBe("150.172.238.178");
  });

  it("trims whitespace around the address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "  203.0.113.9  , 70.41.3.18  " }))).toBe(
      "70.41.3.18"
    );
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("does not throw on a malformed header", () => {
    expect(() => clientIp(new Headers({ "x-forwarded-for": "" }))).not.toThrow();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});

describe("lookup limiter (in-memory fallback)", () => {
  beforeEach(() => vi.useRealTimers());

  it("allows the first 20 requests from one address", async () => {
    const ip = `ip-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect((await limitLookup(ip)).success, `request ${i + 1}`).toBe(true);
    }
  });

  it("blocks the 21st", async () => {
    const ip = `ip-${Math.random()}`;
    for (let i = 0; i < 20; i++) await limitLookup(ip);
    expect((await limitLookup(ip)).success).toBe(false);
  });

  it("counts each address separately", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 25; i++) await limitLookup(a);
    expect((await limitLookup(a)).success).toBe(false);
    expect((await limitLookup(b)).success).toBe(true);
  });

  it("recovers once the window rolls over", async () => {
    vi.useFakeTimers();
    const ip = `ip-${Math.random()}`;
    for (let i = 0; i < 25; i++) await limitLookup(ip);
    expect((await limitLookup(ip)).success).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect((await limitLookup(ip)).success).toBe(true);
    vi.useRealTimers();
  });
});

describe("login limiter", () => {
  it("is much stricter than the lookup limiter", async () => {
    const ip = `login-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect((await limitLogin(ip)).success, `attempt ${i + 1}`).toBe(true);
    }
    // A five-attempt cap is what makes a short staff password survivable.
    expect((await limitLogin(ip)).success).toBe(false);
  });

  it("uses a separate budget from lookups", async () => {
    const ip = `shared-${Math.random()}`;
    for (let i = 0; i < 6; i++) await limitLogin(ip);
    expect((await limitLogin(ip)).success).toBe(false);
    expect((await limitLookup(ip)).success).toBe(true);
  });
});
