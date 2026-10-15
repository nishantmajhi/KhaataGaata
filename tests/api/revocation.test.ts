import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Deactivating a staff account has to end that person's access, not just stop
 * them signing in again. The session is a self-contained JWT with a twelve
 * hour life, so nothing in the token itself can express "this account was
 * switched off eleven hours ago" — somebody has to ask the database.
 *
 * These tests drive the two places that decide: the middleware, which gates
 * every read under /admin, and requireStaff(), which gates every write.
 */

const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

const state = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  redirects: [] as string[],
  revalidated: [] as string[],
  headers: new Headers(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => state.cookies.set(name, { value }),
    delete: (name: string) => state.cookies.delete(name),
    get: (name: string) => state.cookies.get(name),
  }),
  headers: async () => state.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    state.redirects.push(url);
    const err = new Error("NEXT_REDIRECT");
    (err as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => state.revalidated.push(path),
}));

const { NextRequest } = await import("next/server");
const { middleware } = await import("@/middleware");
const actions = await import("@/app/admin/actions");
const { SESSION_COOKIE, createSessionToken } = await import("@/lib/auth");

const ME = { staffId: 3, username: "sunita", displayName: "Sunita Shrestha" };

/** Routes the account-status lookup to a row with the given is_active value. */
function staffIs(active: boolean) {
  fake.when(/from staff where id = \$1/i, () => [{ id: ME.staffId, is_active: active }]);
}

/** Routes it to no row at all, as if the account had been deleted outright. */
function staffMissing() {
  fake.when(/from staff where id = \$1/i, () => []);
}

async function adminRequest(path: string) {
  const req = new NextRequest(new URL(`https://shop.example${path}`));
  req.cookies.set(SESSION_COOKIE, await createSessionToken(ME));
  return req;
}

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

beforeEach(async () => {
  fake.reset();
  state.cookies.clear();
  state.redirects.length = 0;
  state.revalidated.length = 0;
  state.cookies.set(SESSION_COOKIE, { value: await createSessionToken(ME) });
});

describe("a deactivated account loses its live session", () => {
  it("the middleware sends a deactivated staff member back to the login page", async () => {
    staffIs(false);
    const res = await middleware(await adminRequest("/admin"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("the middleware still lets an active staff member through", async () => {
    staffIs(true);
    const res = await middleware(await adminRequest("/admin"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("an account deleted outright is refused too", async () => {
    staffMissing();
    const res = await middleware(await adminRequest("/admin/orders/ABCD23"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("refuses to create an order for a deactivated staff member", async () => {
    staffIs(false);
    const result = await actions.addOrder(
      {},
      form([
        ["customerName", "Rita Gurung"],
        ["itemTitle", "Wool shawl"],
        ["itemQty", "1"],
        ["itemPrice", "1200"],
      ])
    );
    expect(result.error).toMatch(/sign in|signed out|no longer/i);
    // Nothing may reach the ledger: no order row, no audit entry.
    expect(fake.find(/insert into orders/i)).toBeUndefined();
    expect(fake.find(/insert into order_audit/i)).toBeUndefined();
  });

  it("refuses to move an order along for a deactivated staff member", async () => {
    staffIs(false);
    const result = await actions.updateStatus(
      {},
      form([
        ["orderId", "ABCD23"],
        ["status", "shipped"],
      ])
    );
    expect(result.error).toMatch(/sign in|signed out|no longer/i);
    expect(fake.find(/update orders set status/i)).toBeUndefined();
  });

  it("refuses to let a deactivated staff member reactivate themselves", async () => {
    // The worst version of this bug: the person switched off at 09:00 uses
    // the session still in their browser to switch themselves back on.
    staffIs(false);
    const result = await actions.toggleStaff(
      {},
      form([
        ["staffId", String(ME.staffId)],
        ["activate", "true"],
      ])
    );
    expect(result.error).toMatch(/sign in|signed out|no longer/i);
    expect(fake.find(/update staff set is_active/i)).toBeUndefined();
  });

  it("refuses to let a deactivated staff member change their password", async () => {
    staffIs(false);
    const result = await actions.changeOwnPassword(
      {},
      form([
        ["currentPassword", "whatever-it-was"],
        ["newPassword", "a-brand-new-password"],
      ])
    );
    expect(result.error).toMatch(/sign in|signed out|no longer/i);
    expect(fake.find(/update staff set password_hash/i)).toBeUndefined();
  });

  it("an active staff member is still allowed to write", async () => {
    staffIs(true);
    fake.when(/insert into orders/i, () => [{ id: 41 }]);
    await expect(
      actions.addOrder(
        {},
        form([
          ["customerName", "Rita Gurung"],
          ["itemTitle", "Wool shawl"],
          ["itemQty", "1"],
          ["itemPrice", "1200"],
        ])
      )
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(fake.find(/insert into orders/i)).toBeDefined();
  });
});
