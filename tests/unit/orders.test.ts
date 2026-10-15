import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above every const, so the fake must be built inside
// vi.hoisted or it will not exist yet when the mock factory runs.
const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

const {
  getOrderByPublicId,
  toPublicOrder,
  listOrdersPage,
  countByStatus,
  createOrder,
  updateOrder,
  advanceOrder,
  closeOrder,
  reopenOrder,
  describeChanges,
  totalOf,
  getAuditTrail,
  formatNpr,
} = await import("@/lib/orders");

const ACTOR = "Sunita Shrestha";
const ACTOR_ID = 3;
/** The two fields every write takes: the name to print, the id to trust. */
const BY = { actorName: ACTOR, actorStaffId: ACTOR_ID };

const ORDER_ROW = {
  id: 7,
  cancelled_reason: null,
  order_id: "KG24MB",
  customer_name: "Sunita Shrestha",
  customer_phone: "+977 98XXXXXXXX",
  address: "Jhamsikhel, Lalitpur",
  status: "shipped",
  total_paisa: "185000",
  created_at: new Date("2026-08-10T07:44:00Z"),
  updated_at: new Date("2026-08-13T01:44:00Z"),
};

beforeEach(() => fake.reset());

describe("getOrderByPublicId", () => {
  it("returns null when no row matches", async () => {
    expect(await getOrderByPublicId("NOPE99")).toBeNull();
  });

  it("passes the order ID as a bound parameter, never inlined", async () => {
    await getOrderByPublicId("KG24MB");
    const q = fake.find(/from orders/i);
    expect(q?.text).toContain("$1");
    expect(q?.text).not.toContain("KG24MB");
    expect(q?.params).toEqual(["KG24MB"]);
  });

  it("normalises Date columns to ISO strings", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => [
        { status: "confirmed", note: null, created_at: new Date("2026-08-10T07:44:00Z") },
      ]);

    const order = await getOrderByPublicId("KG24MB");
    expect(order?.created_at).toBe("2026-08-10T07:44:00.000Z");
    expect(order?.events[0].created_at).toBe("2026-08-10T07:44:00.000Z");
    expect(typeof order?.updated_at).toBe("string");
  });

  it("coerces bigint-as-string columns into numbers", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => []);

    const order = await getOrderByPublicId("KG24MB");
    // Postgres returns bigint as a string. Left alone, qty * price would
    // concatenate instead of multiply.
    expect(order?.total_paisa).toBe(185000);
    expect(order?.items[0].qty).toBe(2);
    expect(order?.items[0].unit_price_paisa).toBe(65000);
    expect(order!.items[0].qty * order!.items[0].unit_price_paisa).toBe(130000);
  });

  it("orders events oldest first so the timeline reads downward", async () => {
    fake.when(/from orders/i, () => [ORDER_ROW]);
    await getOrderByPublicId("KG24MB");
    expect(fake.find(/from order_events/i)?.text).toMatch(/order by created_at asc/i);
  });
});

describe("toPublicOrder", () => {
  it("strips every piece of personal data", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => []);

    const order = await getOrderByPublicId("KG24MB");
    const publicOrder = toPublicOrder(order!);

    // Order IDs are short and therefore guessable, so the public shape must
    // not leak anything that identifies the customer.
    expect(Object.keys(publicOrder).sort()).toEqual([
      "created_at",
      "events",
      "order_id",
      "status",
      "updated_at",
    ]);

    const serialized = JSON.stringify(publicOrder);
    expect(serialized).not.toContain("Sunita");
    expect(serialized).not.toContain("977");
    expect(serialized).not.toContain("Jhamsikhel");
    // Items reveal what was bought and what it cost — also withheld.
    expect(serialized).not.toContain("A5 ruled");
    expect(serialized).not.toContain("185000");
  });
});

describe("createOrder", () => {
  const input = {
    customerName: "Bikash Rai",
    customerPhone: "+977 9800000000",
    address: "Patan",
    note: null,
    items: [
      { title: "A5 ruled", qty: 2, unitPricePaisa: 65000 },
      { title: "A6 plain", qty: 1, unitPricePaisa: 55000 },
    ],
    ...BY,
  };

  it("computes the total from the line items", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder(input);
    const insert = fake.find(/insert into orders/i);
    // 2 × 65000 + 1 × 55000
    expect(insert?.params).toContain(185000);
  });

  it("writes one row per item and a first timeline event", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder(input);
    expect(fake.all(/insert into order_items/i)).toHaveLength(2);
    const events = fake.all(/insert into order_events/i);
    expect(events).toHaveLength(1);
    // 'confirmed' is a literal in the statement, not a bound parameter.
    expect(events[0].text).toMatch(/'confirmed'/);
  });

  it("defaults the first timeline note when none is given", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder({ ...input, note: null });
    expect(fake.find(/insert into order_events/i)?.params).toContain(
      "Payment confirmed, order recorded."
    );
  });

  it("uses the staff-supplied note when one is given", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder({ ...input, note: "Paid by eSewa" });
    expect(fake.find(/insert into order_events/i)?.params).toContain("Paid by eSewa");
  });

  it("returns a valid, freshly generated order ID", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    const id = await createOrder(input);
    expect(id).toMatch(/^[A-Z0-9]{4,8}$/);
    expect(fake.find(/insert into orders/i)?.params).toContain(id);
  });

  it("retries with a new ID when the unique constraint trips", async () => {
    let attempts = 0;
    fake.when(/insert into orders/i, () => {
      attempts += 1;
      if (attempts < 3) throw new Error('duplicate key value violates "orders_order_id_key"');
      return [{ id: 11 }];
    });

    const id = await createOrder(input);
    expect(attempts).toBe(3);
    expect(id).toMatch(/^[A-Z0-9]{4,8}$/);
  });

  it("gives up after five collisions rather than looping forever", async () => {
    fake.when(/insert into orders/i, () => {
      throw new Error('duplicate key value violates "orders_order_id_key"');
    });
    await expect(createOrder(input)).rejects.toThrow(/allocate an order ID/i);
  });

  it("does not swallow unrelated database errors", async () => {
    fake.when(/insert into orders/i, () => {
      throw new Error("connection terminated unexpectedly");
    });
    await expect(createOrder(input)).rejects.toThrow(/connection terminated/i);
  });

  it("binds customer data as parameters, never as SQL text", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder({
      ...input,
      customerName: "Robert'); DROP TABLE orders; --",
    });
    const insert = fake.find(/insert into orders/i);
    expect(insert?.text).not.toMatch(/DROP TABLE/i);
    expect(insert?.params).toContain("Robert'); DROP TABLE orders; --");
  });

  it("stores an empty phone or address as null, not an empty string", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder({ ...input, customerPhone: "", address: "" });
    const params = fake.find(/insert into orders/i)!.params;
    expect(params).toContain(null);
  });

  it("totals to zero for free items without producing NaN", async () => {
    fake.when(/insert into orders/i, () => [{ id: 11 }]);
    await createOrder({ ...input, items: [{ title: "Sample", qty: 1, unitPricePaisa: 0 }] });
    expect(fake.find(/insert into orders/i)?.params).toContain(0);
  });
});

describe("advanceOrder", () => {
  it("reports false when the order does not exist", async () => {
    expect(await advanceOrder("NOPE99", "shipped", { ...BY })).toBe(false);
  });

  it("does not append an event when the update matched nothing", async () => {
    await advanceOrder("NOPE99", "shipped", { ...BY });
    expect(fake.all(/insert into order_events/i)).toHaveLength(0);
  });

  it("updates the row and appends an event on success", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    expect(
      await advanceOrder("KG24MB", "delivered", {
        note: "Left with the neighbour",
        ...BY,
      })
    ).toBe(true);

    expect(fake.find(/update orders/i)?.text).toMatch(/updated_at = now\(\)/i);
    const event = fake.find(/insert into order_events/i);
    expect(event?.params).toContain("delivered");
    expect(event?.params).toContain("Left with the neighbour");
  });

  it("records who moved the order", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", { ...BY });
    expect(fake.find(/insert into order_events/i)?.params).toContain(ACTOR);
    expect(fake.find(/insert into order_audit/i)?.params).toContain(ACTOR);
  });

  it("notes in the audit trail when the move was a correction", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "processing", { ...BY, backwards: true });
    const audit = fake.find(/insert into order_audit/i);
    expect(audit?.params.some((p) => String(p).includes("Moved back to"))).toBe(true);
  });

  it("clears a stale cancellation reason when put back on track", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", { ...BY });
    expect(fake.find(/update orders/i)?.text).toMatch(/cancelled_reason = null/i);
  });

  it("stores a blank or whitespace note as null", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", { ...BY, note: "   " });
    expect(fake.find(/insert into order_events/i)?.params).toContain(null);
  });

  it("never rewrites history — events are only ever inserted", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", { ...BY });
    expect(fake.all(/update order_events/i)).toHaveLength(0);
    expect(fake.all(/delete from order_events/i)).toHaveLength(0);
  });
});

describe("listOrdersPage and countByStatus", () => {
  it("shows the most recently moved order first", async () => {
    await listOrdersPage();
    expect(fake.find(/order by updated_at desc/i)).toBeTruthy();
  });

  it("normalises rows the same way the detail query does", async () => {
    fake.when(/order by updated_at desc/i, () => [
      {
        order_id: "KG24MB",
        customer_name: "Sunita",
        customer_phone: null,
        status: "shipped",
        total_paisa: "185000",
        created_at: new Date("2026-08-10T07:44:00Z"),
        updated_at: new Date("2026-08-13T01:44:00Z"),
      },
    ]);
    const page = await listOrdersPage();
    expect(page.orders[0].total_paisa).toBe(185000);
    expect(page.orders[0].created_at).toBe("2026-08-10T07:44:00.000Z");
  });

  it("returns a keyed tally", async () => {
    fake.when(/group by status/i, () => [
      { status: "shipped", n: 3 },
      { status: "delivered", n: 12 },
    ]);
    expect(await countByStatus()).toEqual({ shipped: 3, delivered: 12 });
  });

  it("returns an empty tally for an empty database", async () => {
    expect(await countByStatus()).toEqual({});
  });
});

describe("formatNpr", () => {
  it("converts paisa to rupees", () => {
    expect(formatNpr(185000)).toBe("Rs 1,850");
    expect(formatNpr(0)).toBe("Rs 0");
    expect(formatNpr(50)).toBe("Rs 0.5");
  });

  it("groups large amounts", () => {
    expect(formatNpr(1234567800)).toMatch(/^Rs [\d,]+$/);
  });
});

describe("ledger search and pagination", () => {
  it("returns everything when no filters are given", async () => {
    await listOrdersPage();
    const q = fake.find(/order by updated_at desc/i)!;
    // The null-guarded predicates mean an unfiltered query binds nulls
    // rather than building a different statement.
    expect(q.params).toContain(null);
  });

  it("matches on name, order ID or phone with one term", async () => {
    await listOrdersPage({ search: "Sunita" });
    const q = fake.find(/order by updated_at desc/i)!;
    expect(q.text).toMatch(/lower\(customer_name\) like/i);
    expect(q.text).toMatch(/lower\(order_id\) like/i);
    expect(q.text).toMatch(/customer_phone/i);
    expect(q.params).toContain("%sunita%");
  });

  it("lower-cases the search term to match the index", async () => {
    // The index is on lower(customer_name); an upper-case pattern would
    // silently never match it.
    await listOrdersPage({ search: "SUNITA" });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain("%sunita%");
  });

  it("escapes LIKE wildcards so a literal % is searchable", async () => {
    await listOrdersPage({ search: "100%" });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain("%100\\%%");
  });

  it("escapes an underscore, which would otherwise match any character", async () => {
    await listOrdersPage({ search: "a_b" });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain("%a\\_b%");
  });

  it("treats a blank or whitespace search as no search", async () => {
    await listOrdersPage({ search: "   " });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain(null);
  });

  it("filters by status when one is chosen", async () => {
    await listOrdersPage({ status: "cancelled" });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain("cancelled");
  });

  it("treats 'all' as no status filter", async () => {
    await listOrdersPage({ status: "all" });
    const params = fake.find(/order by updated_at desc/i)!.params;
    expect(params).not.toContain("all");
  });

  it("offsets by page", async () => {
    await listOrdersPage({ page: 3, perPage: 25 });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain(50);
  });

  it("clamps a hostile page size rather than fetching everything", async () => {
    await listOrdersPage({ perPage: 100000 });
    expect(fake.find(/order by updated_at desc/i)!.params).toContain(100);
  });

  it("clamps nonsense page numbers to the first page", async () => {
    for (const page of [0, -5, 0.5]) {
      fake.reset();
      const result = await listOrdersPage({ page });
      expect(result.page, String(page)).toBe(1);
      expect(fake.find(/order by updated_at desc/i)!.params).toContain(0);
    }
  });

  it("reports the page count from the total", async () => {
    fake.when(/count\(\*\)/i, () => [{ n: 51 }]);
    const page = await listOrdersPage({ perPage: 25 });
    expect(page.total).toBe(51);
    expect(page.pageCount).toBe(3);
  });

  it("never reports fewer than one page, even when empty", async () => {
    const page = await listOrdersPage();
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(1);
  });

  it("counts with the same filters as the listing", async () => {
    await listOrdersPage({ search: "rai", status: "shipped" });
    const count = fake.find(/count\(\*\)/i)!;
    expect(count.params).toContain("%rai%");
    expect(count.params).toContain("shipped");
  });
});

describe("updateOrder", () => {
  const base = {
    orderId: "KG24MB",
    customerName: "Sunita Shrestha",
    customerPhone: "+977 9800000000",
    address: "Jhamsikhel, Lalitpur",
    items: [{ title: "A5 ruled", qty: 2, unitPricePaisa: 65000 }],
    ...BY,
  };

  function seedExisting() {
    fake
      .when(/from orders/i, () => [
        { ...ORDER_ROW, customer_phone: "+977 9800000000" },
      ])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => []);
  }

  it("refuses an order that does not exist", async () => {
    const result = await updateOrder(base);
    expect(result).toEqual({ ok: false, error: "No order with that ID." });
  });

  it("writes nothing when nothing actually changed", async () => {
    seedExisting();
    const result = await updateOrder(base);
    expect(result).toEqual({ ok: true, changes: [] });
    expect(fake.all(/update orders/i)).toHaveLength(0);
    expect(fake.all(/insert into order_audit/i)).toHaveLength(0);
  });

  it("updates the address and says so in the audit trail", async () => {
    seedExisting();
    const result = await updateOrder({ ...base, address: "Baneshwor, Kathmandu" });
    expect(result).toEqual({ ok: true, changes: ["address"] });
    expect(fake.find(/update orders/i)?.params).toContain("Baneshwor, Kathmandu");
    const audit = fake.find(/insert into order_audit/i)!;
    expect(audit.params).toContain("Changed address");
    expect(audit.params).toContain(ACTOR);
  });

  it("leaves the items alone when only the address changed", async () => {
    seedExisting();
    await updateOrder({ ...base, address: "Elsewhere" });
    // Replacing rows that did not change would churn IDs for nothing.
    expect(fake.all(/delete from order_items/i)).toHaveLength(0);
  });

  it("replaces the item rows when the items changed", async () => {
    seedExisting();
    await updateOrder({
      ...base,
      items: [
        { title: "A5 ruled", qty: 3, unitPricePaisa: 65000 },
        { title: "A6 plain", qty: 1, unitPricePaisa: 55000 },
      ],
    });
    expect(fake.all(/delete from order_items/i)).toHaveLength(1);
    expect(fake.all(/insert into order_items/i)).toHaveLength(2);
  });

  it("recomputes the total from the new items", async () => {
    seedExisting();
    await updateOrder({
      ...base,
      items: [{ title: "A5 ruled", qty: 3, unitPricePaisa: 65000 }],
    });
    expect(fake.find(/update orders/i)?.params).toContain(195000);
  });

  it("does not touch the delivery status", async () => {
    seedExisting();
    await updateOrder({ ...base, customerName: "Sunita S." });
    expect(fake.find(/update orders/i)?.text).not.toMatch(/\bset[\s\S]*status =/i);
    expect(fake.all(/insert into order_events/i)).toHaveLength(0);
  });

  it("lists several changed fields in one audit entry", async () => {
    seedExisting();
    const result = await updateOrder({
      ...base,
      customerName: "Sunita S.",
      address: "Elsewhere",
      items: [{ title: "B5 dotted", qty: 1, unitPricePaisa: 72000 }],
    });
    expect(result).toEqual({ ok: true, changes: ["name", "address", "items"] });
  });
});

describe("describeChanges", () => {
  const before = {
    customer_name: "Sunita",
    customer_phone: "+977 98",
    address: "Patan",
    items: [{ title: "A5", qty: 2, unit_price_paisa: 65000 }],
  } as never;

  const after = {
    customerName: "Sunita",
    customerPhone: "+977 98",
    address: "Patan",
    items: [{ title: "A5", qty: 2, unitPricePaisa: 65000 }],
  } as never;

  it("finds nothing when nothing moved", () => {
    expect(describeChanges(before, after)).toEqual([]);
  });

  it("treats null and empty string as the same absent value", () => {
    // The form submits "" for a cleared field; the database holds null.
    // Without this, opening and saving a form would log a phantom edit.
    const b = { ...(before as object), customer_phone: null } as never;
    const a = { ...(after as object), customerPhone: null } as never;
    expect(describeChanges(b, a)).toEqual([]);
  });

  it("spots a quantity change inside an otherwise identical item", () => {
    const a = {
      ...(after as object),
      items: [{ title: "A5", qty: 3, unitPricePaisa: 65000 }],
    } as never;
    expect(describeChanges(before, a)).toEqual(["items"]);
  });

  it("spots an added item", () => {
    const a = {
      ...(after as object),
      items: [
        { title: "A5", qty: 2, unitPricePaisa: 65000 },
        { title: "A6", qty: 1, unitPricePaisa: 55000 },
      ],
    } as never;
    expect(describeChanges(before, a)).toEqual(["items"]);
  });
});

describe("closeOrder", () => {
  it("reports false for an order that does not exist", async () => {
    expect(
      await closeOrder("NOPE99", "cancelled", { ...BY, reason: "x" })
    ).toBe(false);
  });

  it("stores the reason on the order and on the timeline", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await closeOrder("KG24MB", "cancelled", {
      reason: "Customer changed their mind",
      ...BY,
    });
    expect(fake.find(/update orders/i)?.params).toContain("Customer changed their mind");
    // The customer sees the reason, so it goes on the event too.
    expect(fake.find(/insert into order_events/i)?.params).toContain(
      "Customer changed their mind"
    );
  });

  it("records the outcome as the audit action", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await closeOrder("KG24MB", "refunded", { ...BY, reason: "Damaged" });
    const audit = fake.find(/insert into order_audit/i)!;
    expect(audit.params).toContain("refunded");
    expect(audit.params).toContain(ACTOR);
  });

  it("leaves the earlier events intact so the history survives", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await closeOrder("KG24MB", "cancelled", { ...BY, reason: "x" });
    expect(fake.all(/delete from order_events/i)).toHaveLength(0);
  });
});

describe("reopenOrder", () => {
  it("refuses to reopen into a non-progress status", async () => {
    expect(
      await reopenOrder("KG24MB", "cancelled" as never, { ...BY })
    ).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("clears the cancellation reason", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await reopenOrder("KG24MB", "processing", { ...BY });
    expect(fake.find(/update orders/i)?.text).toMatch(/cancelled_reason = null/i);
  });

  it("adds a default note when staff give none", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await reopenOrder("KG24MB", "processing", { ...BY });
    expect(fake.find(/insert into order_events/i)?.params).toContain("Order reopened.");
  });

  it("logs a reopened action", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    await reopenOrder("KG24MB", "shipped", { ...BY });
    // 'reopened' is a literal in the statement, not a bound parameter.
    expect(fake.find(/insert into order_audit/i)?.text).toMatch(/'reopened'/);
    expect(fake.find(/insert into order_audit/i)?.params).toContain(ACTOR);
  });
});

describe("audit trail", () => {
  it("shows the most recent entry first", async () => {
    await getAuditTrail(7);
    expect(fake.find(/from order_audit/i)?.text).toMatch(/order by created_at desc/i);
  });

  it("normalises its timestamps", async () => {
    fake.when(/from order_audit/i, () => [
      {
        actor_name: "Sunita",
        action: "edited",
        summary: "Changed address",
        created_at: new Date("2026-08-13T01:44:00Z"),
      },
    ]);
    const [entry] = await getAuditTrail(7);
    expect(entry.created_at).toBe("2026-08-13T01:44:00.000Z");
  });
});

describe("totalOf", () => {
  it("multiplies and sums in integer paisa", () => {
    expect(
      totalOf([
        { title: "a", qty: 2, unitPricePaisa: 65000 },
        { title: "b", qty: 1, unitPricePaisa: 55000 },
      ])
    ).toBe(185000);
  });

  it("is zero for no items", () => {
    expect(totalOf([])).toBe(0);
  });
});

describe("attribution", () => {
  // A display name is what the pages print; it is not what identifies a
  // person. Nothing makes display names unique, so before actor_staff_id
  // existed two people with the same name left entries nobody could tell
  // apart afterwards. Every write has to record both.
  const NAMESAKE = { actorName: ACTOR, actorStaffId: 11 };

  function actorColumns(pattern: RegExp) {
    const q = fake.find(pattern)!;
    return { text: q.text, params: q.params };
  }

  it("records the staff id as well as the name when an order is created", async () => {
    fake.when(/insert into orders/i, () => [{ id: 7 }]);
    await createOrder({
      customerName: "Bikash Rai",
      items: [{ title: "A5 ruled", qty: 1, unitPricePaisa: 65000 }],
      ...NAMESAKE,
    });

    for (const table of [/insert into order_events/i, /insert into order_audit/i]) {
      const { text, params } = actorColumns(table);
      expect(text, String(table)).toContain("actor_staff_id");
      expect(params, String(table)).toContain(11);
    }
  });

  it("records it on a status move", async () => {
    fake.when(/update orders set status/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", NAMESAKE);

    expect(actorColumns(/insert into order_events/i).params).toContain(11);
    expect(actorColumns(/insert into order_audit/i).params).toContain(11);
  });

  it("records it when an order is closed", async () => {
    fake.when(/update orders set status/i, () => [{ id: 7 }]);
    await closeOrder("KG24MB", "cancelled", { ...NAMESAKE, reason: "Out of stock" });

    expect(actorColumns(/insert into order_events/i).params).toContain(11);
    expect(actorColumns(/insert into order_audit/i).params).toContain(11);
  });

  it("records it when an order is reopened", async () => {
    fake.when(/update orders set status/i, () => [{ id: 7 }]);
    await reopenOrder("KG24MB", "processing", NAMESAKE);

    expect(actorColumns(/insert into order_events/i).params).toContain(11);
    expect(actorColumns(/insert into order_audit/i).params).toContain(11);
  });

  it("records it on an edit", async () => {
    fake
      .when(/from orders/i, () => [ORDER_ROW])
      .when(/from order_items/i, () => [
        { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
      ])
      .when(/from order_events/i, () => []);

    await updateOrder({
      orderId: "KG24MB",
      customerName: "Sunita Shrestha",
      customerPhone: null,
      address: "Somewhere new",
      items: [{ title: "A5 ruled", qty: 2, unitPricePaisa: 65000 }],
      ...NAMESAKE,
    });

    expect(actorColumns(/insert into order_audit/i).params).toContain(11);
  });

  it("tells two people with the same display name apart", async () => {
    // The whole point. Same name, different id, distinguishable rows.
    fake.when(/update orders set status/i, () => [{ id: 7 }]);
    await advanceOrder("KG24MB", "shipped", { actorName: ACTOR, actorStaffId: 11 });
    await advanceOrder("KG24MB", "delivered", { actorName: ACTOR, actorStaffId: 12 });

    const ids = fake
      .all(/insert into order_audit/i)
      .map((q) => q.params.find((p) => p === 11 || p === 12));
    expect(ids).toEqual([11, 12]);
  });
});
