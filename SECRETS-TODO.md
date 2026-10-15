# Credentials to rotate

Written 2026-09-25. Delete this file once the items below are done.

Nothing here needs undoing in git. **Unlike the other three projects in this
archive with a `SECRETS-TODO.md`, this repository is clean**: `.env.local` is
listed in `.gitignore`, `git ls-files` does not show it, and
`git log --all -- .env.local .env` returns nothing. There is no history to
rewrite and no force-push to weigh up. The problem is the file on disk.

## What is in `.env.local`

Four live values, none of them placeholders, checked on 2026-09-25 by length
and prefix only — **nothing here has been used to connect to anything**:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | A 162-character Neon Postgres pooled connection string. Host, database, username and password in one value — a complete set, not a fragment. |
| `ADMIN_PASSWORD` | 23 characters. Gates `/admin/setup`, the one-time page that creates the first staff account. |
| `SESSION_SECRET` | 46 characters, base64. Signs the admin session cookie. |
| `UPSTASH_REDIS_REST_TOKEN` | 64 characters, with its REST URL beside it. |

## Why this is worth acting on even though nothing was committed

This directory sits inside a general `code` backup tree. A backup tree is
copied to other drives, synced to cloud storage, zipped and passed to someone
to look through — and `.gitignore` has no say in any of that. The protection
that worked for git does not extend one inch past it.

Treat all four as exposed if this archive has ever left the machine. A Neon
connection string is direct database access; it does not need the application
to be running or reachable.

## What to do

1. **Rotate the Neon password** in the Neon console, then paste the new pooled
   connection string into `.env.local` and into the Vercel project's
   environment variables.
2. **Rotate `SESSION_SECRET`** — `openssl rand -base64 32`. Changing it
   invalidates every session currently open, which is the point rather than a
   side effect.
3. **Change `ADMIN_PASSWORD`.** Read the note in `.env.example` first: avoid
   `$` in the value, because Next.js expands `.env` files locally and Vercel
   does not, so a `$` would need two different spellings in the two places.
4. **Roll the Upstash token** from the Upstash console.
5. **Move the working secrets out of the backup tree.** A password manager, or
   a file outside this directory that the app reads by absolute path. Anything
   that keeps a live credential from being carried along by a copy of a
   folder.

After rotating, `npm run dev` and sign in once to confirm the new values work
before deleting this file.

## Not a credential, but adjacent

`scripts/seed.mjs` creates a staff account `demo` with the password
`changeme123` unless `SEED_STAFF_PASSWORD` is set, and that default is printed
in the README. It is only reachable by running `npm run db:seed` deliberately.
Worth confirming the seeder has never been pointed at the production database:
`select * from staff where username = 'demo'` answers it in one query. If a
`demo` row exists there, deactivate it from `/admin/staff`.
