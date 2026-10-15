/**
 * A fixed-window rate limiter held in process memory.
 *
 * This is the fallback used when Upstash Redis is not configured. It is not a
 * substitute for the real thing — on a serverless platform each instance has
 * its own copy and a cold start wipes it — but it does have to behave itself
 * in the one process it lives in. The keys it tracks are derived from request
 * headers, which means the set of distinct keys is chosen by whoever is
 * sending the requests, so an unbounded map here is a memory leak with an
 * external trigger.
 *
 * Two things keep it bounded. Entries whose window has passed are swept, at
 * most once per window rather than on every call. And a hard capacity evicts
 * the oldest entry when a new key arrives at a full table. Eviction hands back
 * an allowance, which is the wrong way to be wrong for a limiter, so capacity
 * is set far above any plausible honest load and reached only under an attack
 * that this limiter was never the defence against.
 */

export type LimiterOptions = {
  /** Hits allowed per key per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum distinct keys held at once. */
  capacity?: number;
  /** Injectable clock, so tests do not have to wait or stub timers. */
  now?: () => number;
};

export type LimitResult = { success: boolean; remaining: number };

const DEFAULT_CAPACITY = 10_000;

export function createMemoryLimiter(options: LimiterOptions) {
  const { max, windowMs } = options;
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  // Called through a closure rather than captured as `Date.now`, so a test
  // that installs fake timers after this module loads still moves this clock.
  const now = options.now ?? (() => Date.now());

  const entries = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();

  function sweep(at: number) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= at) entries.delete(key);
    }
    lastSweep = at;
  }

  function makeRoom() {
    // Map iterates in insertion order and a key is re-inserted whenever its
    // window restarts, so the first key out is the one whose window began
    // longest ago.
    while (entries.size >= capacity) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  }

  return {
    hit(key: string): LimitResult {
      const at = now();
      if (at - lastSweep >= windowMs) sweep(at);

      const entry = entries.get(key);
      if (entry && entry.resetAt > at) {
        entry.count += 1;
        return { success: entry.count <= max, remaining: Math.max(0, max - entry.count) };
      }

      // Either a key we have never seen or one whose window has lapsed. Only
      // a genuinely new key can push the table over capacity.
      if (!entry) makeRoom();
      entries.delete(key);
      entries.set(key, { count: 1, resetAt: at + windowMs });
      return { success: max >= 1, remaining: Math.max(0, max - 1) };
    },

    /** Distinct keys currently tracked. Exposed so the bound can be asserted. */
    get size() {
      return entries.size;
    },
  };
}

export type MemoryLimiter = ReturnType<typeof createMemoryLimiter>;
