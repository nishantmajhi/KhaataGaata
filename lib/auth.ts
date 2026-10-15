import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "kg_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // one working day

export type Session = {
  staffId: number;
  username: string;
  displayName: string;
};

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Generate one with: openssl rand -base64 32"
    );
  }
  return new TextEncoder().encode(raw);
}

/**
 * The session carries the staff member's identity, so every action can record
 * who performed it without a second database lookup on each request.
 */
export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({
    role: "staff",
    sid: session.staffId,
    username: session.username,
    name: session.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject(String(session.staffId))
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

/** Returns the session when the token is valid and well formed, else null. */
export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.role !== "staff") return null;

    const staffId = Number(payload.sid);
    const username = payload.username;
    const displayName = payload.name;

    if (!Number.isInteger(staffId) || staffId <= 0) return null;
    if (typeof username !== "string" || typeof displayName !== "string") return null;

    return { staffId, username, displayName };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

/**
 * Guards the one-time setup page. Not a login: it only gates creating the
 * very first staff account, after which ADMIN_PASSWORD is unused.
 */
export function setupKeyMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
