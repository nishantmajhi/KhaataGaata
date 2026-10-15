import { describe, it, expect, vi } from "vitest";

// The guard now asks the database whether the account behind a valid token is
// still active, so it needs the fake sql even for the paths that never reach
// a page. Every session in this file belongs to an active account; the
// deactivated cases live in revocation.test.ts.
const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));
fake.when(/from staff where id = \$1/i, () => [{ is_active: true }]);

const { NextRequest } = await import("next/server");
const { middleware, config } = await import("@/middleware");
const { SESSION_COOKIE, createSessionToken } = await import("@/lib/auth");

const SESSION = { staffId: 3, username: "sunita", displayName: "Sunita Shrestha" };
const token = () => createSessionToken(SESSION);

function request(path: string, token?: string) {
  const req = new NextRequest(new URL(`https://shop.example${path}`));
  if (token) req.cookies.set(SESSION_COOKIE, token);
  return req;
}

describe("admin guard", () => {
  it("only runs on /admin routes", () => {
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });

  it("redirects an anonymous visitor to the login page", async () => {
    const res = await middleware(request("/admin"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/admin/login");
  });

  it("remembers where the visitor was heading", async () => {
    const res = await middleware(request("/admin/orders/KG24MB"));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/admin/orders/KG24MB");
  });

  it("lets an anonymous visitor reach the login page", async () => {
    const res = await middleware(request("/admin/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets an anonymous visitor reach first-run setup", async () => {
    // Setup guards itself with ADMIN_PASSWORD and refuses once an account
    // exists, so it has to be reachable before anyone can sign in.
    const res = await middleware(request("/admin/setup"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a signed-in user away from setup", async () => {
    const res = await middleware(request("/admin/setup", await token()));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("lets a signed-in user through", async () => {
    const res = await middleware(request("/admin/orders/new", await token()));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a signed-in user away from the login page", async () => {
    const res = await middleware(request("/admin/login", await token()));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("treats a forged cookie as anonymous", async () => {
    const res = await middleware(request("/admin", "totally.made.up"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("guards nested admin paths, not just the index", async () => {
    for (const path of ["/admin/orders/new", "/admin/orders/KG24MB", "/admin/anything"]) {
      const res = await middleware(request(path));
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/admin/login");
    }
  });
});

describe("open-redirect resistance", () => {
  it("keeps the redirect on the shop's own origin", async () => {
    const res = await middleware(request("/admin/orders/new"));
    expect(new URL(res.headers.get("location")!).origin).toBe("https://shop.example");
  });

  it("only ever stores a relative path in next", async () => {
    // The sign-in action additionally refuses any `next` that does not start
    // with /admin, so a crafted value cannot bounce the user off-site.
    const res = await middleware(request("/admin/orders"));
    const next = new URL(res.headers.get("location")!).searchParams.get("next")!;
    expect(next.startsWith("/admin")).toBe(true);
  });
});
