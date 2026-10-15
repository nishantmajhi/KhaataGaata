import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * In production the in-memory fallback is close to no protection at all: each
 * serverless instance keeps its own counters and a cold start resets them, so
 * a distributed attempt on the single login form sees a fresh allowance per
 * instance. The module used to degrade to it silently, which meant a
 * deployment with a typo in an environment variable name looked exactly like
 * a deployment with working rate limiting.
 *
 * Each case re-imports the module with a different environment, because the
 * decision is made once when it loads.
 */

async function importWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return import("@/lib/ratelimit");
}

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token-value",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("rate limiting configuration", () => {
  it("refuses to load in production with no Redis configured", async () => {
    await expect(
      importWith({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      })
    ).rejects.toThrow(/rate limiting is not configured/i);
  });

  it("names both variables, so a typo in one is findable", async () => {
    const error = await importWith({
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    }).catch((e: Error) => e);

    expect(String(error)).toContain("UPSTASH_REDIS_REST_URL");
    expect(String(error)).toContain("UPSTASH_REDIS_REST_TOKEN");
  });

  it("refuses when only one of the two is set", async () => {
    // Half-configured is the case a truthiness check on one variable would
    // wave through, and it is the likeliest way to get here by accident.
    await expect(
      importWith({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      })
    ).rejects.toThrow(/rate limiting is not configured/i);
  });

  it("loads in production when Redis is configured", async () => {
    const mod = await importWith({ NODE_ENV: "production", ...UPSTASH });
    expect(typeof mod.limitLogin).toBe("function");
  });

  it("allows the fallback in production when it is asked for explicitly", async () => {
    // Deploying without Redis has to stay possible; it just has to be a
    // decision somebody typed rather than an environment variable nobody set.
    const mod = await importWith({
      NODE_ENV: "production",
      ALLOW_MEMORY_RATELIMIT: "1",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    });
    expect((await mod.limitLogin("198.51.100.4")).success).toBe(true);
  });

  it("still falls back quietly in development", async () => {
    const mod = await importWith({
      NODE_ENV: "development",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    });
    expect((await mod.limitLookup("198.51.100.5")).success).toBe(true);
  });

  it("the opt-out is exact, not merely truthy", async () => {
    // "0" and "false" are the two values somebody sets while meaning the
    // opposite of what a truthiness check would do with them.
    for (const value of ["0", "false", "no"]) {
      await expect(
        importWith({
          NODE_ENV: "production",
          ALLOW_MEMORY_RATELIMIT: value,
          UPSTASH_REDIS_REST_URL: undefined,
          UPSTASH_REDIS_REST_TOKEN: undefined,
        })
      ).rejects.toThrow(/rate limiting is not configured/i);
      vi.unstubAllEnvs();
    }
  });
});
