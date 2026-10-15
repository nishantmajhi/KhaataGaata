import { describe, it, expect, beforeEach, vi } from "vitest";

const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

const limits = vi.hoisted(() => ({ lookup: { success: true }, keys: [] as string[] }));
vi.mock("@/lib/ratelimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratelimit")>();
  return {
    ...actual,
    // clientIp is deliberately left real: the key this route counts against
    // is the thing worth asserting, so it is recorded rather than replaced.
    limitLookup: async (key: string) => {
      limits.keys.push(key);
      return limits.lookup;
    },
  };
});

const { GET } = await import("@/app/api/orders/[orderId]/route");

const ORDER_ROW = {
  id: 7,
  order_id: "KG24MB",
  customer_name: "Sunita Shrestha",
  customer_phone: "+977 9800000000",
  address: "Jhamsikhel, Lalitpur",
  status: "shipped",
  total_paisa: "185000",
  created_at: new Date("2026-08-10T07:44:00Z"),
  updated_at: new Date("2026-08-13T01:44:00Z"),
};

const call = (id: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://shop.example/api/orders/${id}`, { headers }), {
    params: Promise.resolve({ orderId: id }),
  });

beforeEach(() => {
  fake.reset();
  limits.lookup = { success: true };
  limits.keys.length = 0;
});

describe("GET /api/orders/[orderId]", () => {
  it("returns 404 for an ID that does not exist", async () => {
    const res = await call("ZZZZZZ");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("returns 400 for a malformed ID without touching the database", async () => {
    for (const bad of ["ab", "abcdefghij", "AB CD", "%2e%2e%2f"]) {
      const res = await call(bad);
      expect(res.status, bad).toBe(400);
    }
    expect(fake.queries).toHaveLength(0);
  });

  it("normalises a lowercase ID rather than rejecting it", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [])
      .when(/from order_events/i, () => []);
    const res = await call("kg24mb");
    expect(res.status).toBe(200);
    expect(fake.find(/from orders/i)?.params).toEqual(["KG24MB"]);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    limits.lookup = { success: false };
    const res = await call("KG24MB");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    // The limiter must short-circuit before any query runs.
    expect(fake.queries).toHaveLength(0);
  });

  it("never leaks customer details for a real order", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => [
        { status: "confirmed", note: "Payment confirmed", created_at: new Date() },
      ]);

    const res = await call("KG24MB");
    expect(res.status).toBe(200);

    const body = await res.text();
    for (const secret of ["Sunita", "9800000000", "Jhamsikhel", "A5 ruled", "185000"]) {
      expect(body, `leaked ${secret}`).not.toContain(secret);
    }

    const json = JSON.parse(body);
    expect(json.order_id).toBe("KG24MB");
    expect(json.status).toBe("shipped");
    expect(json.events).toHaveLength(1);
  });

  it("forbids caching so a stale status is never served", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [])
      .when(/from order_events/i, () => []);
    const res = await call("KG24MB");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("counts the lookup against the address the proxy vouched for", async () => {
    // This used to assert only that the call returned 404, which is true of
    // every possible clientIp implementation and so tested nothing. What
    // matters is which value the limiter counts against: the leftmost hop is
    // supplied by the caller, so keying on it would let anyone enumerate
    // order IDs at whatever rate they liked.
    await call("KG24MB", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(limits.keys.at(-1)).toBe("10.0.0.1");
  });

  it("gives a caller who varies x-forwarded-for the same bucket every time", async () => {
    for (const forged of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      await call("KG24MB", { "x-forwarded-for": `${forged}, 10.0.0.1` });
    }
    expect(new Set(limits.keys)).toEqual(new Set(["10.0.0.1"]));
  });

  it("rate limits before it looks anything up", async () => {
    limits.lookup = { success: false };
    const res = await call("KG24MB");
    expect(res.status).toBe(429);
    expect(fake.queries).toHaveLength(0);
  });
});
