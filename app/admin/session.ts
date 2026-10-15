import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken, type Session } from "@/lib/auth";

/**
 * Reads the signed-in staff member for display. The middleware has already
 * refused unauthenticated requests to /admin, so pages can treat a null here
 * as "cookie expired mid-render" rather than as an access decision.
 */
export async function currentStaff(): Promise<Session | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}
