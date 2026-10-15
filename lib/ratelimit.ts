import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createMemoryLimiter } from "./memory-limiter";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * In production the in-memory fallback is close to no protection at all: each
 * serverless instance keeps its own counters and a cold start resets them, so
 * a distributed attempt on the single login form sees a fresh allowance per
 * instance. Refuse to start rather than serve a limiter that only looks like
 * one. Set ALLOW_MEMORY_RATELIMIT=1 to deploy without Redis deliberately.
 */
if (
  !hasUpstash &&
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_MEMORY_RATELIMIT !== "1"
) {
  throw new Error(
    "Rate limiting is not configured. Set UPSTASH_REDIS_REST_URL and " +
      "UPSTASH_REDIS_REST_TOKEN, or set ALLOW_MEMORY_RATELIMIT=1 to accept " +
      "the per-instance in-memory fallback."
  );
}

const redis = hasUpstash ? Redis.fromEnv() : null;

function build(tokens: number, window: `${number} ${"s" | "m" | "h"}`, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    analytics: false,
    prefix,
  });
}

// Order IDs are short, so the lookup endpoint is the one an attacker would
// hammer to enumerate other people's orders. This is the main reason Redis
// is in the stack at all.
const lookupLimiter = build(20, "1 m", "kg:lookup");
const loginLimiter = build(5, "10 m", "kg:login");
// Staff are trusted but a stuck form or a double-click storm should not be
// able to fill the ledger with junk, and a leaked session should not be able
// to do it quickly either.
const adminWriteLimiter = build(40, "1 m", "kg:admin");

// Fallback for local dev, or for a deployment that has opted out of Redis.
// Per-instance and it resets on cold start, so it is a safety net, not a
// substitute for the real thing.
const lookupMemory = createMemoryLimiter({ max: 20, windowMs: 60_000 });
const loginMemory = createMemoryLimiter({ max: 5, windowMs: 600_000 });
const adminMemory = createMemoryLimiter({ max: 40, windowMs: 60_000 });

export async function limitLookup(ip: string) {
  if (lookupLimiter) return lookupLimiter.limit(ip);
  return lookupMemory.hit(ip);
}

export async function limitLogin(ip: string) {
  if (loginLimiter) return loginLimiter.limit(ip);
  return loginMemory.hit(ip);
}

/** Applied to every staff action that writes: create, edit, status, staff. */
export async function limitAdminWrite(key: string) {
  if (adminWriteLimiter) return adminWriteLimiter.limit(key);
  return adminMemory.hit(key);
}

/**
 * The key every rate limit in this application is counted against.
 *
 * X-Forwarded-For is a list that each hop appends to, so the leftmost entry is
 * whatever the *client* sent and the rightmost is the one written by the proxy
 * closest to us — the only entry in the header a visitor cannot choose. Taking
 * the leftmost lets anyone mint a new identity per request by varying one
 * header, which does not merely weaken the limits, it removes them: five login
 * attempts per ten minutes becomes five per ten minutes *per forged value*.
 *
 * Behind a chain of proxies the rightmost entry is the nearest proxy rather
 * than the visitor, which lumps several visitors into one bucket. That is the
 * safe direction to be wrong in: a shared bucket still limits, a per-request
 * bucket does not. The same reasoning is why a request with nothing usable
 * gets the single shared "unknown" key.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
