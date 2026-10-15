import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon pooled connection string."
  );
}

// Neon's HTTP driver: one fetch per query, no connection pool to exhaust.
// This is what makes Postgres workable from serverless functions.
export const sql = neon(process.env.DATABASE_URL);
