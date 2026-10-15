import { describe, it, expect, vi } from "vitest";
import {
  setupKeyMatches,
  createSessionToken,
  readSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { hashPassword, verifyPassword, passwordProblem } from "@/lib/password";

const SESSION = { staffId: 7, username: "sunita", displayName: "Sunita Shrestha" };

describe("setupKeyMatches", () => {
  it("accepts the exact ADMIN_PASSWORD", () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse-battery");
    expect(setupKeyMatches("correct-horse-battery")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rejects near misses", () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse-battery");
    for (const bad of ["correct-horse-batter", "Correct-Horse-Battery", ""]) {
      expect(setupKeyMatches(bad), bad).toBe(false);
    }
    vi.unstubAllEnvs();
  });

  it("refuses everything when ADMIN_PASSWORD is unset", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(setupKeyMatches("")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("documents the dotenv-expand trap that bit us in development", () => {
    // Next.js runs .env files through dotenv-expand, so ADMIN_PASSWORD="SuperU$3r"
    // arrives as "SuperU". Pinned so nobody rediscovers it by being locked out.
    vi.stubEnv("ADMIN_PASSWORD", "SuperU");
    expect(setupKeyMatches("SuperU$3r")).toBe(false);
    expect(setupKeyMatches("SuperU")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("open-sesame-1234");
    expect(await verifyPassword("open-sesame-1234", stored)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("open-sesame-1234");
    expect(await verifyPassword("open-sesame-1235", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("open-sesame-1234");
    expect(stored).not.toContain("open-sesame");
    expect(stored.startsWith("scrypt:")).toBe(true);
  });

  it("salts, so the same password hashes differently each time", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-here", a)).toBe(true);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });

  it("refuses a malformed or truncated stored hash instead of throwing", async () => {
    for (const bad of ["", "plaintext", "scrypt:zz", "scrypt:00:00", "bcrypt:a:b"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });

  it("sets a length floor but not silly character rules", () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("        ")).toMatch(/only spaces/);
    expect(passwordProblem("a".repeat(201))).toMatch(/too long/);
    expect(passwordProblem("a perfectly fine passphrase")).toBeNull();
  });
});

describe("session tokens", () => {
  it("round-trips the staff identity", async () => {
    const token = await createSessionToken(SESSION);
    expect(await readSessionToken(token)).toMatchObject(SESSION);
  });

  it("carries the display name so actions can attribute themselves", async () => {
    const token = await createSessionToken(SESSION);
    const session = await readSessionToken(token);
    // This is what ends up in order_events.actor_name and the audit log.
    expect(session?.displayName).toBe("Sunita Shrestha");
  });

  it("rejects nothing, junk and tampered tokens", async () => {
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("not.a.jwt")).toBe(false);

    const token = await createSessionToken(SESSION);
    const [h, p, s] = token.split(".");

    // Flip the FIRST character of the signature, not the last.
    //
    // An HS256 signature is 32 bytes, which base64url-encodes to 43
    // characters: 42 characters carry six significant bits each and the
    // forty-third carries only four, the remaining two being padding. So the
    // sixteen characters "AEIMQUYcgkosw048" all appear as the final
    // character, and swapping one for another that differs only in those two
    // padding bits produces a different string that decodes to exactly the
    // same 32 bytes — a signature that is still valid.
    //
    // This test used to do that. It replaced the last character with "B" when
    // it was "A" and with "A" otherwise, and "A" is one of the sixteen, so
    // roughly one run in sixteen mutated nothing and the "tampered" token
    // verified. Measured over 1600 distinct tokens: 97 ended in "A", and in
    // all 97 the mutant was still accepted. Every character but the last is
    // entirely significant, so flipping one there always changes the bytes.
    const badSig = (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(await verifySessionToken(`${h}.${p}.${badSig}`)).toBe(false);
  });

  it("is not fooled by a signature re-spelled in its padding bits", async () => {
    // The other half of the note above, asserted rather than described: the
    // final character of a 43-character signature has two bits that carry no
    // information, so "…A" and "…B" are the same signature. A check that
    // treats a JWT as a string rather than as bytes would call the second one
    // a forgery; jose decodes first, and this pins that it keeps doing so.
    // A signature ends in one of sixteen characters, so vary the payload
    // until one turns up whose partner we know. Identical input in the same
    // second gives an identical token, which is why staffId moves.
    const NEXT: Record<string, string> = { A: "B", I: "J", Q: "R", g: "h" };
    let parts: string[] | null = null;
    let respelled = "";
    for (let staffId = 1; staffId <= 200 && !parts; staffId++) {
      const candidate = (
        await createSessionToken({ ...SESSION, staffId })
      ).split(".");
      const partner = NEXT[candidate[2].at(-1)!];
      if (partner) {
        parts = candidate;
        respelled = partner;
      }
    }
    expect(parts, "no signature with a known padding partner in 200 tries").not.toBeNull();

    const [h, p, s] = parts!;
    const mutant = s.slice(0, -1) + respelled;
    expect(mutant).not.toBe(s);
    expect(await verifySessionToken(`${h}.${p}.${mutant}`)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SESSION);
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-value-here");
    expect(await verifySessionToken(token)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("rejects a token whose role claim has been swapped", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const token = await new SignJWT({ role: "customer", sid: 1, username: "x", name: "X" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("rejects a well-signed token that is missing staff identity", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const token = await new SignJWT({ role: "staff" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    // An old-format cookie from before staff accounts must not authenticate.
    expect(await readSessionToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const token = await new SignJWT({ role: "staff", sid: 1, username: "x", name: "X" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("throws a helpful error when SESSION_SECRET is too short", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    await expect(createSessionToken(SESSION)).rejects.toThrow(/SESSION_SECRET/);
    vi.unstubAllEnvs();
  });
});

describe("session cookie", () => {
  it("is httpOnly and same-site to blunt XSS and CSRF", () => {
    expect(SESSION_COOKIE).toBe("kg_session");
    expect(sessionCookieOptions.httpOnly).toBe(true);
    expect(sessionCookieOptions.sameSite).toBe("lax");
    expect(sessionCookieOptions.path).toBe("/");
  });

  it("expires within a working day", () => {
    expect(sessionCookieOptions.maxAge).toBe(60 * 60 * 12);
  });
});
