import { sql } from "./db";

/**
 * Whether the account behind a live session is still allowed in.
 *
 * The session is a signed JWT with a twelve hour life and no server-side
 * record, so it cannot know that the account was switched off after it was
 * issued. Without this lookup, deactivating somebody stops them signing in
 * again and nothing else: the tab already open in their browser keeps full
 * access — including the staff page, where they can switch themselves back on
 * — until the token expires. An account row that has vanished entirely counts
 * as inactive for the same reason.
 *
 * This lives apart from the rest of lib/staff.ts because middleware.ts needs
 * it and middleware runs on the Edge runtime. lib/staff.ts imports
 * lib/password.ts, which imports node:crypto, and webpack refuses to bundle a
 * node: scheme for the edge — "UnhandledSchemeError: Reading from
 * node:crypto is not handled by plugins", which names the scheme rather than
 * the runtime and takes a while to read as "this file cannot be imported from
 * middleware". Only the Neon driver is reachable from here, and that one is
 * built for the edge.
 */
export async function isStaffActive(id: number): Promise<boolean> {
  const rows = (await sql`
    select is_active from staff where id = ${id} limit 1
  `) as unknown as { is_active: boolean }[];
  return rows[0]?.is_active === true;
}
