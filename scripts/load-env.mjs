// Next.js loads .env.local on its own, but a plain `node scripts/x.mjs` does
// not. This reads it the same way Next does, with no extra dependency.
// Import it before anything that reads process.env.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Same precedence Next.js uses: .env.local wins over .env
for (const name of [".env", ".env.local"]) {
  const path = join(root, name);
  if (!existsSync(path)) continue;

  // strip a UTF-8 BOM if the file was saved from Notepad
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();

    // unwrap matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    // Next.js runs .env files through dotenv-expand, so an unescaped `$FOO`
    // is treated as a variable reference and usually expands to nothing.
    // This loader does not expand, so without this warning the same file
    // would mean two different things to `npm run dev` and `npm run db:push`.
    // Check before unescaping, or a correctly escaped value would warn too.
    if (/(^|[^\\])\$\{?\w/.test(value)) {
      console.warn(
        `[env] Warning: ${key} contains an unescaped "$". Next.js will expand ` +
          `it as a variable and truncate the value.\n` +
          `      Write it as \\$ in ${name}, or avoid "$" in secrets entirely.`
      );
    }

    // Match what Next.js produces for an escaped dollar: \$ means a literal $
    value = value.replace(/\\\$/g, "$");

    if (value !== "") process.env[key] = value;
  }
}
