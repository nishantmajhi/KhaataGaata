import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PROGRESS_STEPS, ALL_STEPS, STATUS_KEYS, ORDER_ID_RE } from "@/lib/status";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");

/**
 * The database enforces its own constraints, and they were written by hand.
 * These tests fail if the schema and the TypeScript drift apart — the kind of
 * mismatch that only shows up as a runtime insert error in production.
 */
describe("schema and code agree", () => {
  it("allows exactly the statuses the app knows about", () => {
    const match = schema.match(/orders_status_check[\s\S]*?in \(([^)]+)\)/);
    expect(match, "orders_status_check not found").toBeTruthy();

    const allowed = match![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();

    expect(allowed).toEqual([...STATUS_KEYS].sort());
  });

  it("applies the same status constraint to the events table", () => {
    const match = schema.match(/order_events_status_check[\s\S]*?in \(([^)]+)\)/);
    expect(match).toBeTruthy();
    const allowed = match![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(allowed).toEqual([...STATUS_KEYS].sort());
  });

  it("enforces the same order ID shape as the TypeScript validator", () => {
    expect(schema).toMatch(/orders_order_id_format[\s\S]*?\^\[A-Z0-9\]\{4,8\}\$/);
    expect(ORDER_ID_RE.source).toBe("^[A-Z0-9]{4,8}$");
  });

  it("keeps order IDs unique so the retry loop has something to catch", () => {
    expect(schema).toMatch(/order_id\s+text not null unique/);
  });

  it("cascades deletes so no orphan items, events or audit rows survive", () => {
    const cascades = schema.match(/on delete cascade/g) ?? [];
    expect(cascades).toHaveLength(3);
  });

  it("allows the exception statuses the app can now set", () => {
    expect(schema).toMatch(/'cancelled'/);
    expect(schema).toMatch(/'refunded'/);
  });

  it("records who moved an order", () => {
    expect(schema).toMatch(/alter table order_events add column if not exists actor_name/);
  });

  it("keeps the audit actions in step with what the code writes", () => {
    const match = schema.match(/order_audit_action_check[\s\S]*?in \(([^)]+)\)/);
    expect(match).toBeTruthy();
    const allowed = match![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort();
    expect(allowed).toEqual(
      ["cancelled", "created", "edited", "refunded", "reopened", "status_changed"]
    );
  });

  it("constrains staff usernames the same way the TypeScript does", () => {
    expect(schema).toMatch(/staff_username_format[\s\S]*?\^\[a-z0-9_\.-\]\{3,32\}\$/);
  });

  it("indexes what the ledger search actually filters on", () => {
    // lower(customer_name) must match the query in listOrdersPage, or the
    // index is never used and search degrades to a full scan.
    expect(schema).toMatch(/on orders\(lower\(customer_name\)\)/);
    expect(schema).toMatch(/on orders\(status\)/);
    expect(schema).toMatch(/on orders\(updated_at desc\)/);
  });

  it("is safe to re-run over an existing database", () => {
    // Constraints are dropped before being re-added, because Postgres has no
    // "add constraint if not exists". Comments are stripped first, or the
    // comment explaining that rule matches the scan itself.
    const sqlOnly = schema
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    const adds = sqlOnly.match(/add constraint (\w+)/g) ?? [];
    for (const add of adds) {
      const name = add.replace("add constraint ", "");
      expect(sqlOnly, name).toMatch(new RegExp(`drop constraint if exists ${name}`));
    }
    expect(adds.length).toBeGreaterThan(0);
  });

  it("rejects a non-positive quantity at the database level", () => {
    expect(schema).toMatch(/qty\s+integer not null default 1 check \(qty > 0\)/);
  });

  it("stores money as bigint, never as a floating point type", () => {
    expect(schema).toMatch(/total_paisa\s+bigint/);
    expect(schema).toMatch(/unit_price_paisa\s+bigint/);
    expect(schema).not.toMatch(/\b(float|real|double precision|money)\b/i);
  });

  it("uses timestamptz everywhere so no timestamp is ambiguous", () => {
    const timestamps = schema.match(/timestamp\w*/g) ?? [];
    expect(timestamps.length).toBeGreaterThan(0);
    for (const t of timestamps) expect(t).toBe("timestamptz");
  });

  it("is re-runnable, so db:push is safe to repeat", () => {
    const creates = schema.match(/create (table|index)/g) ?? [];
    const guarded = schema.match(/create (table|index) if not exists/g) ?? [];
    expect(guarded.length).toBe(creates.length);
  });

  it("indexes the columns the app actually filters and sorts on", () => {
    expect(schema).toMatch(/on order_items\(order_id\)/);
    expect(schema).toMatch(/on order_events\(order_id, created_at\)/);
    expect(schema).toMatch(/on orders\(created_at desc\)/);
  });
});

describe("status list assumptions", () => {
  it("starts at confirmed, because that is what createOrder writes", () => {
    expect(PROGRESS_STEPS[0].key).toBe("confirmed");
    expect(schema).toMatch(/status\s+text not null default 'confirmed'/);
  });

  it("ends at delivered, which is what stops the client polling", () => {
    expect(PROGRESS_STEPS.at(-1)!.key).toBe("delivered");
    expect(ALL_STEPS.length).toBe(7);
  });
});
