import { describe, it, expect, beforeEach, vi } from "vitest";

const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

const state = vi.hoisted(() => ({
  login: { success: true },
  adminWrite: { success: true },
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
    // Next's redirect throws to unwind the action; mimic that so code after
    // the call does not run in tests either.
    const err = new Error("NEXT_REDIRECT");
    (err as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => state.revalidated.push(path),
}));

vi.mock("@/lib/ratelimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratelimit")>();
  return {
    ...actual,
    limitLogin: async () => state.login,
    limitAdminWrite: async () => state.adminWrite,
  };
});

const actions = await import("@/app/admin/actions");
const {
  signIn,
  signOut,
  addOrder,
  editOrder,
  updateStatus,
  closeOrderAction,
  createFirstStaff,
  addStaff,
  toggleStaff,
  changeOwnPassword,
} = actions;

const { SESSION_COOKIE, createSessionToken, readSessionToken } = await import("@/lib/auth");
const { hashPassword } = await import("@/lib/password");

const ME = { staffId: 3, username: "sunita", displayName: "Sunita Shrestha" };

/** Puts a valid staff session in the cookie jar. */
async function signedIn() {
  state.cookies.set(SESSION_COOKIE, { value: await createSessionToken(ME) });
}

async function expectRedirect(fn: () => Promise<unknown>) {
  await expect(fn()).rejects.toThrow(/NEXT_REDIRECT/);
  return state.redirects.at(-1)!;
}

/** Re-arms the fake, keeping the default "this account is still active" route. */
function resetSql() {
  fake.reset();
  fake.when(/from staff where id = \$1/i, () => [{ is_active: true }]);
}

/**
 * Every statement except the account-status check requireStaff() runs. That
 * check is not work the action asked for — it is the guard deciding whether
 * the action runs at all — so "the action stopped before touching anything"
 * means "nothing but this was issued".
 */
const workQueries = () =>
  fake.queries.filter((q) => !/from staff where id = \$1/i.test(q.text));

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

const ORDER_ROW = {
  id: 7,
  order_id: "KG24MB",
  customer_name: "Sunita Shrestha",
  customer_phone: null,
  address: null,
  status: "shipped",
  total_paisa: "185000",
  cancelled_reason: null,
  created_at: new Date("2026-08-10T07:44:00Z"),
  updated_at: new Date("2026-08-13T01:44:00Z"),
};

function seedOrder(over: Partial<typeof ORDER_ROW> = {}) {
  fake
    .when(/from orders/i, () => [{ ...ORDER_ROW, ...over }])
    .when(/from order_items/i, () => [
      { title: "A5 ruled", qty: "2", unit_price_paisa: "65000" },
    ])
    .when(/from order_events/i, () => []);
}

beforeEach(() => {
  fake.reset();
  // requireStaff() re-checks the account behind the session on every write,
  // so the default here is "still employed". revocation.test.ts covers the
  // other answer.
  fake.when(/from staff where id = \$1/i, () => [{ is_active: true }]);
  state.login = { success: true };
  state.adminWrite = { success: true };
  state.cookies.clear();
  state.redirects.length = 0;
  state.revalidated.length = 0;
  vi.stubEnv("ADMIN_PASSWORD", "setup-key-value");
});

// Authentication --------------------------------------------------------------

describe("signIn", () => {
  it("rejects an unknown username without revealing that it is unknown", async () => {
    const result = await signIn({}, form([["username", "ghost"], ["password", "whatever"]]));
    expect(result.error).toMatch(/username and password don't match/i);
    expect(state.cookies.size).toBe(0);
  });

  it("uses the same message for a wrong password", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("the-real-password"),
        is_active: true,
      },
    ]);
    const result = await signIn({}, form([["username", "sunita"], ["password", "wrong"]]));
    // Identical wording to the unknown-username case, so the form cannot be
    // used to enumerate which accounts exist.
    expect(result.error).toMatch(/username and password don't match/i);
  });

  it("refuses a deactivated account as if the password were wrong", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("the-real-password"),
        is_active: false,
      },
    ]);
    const result = await signIn(
      {},
      form([["username", "sunita"], ["password", "the-real-password"]])
    );
    expect(result.error).toMatch(/username and password don't match/i);
    expect(state.cookies.size).toBe(0);
  });

  it("refuses once the login limiter trips, before touching the database", async () => {
    state.login = { success: false };
    const result = await signIn({}, form([["username", "sunita"], ["password", "x"]]));
    expect(result.error).toMatch(/too many attempts/i);
    expect(fake.queries).toHaveLength(0);
  });

  it("issues a session carrying the staff identity", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("the-real-password"),
        is_active: true,
      },
    ]);
    await expectRedirect(() =>
      signIn({}, form([["username", "sunita"], ["password", "the-real-password"]]))
    );

    const cookie = state.cookies.get(SESSION_COOKIE)!;
    expect(await readSessionToken(cookie.value)).toMatchObject({
      staffId: 3,
      username: "sunita",
      displayName: "Sunita Shrestha",
    });
  });

  it("stamps the last sign-in time", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("pw-123456"),
        is_active: true,
      },
    ]);
    await expectRedirect(() =>
      signIn({}, form([["username", "sunita"], ["password", "pw-123456"]]))
    );
    expect(fake.find(/update staff set last_login_at/i)).toBeTruthy();
  });

  it("refuses to bounce the user to another site", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("pw-123456"),
        is_active: true,
      },
    ]);
    for (const hostile of ["https://evil.example", "//evil.example", "/etc/passwd"]) {
      const target = await expectRedirect(() =>
        signIn(
          {},
          form([["username", "sunita"], ["password", "pw-123456"], ["next", hostile]])
        )
      );
      expect(target, hostile).toBe("/admin");
    }
  });
});

describe("signOut", () => {
  it("clears the cookie and returns to the login page", async () => {
    await signedIn();
    const target = await expectRedirect(() => signOut());
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(target).toBe("/admin/login");
  });
});

describe("first-run setup", () => {
  const valid: [string, string][] = [
    ["setupKey", "setup-key-value"],
    ["displayName", "Sunita Shrestha"],
    ["username", "sunita"],
    ["password", "a-good-password"],
  ];

  it("refuses once any account exists", async () => {
    fake.when(/count\(\*\).*from staff/i, () => [{ n: 1 }]);
    const result = await createFirstStaff({}, form(valid));
    expect(result.error).toMatch(/already exist/i);
  });

  it("requires the setup key to match ADMIN_PASSWORD", async () => {
    fake.when(/count\(\*\).*from staff/i, () => [{ n: 0 }]);
    const result = await createFirstStaff(
      {},
      form([...valid.slice(1), ["setupKey", "wrong"]])
    );
    expect(result.error).toMatch(/setup key/i);
    expect(fake.all(/insert into staff/i)).toHaveLength(0);
  });

  it("creates the account and signs the person straight in", async () => {
    fake
      .when(/count\(\*\).*from staff/i, () => [{ n: 0 }])
      .when(/insert into staff/i, () => [{ id: 1 }]);

    const target = await expectRedirect(() => createFirstStaff({}, form(valid)));
    expect(target).toBe("/admin");
    expect(await readSessionToken(state.cookies.get(SESSION_COOKIE)!.value)).toMatchObject({
      username: "sunita",
      displayName: "Sunita Shrestha",
    });
  });

  it("never stores the password in the clear", async () => {
    fake
      .when(/count\(\*\).*from staff/i, () => [{ n: 0 }])
      .when(/insert into staff/i, () => [{ id: 1 }]);
    await expectRedirect(() => createFirstStaff({}, form(valid)));

    const insert = fake.find(/insert into staff/i)!;
    expect(insert.params).not.toContain("a-good-password");
    expect(insert.params.some((p) => String(p).startsWith("scrypt:"))).toBe(true);
  });

  it("rejects a bad username or a short password", async () => {
    fake.when(/count\(\*\).*from staff/i, () => [{ n: 0 }]);

    const badUser = await createFirstStaff(
      {},
      form([...valid.slice(0, 2), ["username", "no"], ["password", "a-good-password"]])
    );
    expect(badUser.error).toMatch(/usernames are/i);

    const badPass = await createFirstStaff(
      {},
      form([...valid.slice(0, 3), ["password", "short"]])
    );
    expect(badPass.error).toMatch(/8 characters/i);
  });
});

// Authorisation ---------------------------------------------------------------

describe("every write requires a session", () => {
  const cases: [string, () => Promise<{ error?: string }>][] = [
    ["addOrder", () => addOrder({}, form([["customerName", "X"]]))],
    ["editOrder", () => editOrder({}, form([["orderId", "KG24MB"]]))],
    ["updateStatus", () => updateStatus({}, form([["orderId", "KG24MB"]]))],
    ["closeOrderAction", () => closeOrderAction({}, form([["orderId", "KG24MB"]]))],
    ["addStaff", () => addStaff({}, form([["username", "x"]]))],
    ["toggleStaff", () => toggleStaff({}, form([["staffId", "1"]]))],
    ["changeOwnPassword", () => changeOwnPassword({}, form([["newPassword", "x"]]))],
  ];

  for (const [name, run] of cases) {
    it(`${name} refuses an anonymous caller`, async () => {
      const result = await run();
      expect(result.error).toMatch(/session expired/i);
      expect(fake.queries, name).toHaveLength(0);
    });
  }
});

describe("admin write rate limit", () => {
  it("stops a runaway client before it writes", async () => {
    await signedIn();
    state.adminWrite = { success: false };
    const result = await addOrder(
      {},
      form([["customerName", "X"], ["itemTitle", "Y"], ["itemQty", "1"], ["itemPrice", "1"]])
    );
    expect(result.error).toMatch(/changes at once/i);
    expect(workQueries()).toHaveLength(0);
  });

  it("applies to edits and status moves too", async () => {
    await signedIn();
    state.adminWrite = { success: false };
    expect((await editOrder({}, form([["orderId", "KG24MB"]]))).error).toMatch(
      /changes at once/i
    );
    expect((await updateStatus({}, form([["orderId", "KG24MB"]]))).error).toMatch(
      /changes at once/i
    );
  });
});

// Orders ----------------------------------------------------------------------

describe("addOrder", () => {
  const valid: [string, string][] = [
    ["customerName", "Bikash Rai"],
    ["itemTitle", "A5 ruled"],
    ["itemQty", "2"],
    ["itemPrice", "650"],
  ];

  beforeEach(signedIn);

  it("requires a customer name", async () => {
    const result = await addOrder({}, form([["itemTitle", "A5"], ["itemQty", "1"]]));
    expect(result.error).toMatch(/customer's name/i);
  });

  it("requires at least one item with a title", async () => {
    const result = await addOrder(
      {},
      form([["customerName", "Bikash"], ["itemTitle", "   "], ["itemQty", "1"]])
    );
    expect(result.error).toMatch(/at least one item/i);
  });

  it("converts rupees in the form to paisa in the database", async () => {
    fake.when(/insert into orders/i, () => [{ id: 1 }]);
    await expectRedirect(() => addOrder({}, form(valid)));
    expect(fake.find(/insert into orders/i)?.params).toContain(130000);
  });

  it("attributes the order to the signed-in staff member", async () => {
    fake.when(/insert into orders/i, () => [{ id: 1 }]);
    await expectRedirect(() => addOrder({}, form(valid)));
    expect(fake.find(/insert into order_events/i)?.params).toContain("Sunita Shrestha");
    expect(fake.find(/insert into order_audit/i)?.params).toContain("Sunita Shrestha");
  });

  it("coerces a junk quantity to at least one rather than NaN", async () => {
    fake.when(/insert into orders/i, () => [{ id: 1 }]);
    await expectRedirect(() =>
      addOrder(
        {},
        form([["customerName", "A"], ["itemTitle", "X"], ["itemQty", "abc"], ["itemPrice", "100"]])
      )
    );
    expect(fake.find(/insert into order_items/i)?.params).toContain(1);
  });

  it("redirects to the new order with a created flag", async () => {
    fake.when(/insert into orders/i, () => [{ id: 1 }]);
    const target = await expectRedirect(() => addOrder({}, form(valid)));
    expect(target).toMatch(/^\/admin\/orders\/[A-Z0-9]{4,8}\?created=1$/);
  });

  it("surfaces a database failure as a form error, not a crash", async () => {
    fake.when(/insert into orders/i, () => {
      throw new Error("connection terminated unexpectedly");
    });
    const result = await addOrder({}, form(valid));
    expect(result.error).toMatch(/connection terminated/i);
  });
});

describe("editOrder", () => {
  beforeEach(signedIn);

  const valid: [string, string][] = [
    ["orderId", "KG24MB"],
    ["customerName", "Sunita Shrestha"],
    ["address", "Baneshwor, Kathmandu"],
    ["itemTitle", "A5 ruled"],
    ["itemQty", "2"],
    ["itemPrice", "650"],
  ];

  it("rejects a malformed order ID", async () => {
    const result = await editOrder({}, form([...valid.slice(1), ["orderId", "!!"]]));
    expect(result.error).toMatch(/isn't valid/i);
  });

  it("still requires a name and an item", async () => {
    expect(
      (await editOrder({}, form([["orderId", "KG24MB"], ["itemTitle", "A5"]]))).error
    ).toMatch(/customer's name/i);
    expect(
      (await editOrder({}, form([["orderId", "KG24MB"], ["customerName", "X"]]))).error
    ).toMatch(/at least one item/i);
  });

  it("reports an order that does not exist", async () => {
    const result = await editOrder({}, form(valid));
    expect(result.error).toMatch(/no order with that id/i);
  });

  it("saves the change and refreshes the customer's page", async () => {
    seedOrder();
    const target = await expectRedirect(() => editOrder({}, form(valid)));
    expect(target).toMatch(/^\/admin\/orders\/KG24MB\?edited=/);
    expect(state.revalidated).toContain("/track/KG24MB");
    expect(state.revalidated).toContain("/admin");
  });

  it("attributes the edit in the audit trail", async () => {
    seedOrder();
    await expectRedirect(() => editOrder({}, form(valid)));
    expect(fake.find(/insert into order_audit/i)?.params).toContain("Sunita Shrestha");
  });
});

describe("updateStatus", () => {
  beforeEach(signedIn);

  it("rejects a status outside the delivery sequence", async () => {
    // Cancelling goes through closeOrderAction, which demands a reason.
    for (const bad of ["cancelled", "refunded", "invented"]) {
      resetSql();
      const result = await updateStatus(
        {},
        form([["orderId", "KG24MB"], ["status", bad]])
      );
      expect(result.error, bad).toMatch(/pick a status/i);
    }
  });

  it("reports a missing order", async () => {
    const result = await updateStatus(
      {},
      form([["orderId", "ZZZZZZ"], ["status", "shipped"]])
    );
    expect(result.error).toMatch(/no order/i);
  });

  it("moves an order forward without ceremony", async () => {
    seedOrder({ status: "processing" });
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await updateStatus(
      {},
      form([["orderId", "KG24MB"], ["status", "shipped"]])
    );
    expect(result.error).toBeUndefined();
    expect(result.ok).toMatch(/moved to shipped/i);
  });

  it("blocks a backwards move that was not confirmed", async () => {
    seedOrder({ status: "delivered" });
    const result = await updateStatus(
      {},
      form([["orderId", "KG24MB"], ["status", "processing"]])
    );
    expect(result.error).toMatch(/moves the order back/i);
    // Nothing is written until the staff member confirms.
    expect(fake.all(/update orders/i)).toHaveLength(0);
  });

  it("names both statuses so the warning is specific", async () => {
    seedOrder({ status: "delivered" });
    const result = await updateStatus(
      {},
      form([["orderId", "KG24MB"], ["status", "processing"]])
    );
    expect(result.error).toContain("Delivered");
    expect(result.error).toContain("Processing");
  });

  it("allows a backwards move once confirmed", async () => {
    seedOrder({ status: "delivered" });
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await updateStatus(
      {},
      form([
        ["orderId", "KG24MB"],
        ["status", "processing"],
        ["confirmBackwards", "yes"],
      ])
    );
    expect(result.error).toBeUndefined();
    const audit = fake.find(/insert into order_audit/i)!;
    expect(audit.params.some((p) => String(p).includes("Moved back to"))).toBe(true);
  });

  it("does not demand confirmation for a forward move", async () => {
    seedOrder({ status: "confirmed" });
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await updateStatus(
      {},
      form([["orderId", "KG24MB"], ["status", "delivered"]])
    );
    expect(result.error).toBeUndefined();
  });

  it("reopens a cancelled order instead of treating it as a backwards move", async () => {
    seedOrder({ status: "cancelled" });
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await updateStatus(
      {},
      form([["orderId", "KG24MB"], ["status", "processing"]])
    );
    expect(result.error).toBeUndefined();
    expect(result.ok).toMatch(/reopened/i);
    expect(fake.find(/insert into order_audit/i)?.text).toMatch(/'reopened'/);
  });
});

describe("closeOrderAction", () => {
  beforeEach(signedIn);

  const valid: [string, string][] = [
    ["orderId", "KG24MB"],
    ["status", "cancelled"],
    ["reason", "Customer changed their mind"],
    ["confirmClose", "yes"],
  ];

  it("accepts only cancelled or refunded", async () => {
    const result = await closeOrderAction(
      {},
      form([...valid.slice(0, 1), ["status", "shipped"], ...valid.slice(2)])
    );
    expect(result.error).toMatch(/cancel or refund/i);
  });

  it("insists on a reason, because the customer will read it", async () => {
    const result = await closeOrderAction(
      {},
      form([...valid.slice(0, 2), ["reason", "  "], ["confirmClose", "yes"]])
    );
    expect(result.error).toMatch(/give a reason/i);
    expect(workQueries()).toHaveLength(0);
  });

  it("insists on the confirmation box", async () => {
    const result = await closeOrderAction({}, form(valid.slice(0, 3)));
    expect(result.error).toMatch(/tick the box/i);
    expect(workQueries()).toHaveLength(0);
  });

  it("cancels the order and refreshes the customer's page", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await closeOrderAction({}, form(valid));
    expect(result.ok).toMatch(/cancelled/i);
    expect(state.revalidated).toContain("/track/KG24MB");
  });

  it("records a refund distinctly from a cancellation", async () => {
    fake.when(/update orders/i, () => [{ id: 7 }]);
    const result = await closeOrderAction(
      {},
      form([...valid.slice(0, 1), ["status", "refunded"], ...valid.slice(2)])
    );
    expect(result.ok).toMatch(/refunded/i);
    expect(fake.find(/insert into order_audit/i)?.params).toContain("refunded");
  });
});

// Staff -----------------------------------------------------------------------

describe("staff management", () => {
  beforeEach(signedIn);

  it("adds a colleague with a hashed password", async () => {
    fake.when(/insert into staff/i, () => [{ id: 9 }]);
    const result = await addStaff(
      {},
      form([
        ["displayName", "Bikash Rai"],
        ["username", "bikash"],
        ["password", "another-password"],
      ])
    );
    expect(result.ok).toMatch(/added bikash/i);
    expect(fake.find(/insert into staff/i)?.params).not.toContain("another-password");
  });

  it("reports a taken username instead of a raw database error", async () => {
    fake.when(/insert into staff/i, () => {
      throw new Error('duplicate key value violates unique constraint "staff_username_key"');
    });
    const result = await addStaff(
      {},
      form([
        ["displayName", "Bikash"],
        ["username", "sunita"],
        ["password", "another-password"],
      ])
    );
    expect(result.error).toMatch(/already taken/i);
  });

  it("refuses to let someone deactivate their own account", async () => {
    const result = await toggleStaff(
      {},
      form([["staffId", String(ME.staffId)], ["activate", "false"]])
    );
    expect(result.error).toMatch(/your own account/i);
  });

  it("refuses to deactivate the last active account", async () => {
    // Otherwise the shop locks itself out with no way back in.
    fake.when(/count\(\*\).*is_active/i, () => [{ n: 1 }]);
    const result = await toggleStaff({}, form([["staffId", "9"], ["activate", "false"]]));
    expect(result.error).toMatch(/last active account/i);
    expect(fake.all(/update staff set is_active/i)).toHaveLength(0);
  });

  it("deactivates a colleague when others remain", async () => {
    fake
      .when(/count\(\*\).*is_active/i, () => [{ n: 3 }])
      .when(/update staff set is_active/i, () => [{ id: 9 }]);
    const result = await toggleStaff({}, form([["staffId", "9"], ["activate", "false"]]));
    expect(result.ok).toMatch(/deactivated/i);
  });

  it("reactivates without the last-account check", async () => {
    fake.when(/update staff set is_active/i, () => [{ id: 9 }]);
    const result = await toggleStaff({}, form([["staffId", "9"], ["activate", "true"]]));
    expect(result.ok).toMatch(/reactivated/i);
  });

  it("requires the current password before changing it", async () => {
    fake.when(/from staff where username/i, () => []);
    const result = await changeOwnPassword(
      {},
      form([["currentPassword", "wrong"], ["newPassword", "a-new-password"]])
    );
    expect(result.error).toMatch(/current password doesn't match/i);
    expect(fake.all(/update staff set password_hash/i)).toHaveLength(0);
  });

  it("enforces the length floor on the new password", async () => {
    fake.when(/from staff where username/i, async () => [
      {
        id: 3,
        username: "sunita",
        display_name: "Sunita Shrestha",
        password_hash: await hashPassword("current-password"),
        is_active: true,
      },
    ]);
    const result = await changeOwnPassword(
      {},
      form([["currentPassword", "current-password"], ["newPassword", "short"]])
    );
    expect(result.error).toMatch(/8 characters/i);
  });

  it("changes the password when the current one checks out", async () => {
    fake
      .when(/from staff where username/i, async () => [
        {
          id: 3,
          username: "sunita",
          display_name: "Sunita Shrestha",
          password_hash: await hashPassword("current-password"),
          is_active: true,
        },
      ])
      .when(/update staff set password_hash/i, () => [{ id: 3 }]);

    const result = await changeOwnPassword(
      {},
      form([["currentPassword", "current-password"], ["newPassword", "a-new-password"]])
    );
    expect(result.ok).toMatch(/password changed/i);
  });
});
