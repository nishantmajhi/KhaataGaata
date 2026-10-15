import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * scrypt ships with Node, so staff passwords get a proper memory-hard hash
 * without adding bcrypt or argon2 as a dependency. Stored as
 * "scrypt:<salt-hex>:<hash-hex>" so the format can be changed later without
 * guessing what an existing row contains.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}

/**
 * Staff pick their own passwords, so the floor is deliberately low but not
 * absent. Length beats character-class rules for a shop of a few people.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That's too long — 200 characters maximum.";
  if (!/\S/.test(password)) return "A password can't be only spaces.";
  return null;
}
