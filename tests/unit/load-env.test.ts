import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * scripts/load-env.mjs resolves .env relative to its own location, so each
 * case runs it in a throwaway directory laid out like the project.
 */
async function loadIn(files: Record<string, Buffer | string>) {
  const root = mkdtempSync(join(tmpdir(), "kg-env-"));
  const scripts = join(root, "scripts");
  const { mkdirSync, copyFileSync } = await import("node:fs");
  mkdirSync(scripts);
  // fileURLToPath, not URL.pathname: on Windows the latter hands back
  // "/E:/Backups/..." with a leading slash, which fs then resolves against the
  // current drive as "E:\E:\Backups\...". It fails with ENOENT, which reads
  // like a missing script rather than a mangled path — all fourteen cases in
  // this file failed that way. vitest.config.ts already had this right.
  copyFileSync(
    fileURLToPath(new URL("../../scripts/load-env.mjs", import.meta.url)),
    join(scripts, "load-env.mjs")
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }

  // Snapshot every key so one case cannot leak a value into the next. Without
  // this, a case that sets the same value as its predecessor looks like a no-op.
  const before = { ...process.env };
  const captured: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...a) => {
    captured.push(a.join(" "));
  });

  // Cache-bust so each case re-executes the module.
  await import(`${join(scripts, "load-env.mjs")}?t=${Math.random()}`);

  const changed: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (process.env[key] !== before[key]) changed[key] = process.env[key];
  }

  // Restore exactly, including keys the loader overwrote.
  for (const key of Object.keys(process.env)) {
    if (!(key in before)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(before)) process.env[key] = value!;

  warn.mockRestore();
  rmSync(root, { recursive: true, force: true });
  return { env: changed, warnings: captured };
}

describe("load-env", () => {
  it("reads a plain .env.local", async () => {
    const { env } = await loadIn({ ".env.local": 'FOO="bar"\nBAZ=qux\n' });
    expect(env.FOO).toBe("bar");
    expect(env.BAZ).toBe("qux");
  });

  it("survives a UTF-8 BOM, which Notepad adds silently", async () => {
    const content = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('DATABASE_URL="postgresql://u:p@host/db"\n'),
    ]);
    const { env } = await loadIn({ ".env.local": content });
    expect(env.DATABASE_URL).toBe("postgresql://u:p@host/db");
  });

  it("handles Windows CRLF line endings", async () => {
    const { env } = await loadIn({
      ".env.local": 'A="one"\r\nB="two"\r\n# comment\r\nC="three"\r\n',
    });
    expect(env).toMatchObject({ A: "one", B: "two", C: "three" });
  });

  it("skips comments and blank lines", async () => {
    const { env } = await loadIn({
      ".env.local": "# leading comment\n\n  \nREAL=yes\n# trailing\n",
    });
    expect(env.REAL).toBe("yes");
    expect(Object.keys(env)).toEqual(["REAL"]);
  });

  it("strips matching single or double quotes only", async () => {
    const { env } = await loadIn({
      ".env.local": `DQ="double"\nSQ='single'\nBARE=none\nMIXED="unmatched\n`,
    });
    expect(env.DQ).toBe("double");
    expect(env.SQ).toBe("single");
    expect(env.BARE).toBe("none");
    expect(env.MIXED).toBe('"unmatched');
  });

  it("keeps '=' inside a value, as connection strings contain", async () => {
    const { env } = await loadIn({
      ".env.local": 'SESSION_SECRET="aImqN18zxop7bM9tUPwPfFsGPeGxPt9cN5vFlWVx1Rk="\n',
    });
    expect(env.SESSION_SECRET).toBe("aImqN18zxop7bM9tUPwPfFsGPeGxPt9cN5vFlWVx1Rk=");
  });

  it("keeps query parameters in a Neon URL intact", async () => {
    const url =
      "postgresql://u:p@ep-x-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const { env } = await loadIn({ ".env.local": `DATABASE_URL="${url}"\n` });
    expect(env.DATABASE_URL).toBe(url);
  });

  it("lets .env.local override .env", async () => {
    const { env } = await loadIn({
      ".env": 'SHARED="from-env"\nONLY_BASE="base"\n',
      ".env.local": 'SHARED="from-local"\n',
    });
    expect(env.SHARED).toBe("from-local");
    expect(env.ONLY_BASE).toBe("base");
  });

  it("does nothing when no env file exists", async () => {
    const { env, warnings } = await loadIn({});
    expect(Object.keys(env)).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("warns about an unescaped $, which Next.js would silently expand", async () => {
    const { warnings } = await loadIn({ ".env.local": 'ADMIN_PASSWORD="SuperU$3r"\n' });
    expect(warnings.join("\n")).toMatch(/ADMIN_PASSWORD/);
    expect(warnings.join("\n")).toMatch(/\$/);
  });

  it("does not warn about a correctly escaped $", async () => {
    const { env, warnings } = await loadIn({
      ".env.local": 'ADMIN_PASSWORD="SuperU\\$3r"\n',
    });
    expect(warnings).toHaveLength(0);
    // Matches what Next.js produces for the same escaped input.
    expect(env.ADMIN_PASSWORD).toBe("SuperU$3r");
  });

  it("does not warn about a lone $ with no identifier after it", async () => {
    const { warnings } = await loadIn({ ".env.local": 'PRICE="100$"\n' });
    expect(warnings).toHaveLength(0);
  });

  it("ignores an 'export' prefix copied from a shell script", async () => {
    const { env } = await loadIn({ ".env.local": 'export TOKEN="abc123"\n' });
    expect(env.TOKEN).toBe("abc123");
  });

  it("ignores a line with no '='", async () => {
    const { env } = await loadIn({ ".env.local": "GARBAGE LINE\nGOOD=yes\n" });
    expect(env.GOOD).toBe("yes");
    expect(env.GARBAGE).toBeUndefined();
  });
});
