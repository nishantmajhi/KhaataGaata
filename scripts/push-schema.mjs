// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run db:push
import "./load-env.mjs";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Checked .env and .env.local in: " + process.cwd() + "\n" +
      "Make sure the file is named exactly .env.local (not .env.local.txt)."
  );
  process.exit(1);
}

const sql = neon(url);
const source = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

// Strip comments, then split on semicolons. The schema has no functions or
// dollar-quoted bodies, so a plain split is safe here.
const statements = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  // @neondatabase/serverless has no `.query()` method. The query function is
  // callable either as a tagged template or, as here, with a plain string.
  await sql(statement);
  console.log("✓", statement.split("\n")[0].slice(0, 68));
}

console.log(`\nSchema applied — ${statements.length} statements.`);
