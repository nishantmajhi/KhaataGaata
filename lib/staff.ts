import { sql } from "./db";
import { hashPassword, verifyPassword } from "./password";

// Re-exported so callers that want "the staff module" keep one import. The
// definition lives in its own file because middleware.ts needs it on the Edge
// runtime and cannot follow this file into node:crypto.
export { isStaffActive } from "./staff-status";

export type StaffRow = {
  id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A real hash to check failed logins against. The obvious shortcut - passing
 * a placeholder like "scrypt:00:00" - is worse than useless: verifyPassword
 * rejects a malformed hash immediately, so the unknown-username path returns
 * in microseconds while a real check takes ~100ms. That difference is exactly
 * the account-enumeration oracle the dummy check exists to prevent.
 */
let dummyHash: Promise<string> | null = null;
function timingDecoy(): Promise<string> {
  dummyHash ??= hashPassword("timing-equalisation-decoy-value");
  return dummyHash;
}

export async function countStaff(): Promise<number> {
  const rows = (await sql`select count(*)::int as n from staff`) as unknown as {
    n: number;
  }[];
  return rows[0]?.n ?? 0;
}

export async function listStaff(): Promise<StaffRow[]> {
  const rows = (await sql`
    select id, username, display_name, is_active, created_at, last_login_at
    from staff order by is_active desc, display_name asc
  `) as unknown as StaffRow[];

  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    created_at: iso(r.created_at)!,
    last_login_at: iso(r.last_login_at),
  }));
}

export async function createStaff(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ id: number } | { error: string }> {
  const hash = await hashPassword(input.password);
  try {
    const rows = (await sql`
      insert into staff (username, display_name, password_hash)
      values (${input.username}, ${input.displayName}, ${hash})
      returning id
    `) as unknown as { id: number }[];
    return { id: Number(rows[0].id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("staff_username_key")) {
      return { error: "That username is already taken." };
    }
    throw err;
  }
}

/**
 * Returns the staff member when the credentials are right and the account is
 * still active. A deactivated account fails exactly like a wrong password, so
 * the response does not reveal which usernames exist.
 */
export async function authenticate(
  username: string,
  password: string
): Promise<{ id: number; username: string; display_name: string } | null> {
  const rows = (await sql`
    select id, username, display_name, password_hash, is_active
    from staff where username = ${username} limit 1
  `) as unknown as {
    id: number;
    username: string;
    display_name: string;
    password_hash: string;
    is_active: boolean;
  }[];

  const row = rows[0];
  if (!row) {
    // Hash anyway so a missing username does not answer faster than a wrong
    // password, which would let someone enumerate accounts by timing.
    await verifyPassword(password, await timingDecoy());
    return null;
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok || !row.is_active) return null;

  await sql`update staff set last_login_at = now() where id = ${row.id}`;
  return { id: Number(row.id), username: row.username, display_name: row.display_name };
}

export async function setStaffActive(id: number, isActive: boolean): Promise<boolean> {
  const rows = (await sql`
    update staff set is_active = ${isActive} where id = ${id} returning id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}

export async function countActiveStaff(): Promise<number> {
  const rows = (await sql`
    select count(*)::int as n from staff where is_active = true
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function changePassword(id: number, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const rows = (await sql`
    update staff set password_hash = ${hash} where id = ${id} returning id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}
