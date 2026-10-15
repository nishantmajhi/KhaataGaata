import { describe, it, expect, beforeEach, vi } from "vitest";

const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

const {
  countStaff,
  countActiveStaff,
  listStaff,
  createStaff,
  authenticate,
  setStaffActive,
  changePassword,
} = await import("@/lib/staff");
const { hashPassword, verifyPassword } = await import("@/lib/password");

beforeEach(() => fake.reset());

describe("counts", () => {
  it("returns zero for a fresh database rather than undefined", async () => {
    expect(await countStaff()).toBe(0);
    expect(await countActiveStaff()).toBe(0);
  });

  it("counts only active accounts for the lockout guard", async () => {
    fake.when(/is_active = true/i, () => [{ n: 2 }]);
    expect(await countActiveStaff()).toBe(2);
  });
});

describe("listStaff", () => {
  it("puts active accounts first, then sorts by name", async () => {
    await listStaff();
    expect(fake.find(/from staff/i)?.text).toMatch(
      /order by is_active desc, display_name asc/i
    );
  });

  it("never selects the password hash", async () => {
    await listStaff();
    // The list is rendered in a server component; there is no reason for the
    // hash to travel with it.
    expect(fake.find(/from staff/i)?.text).not.toMatch(/password_hash/);
  });

  it("normalises timestamps and leaves a never-signed-in account null", async () => {
    fake.when(/from staff/i, () => [
      {
        id: "3",
        username: "sunita",
        display_name: "Sunita",
        is_active: true,
        created_at: new Date("2026-08-01T00:00:00Z"),
        last_login_at: null,
      },
    ]);
    const [row] = await listStaff();
    expect(row.id).toBe(3);
    expect(row.created_at).toBe("2026-08-01T00:00:00.000Z");
    expect(row.last_login_at).toBeNull();
  });
});

describe("createStaff", () => {
  it("stores a scrypt hash, never the password", async () => {
    fake.when(/insert into staff/i, () => [{ id: 5 }]);
    await createStaff({
      username: "bikash",
      displayName: "Bikash Rai",
      password: "a-real-password",
    });

    const insert = fake.find(/insert into staff/i)!;
    expect(insert.params).not.toContain("a-real-password");
    const hash = insert.params.find((p) => String(p).startsWith("scrypt:"))!;
    expect(await verifyPassword("a-real-password", String(hash))).toBe(true);
  });

  it("turns a duplicate username into a readable message", async () => {
    fake.when(/insert into staff/i, () => {
      throw new Error('duplicate key value violates unique constraint "staff_username_key"');
    });
    const result = await createStaff({
      username: "sunita",
      displayName: "Sunita",
      password: "a-real-password",
    });
    expect(result).toEqual({ error: "That username is already taken." });
  });

  it("does not swallow unrelated database errors", async () => {
    fake.when(/insert into staff/i, () => {
      throw new Error("connection terminated unexpectedly");
    });
    await expect(
      createStaff({ username: "x", displayName: "X", password: "a-real-password" })
    ).rejects.toThrow(/connection terminated/i);
  });
});

describe("authenticate", () => {
  const row = async (over: Record<string, unknown> = {}) => ({
    id: 3,
    username: "sunita",
    display_name: "Sunita Shrestha",
    password_hash: await hashPassword("the-real-password"),
    is_active: true,
    ...over,
  });

  it("returns the staff member for correct credentials", async () => {
    fake.when(/from staff where username/i, async () => [await row()]);
    const result = await authenticate("sunita", "the-real-password");
    expect(result).toMatchObject({ id: 3, display_name: "Sunita Shrestha" });
  });

  it("returns null for a wrong password", async () => {
    fake.when(/from staff where username/i, async () => [await row()]);
    expect(await authenticate("sunita", "nope")).toBeNull();
  });

  it("returns null for a deactivated account even with the right password", async () => {
    fake.when(/from staff where username/i, async () => [await row({ is_active: false })]);
    expect(await authenticate("sunita", "the-real-password")).toBeNull();
  });

  it("does not stamp last_login_at on a failed attempt", async () => {
    fake.when(/from staff where username/i, async () => [await row()]);
    await authenticate("sunita", "nope");
    expect(fake.all(/update staff set last_login_at/i)).toHaveLength(0);
  });

  it("stamps last_login_at on success", async () => {
    fake.when(/from staff where username/i, async () => [await row()]);
    await authenticate("sunita", "the-real-password");
    expect(fake.find(/update staff set last_login_at/i)?.params).toContain(3);
  });

  it("still does real hashing work when the username does not exist", async () => {
    // A missing username must not answer measurably faster than a wrong
    // password, or the form becomes an account-enumeration oracle. Measured
    // as a ratio rather than an absolute time, so it is not flaky on a slow
    // or a fast machine.
    fake.when(/from staff where username/i, async () => [await row()]);
    const wrongStart = performance.now();
    await authenticate("sunita", "definitely-not-it");
    const wrongPasswordMs = performance.now() - wrongStart;

    fake.reset();
    const missingStart = performance.now();
    expect(await authenticate("ghost", "some-password")).toBeNull();
    const missingUserMs = performance.now() - missingStart;

    // A placeholder hash would return in microseconds; a real one lands in
    // the same order of magnitude as the genuine check.
    expect(missingUserMs).toBeGreaterThan(wrongPasswordMs * 0.25);
  });

  it("binds the username rather than inlining it", async () => {
    await authenticate("sunita'; drop table staff; --", "x");
    const q = fake.find(/from staff where username/i)!;
    expect(q.text).not.toMatch(/drop table/i);
    expect(q.params).toContain("sunita'; drop table staff; --");
  });
});

describe("setStaffActive and changePassword", () => {
  it("reports false when the account does not exist", async () => {
    expect(await setStaffActive(99, false)).toBe(false);
    expect(await changePassword(99, "a-new-password")).toBe(false);
  });

  it("reports true when a row was updated", async () => {
    fake
      .when(/update staff set is_active/i, () => [{ id: 3 }])
      .when(/update staff set password_hash/i, () => [{ id: 3 }]);
    expect(await setStaffActive(3, true)).toBe(true);
    expect(await changePassword(3, "a-new-password")).toBe(true);
  });

  it("hashes the replacement password", async () => {
    fake.when(/update staff set password_hash/i, () => [{ id: 3 }]);
    await changePassword(3, "a-new-password");
    const params = fake.find(/update staff set password_hash/i)!.params;
    expect(params).not.toContain("a-new-password");
    expect(params.some((p) => String(p).startsWith("scrypt:"))).toBe(true);
  });
});
