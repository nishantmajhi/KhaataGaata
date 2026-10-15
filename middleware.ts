import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth";
// From lib/staff-status, not lib/staff: this file runs on the Edge runtime,
// and lib/staff reaches node:crypto through lib/password, which webpack
// refuses to bundle for the edge.
import { isStaffActive } from "@/lib/staff-status";

// Reachable without a session: the login form itself, and the one-time setup
// page (which guards itself with ADMIN_PASSWORD and refuses to run twice).
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/setup"]);

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_ADMIN_PATHS.has(pathname)) {
    // A valid token is enough to bounce someone off the login form. Checking
    // the account here as well would put a database round trip on the one
    // page a locked-out person needs to reach, to no purpose: the pages they
    // would be redirected to check for themselves.
    if (session) return NextResponse.redirect(new URL("/admin", request.url));
    return NextResponse.next();
  }

  // A signed token proves who issued it, not that the account still exists or
  // is still switched on. Sessions last twelve hours, so without this an
  // account deactivated at nine in the morning keeps working until evening.
  // A deactivated visitor is treated exactly like an expired one — same
  // redirect, same page, nothing new for them to see.
  const signedIn = session !== null && (await isStaffActive(session.staffId));

  if (!signedIn) {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
