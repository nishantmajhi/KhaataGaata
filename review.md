# Code Review — KhaataGaata

**Remediated 2026-09-25 on branch `cleanup/2026-09-25`. Four commits, nothing
pushed.** The first-pass review of 2026-09-04 is kept below with its findings
marked off. Read the corrections first: this review was right about everything
it looked at and missed the two worst defects in the project, both of them
security defects, and both of them in code it praised by name.

## Corrections to the first-pass review

**1. "The security model is properly built rather than improvised" — mostly
true, and it hid two holes.** The review listed five things it admired. Two of
them were the two bugs.

- It praised the middleware for enforcing authentication "at the route level".
  It does, and until this pass that meant checking a signature and nothing
  else. The session is a self-contained JWT with a twelve-hour life and no
  server-side record, and the only `is_active` check in the codebase lived in
  `authenticate()` — the sign-in path, which somebody already signed in never
  takes again. **So deactivating a staff account stopped them signing in and
  did nothing else.** Until their token expired, up to twelve hours later, the
  tab already open in their browser kept the full ledger, could create and edit
  and cancel orders, and could open `/admin/staff` and switch them back on.
  `tests/api/revocation.test.ts` drives all four of those and every one
  succeeded against the original code.

- It praised the rate limiting as existing "as its own module with a documented
  degradation path", and finding 2 went on to worry about the degradation. The
  degradation was the smaller problem. `clientIp()` read the **leftmost**
  `X-Forwarded-For` entry, which is the one the caller sends. Every limit in
  the application is keyed on that return value, so varying one header per
  request produced a fresh allowance each time: five login attempts per ten
  minutes became five *per forged value*, against a single shared password.
  That is not a weakened limit, it is no limit.

**2. Finding 3 had the right worry and the wrong premise.** It said there is "a
single shared admin password for all staff", so "no per-user attribution in the
ledger and no way to revoke one person's access without changing it for
everyone". That is not how the app works and has not been for some time.
`ADMIN_PASSWORD` is a one-time setup key that stops being used the moment the
first account exists; after that everyone has their own username, their own
scrypt-hashed password, and their own session. The review noticed the `staff/`
directory and `lib/staff.ts` in the same paragraph and still hedged.

The worry underneath it was right twice over, though, and in ways the wrong
premise stopped it reaching. There *was* no way to revoke one person's access —
not because of a shared password but because revocation did not work. And
attribution *was* incomplete: entries recorded a display name and nothing else,
and nothing makes display names unique.

**3. Finding 1 asked two questions that were already answered — by the test
suite the review counted.** Order IDs are six characters drawn with
`crypto.getRandomValues` from a 32-symbol alphabet, and since 256 is a whole
multiple of 32 there is no modulo bias; `tests/unit/status.test.ts` already
asserted both the distribution and the collision rate. `toPublicOrder()`
already withheld name, phone, address, items and total, and both
`tests/unit/orders.test.ts` and `tests/api/orders-route.test.ts` already
asserted on the serialised response that none of them appears. **Nothing needed
fixing and nothing needed a comment; the answer to the review's question was
sitting in the files it was counting.** Worth knowing for the next reader: the
suite here is good, and reading it first would have saved the question.

**4. "Twelve test files" — and fourteen of their assertions had never run.**
`tests/unit/load-env.test.ts` resolved a path with `new URL(...).pathname`,
which on Windows yields `/E:/Backups/...`; every fs call then resolved that
against the current drive as `E:\E:\Backups\...`. All fourteen cases in the
file failed with ENOENT, which reads like a missing script rather than a
mangled path. `vitest.config.ts` in the same repository already used
`fileURLToPath`. So the headline number was 315 tests of which 301 ran.

## What was fixed

| | |
| --- | --- |
| Branch | `cleanup/2026-09-25` |
| Commits | 4 |
| Tests | 315 (301 passing) → **355, all passing** |
| Verified | six consecutive full runs green; `tsc --noEmit` clean; `next build` clean |
| Pushed | no |

### P1 — a deactivated account kept its live session

`lib/staff-status.ts` (new) holds `isStaffActive()`, and the two places that
were already the access decision now call it: `middleware.ts` for every read
under `/admin`, `requireStaff()` in `app/admin/actions.ts` for every write. A
deactivated visitor gets exactly the redirect an expired one gets, so nothing
on screen is new. A row that has vanished counts as inactive.

Two things to know about the shape of that fix:

- **It lives in its own file for a reason.** The first version imported
  `isStaffActive` from `lib/staff.ts`, which imports `lib/password.ts`, which
  imports `node:crypto`. Middleware runs on the Edge runtime and webpack will
  not bundle a `node:` scheme for it, so the entire production build failed
  with `UnhandledSchemeError: Reading from "node:crypto" is not handled by
  plugins` — an error that names the scheme and not the runtime. **All 339
  tests passed against that commit.** Only `next build` saw it. If you touch
  `middleware.ts`, build.
- **The cost is one indexed primary-key lookup per admin request**, and a
  middleware that now fails when Postgres does. It failed before too, one layer
  later, when the page ran its own queries.

### P1 — every rate limit was bypassable with one header

`clientIp()` now takes the **rightmost** `X-Forwarded-For` entry — the one the
nearest proxy writes, and the only entry in the header a caller cannot choose —
falling back to `x-real-ip` and then to a single shared `unknown` key. Behind a
chain of proxies the rightmost is the proxy rather than the visitor, which
lumps several visitors into one bucket. That is the safe direction for a
limiter to be wrong in: a shared bucket still limits, a per-request bucket does
not.

**Two assertions in `tests/unit/ratelimit.test.ts` required the old behaviour by
name** — "takes the first hop from x-forwarded-for". They are corrected in
place with a note. A third, in `tests/api/orders-route.test.ts`, was called
"reads the caller address from x-forwarded-for" and asserted only that the call
returned 404, which is true of every possible implementation including the
broken one; it now records the key the limiter is actually counted against.

### P2 — production degraded silently to a limiter that does not limit

`lib/ratelimit.ts` throws at load unless both Upstash variables are set, which
means `next build` stops rather than a deployment shipping. `ALLOW_MEMORY_RATELIMIT=1`
opts out, checked for exactly `1` because `0` and `false` are what people set
when they mean the opposite. Verified by building with Upstash, without it, and
with the opt-out.

### P2 — the in-memory fallback leaked (not in the first review)

The fallback's `Map` was never swept: one entry per distinct key, kept for the
life of the process, and the key comes from request headers — so the growth
rate was chosen by whoever was sending the requests, and the `clientIp` bug
made minting new keys free. Now `lib/memory-limiter.ts`, extracted so it can be
driven by an injected clock: expired entries swept at most once per window, and
a hard capacity evicting oldest-first. Its suite asserts the bound and also
asserts, deliberately, that eviction hands an allowance back — which is why
capacity sits far above any honest load.

### P3 — the audit trail identified people by display name only

`order_events` and `order_audit` now carry `actor_staff_id` beside
`actor_name`. Nullable, `add column if not exists`, `on delete set null`,
matching how the rest of `db/schema.sql` handles post-release changes: rows
written before the column existed cannot be attributed retrospectively and a
guess would be worse than a blank. `lib/orders.ts` gained an `Actor` type
pairing the two, which is what made the change safe — making it required on
every write input meant the compiler listed every call site. `scripts/seed.mjs`
stamps its sample rows with the demo account's real id. Nothing on screen
changed.

### A 1-in-16 flake in the existing suite

`tests/unit/auth.test.ts`, "rejects nothing, junk and tampered tokens", built
its tampered token by replacing the **last** character of the signature — `B`
if it was `A`, `A` otherwise. An HS256 signature is 32 bytes, which
base64url-encodes to 43 characters, and the forty-third carries only four
significant bits; the other two are padding. So the final character is always
one of `AEIMQUYcgkosw048`, and swapping `A` for `B` changes nothing but
padding: the mutant decodes to the same 32 bytes and verifies correctly.

Measured rather than reasoned about — over 1600 tokens with distinct payloads
the sixteen final characters came up evenly, 97 ended in `A`, and in all 97 the
"tampered" token was accepted. **Varying the payload is what makes that
measurement work**: identical input inside the same second produces an
identical token, so a naive loop samples one value and reports 68%. The fix
flips the first character, where every bit is significant, and a second test
now asserts the padding equivalence directly.

## Deliberately left alone

- **The README was corrected, not rewritten.** It was already written from
  first principles and was accurate about the code it described — including,
  exactly, the behaviour this pass changed. Replacing 560 good lines to satisfy
  a convention would have destroyed work to produce nothing better. Every
  statement this pass falsified has been corrected and four new entries added
  under "design decisions worth knowing".
- **No `LICENSE`.** Still true, still P3, and still the author's choice of
  licence rather than a bug to fix.
- **No roles.** Every signed-in staff member can do everything, which the
  README states and defends for a shop of a few people who know each other. Now
  that revocation works and entries carry a staff id, the audit trail actually
  supports that posture rather than merely claiming to.
- **`createOrder` is not transactional.** The Neon HTTP driver issues one fetch
  per statement, so an order row, its items and its first event are four
  separate round trips; a failure between them leaves an order with no items.
  Not observed, and fixing it means either the WebSocket driver or a stored
  procedure — a real change of shape, and the author's call. Listed here so the
  next reader does not have to rediscover it.
- **`setupKeyMatches` returns early on a length mismatch**, so the
  constant-time comparison the first review praised leaks the length of
  `ADMIN_PASSWORD`. It is a one-time setup key behind a login rate limit, and
  the length of a 23-character password is not the secret. Left as is.
- **`verifyPassword`'s `try/catch` around `Buffer.from(hex)` is dead code** —
  `Buffer.from` does not throw on invalid hex, it truncates. The length checks
  immediately after catch it anyway, so the behaviour is right and only the
  reason is wrong.

## Notes for a future session

- **`npm run build` before you believe a middleware change.** The Edge runtime
  rejects `node:` imports at bundle time only; `tsc` and the whole suite pass
  happily. This pass produced a commit that was green on 339 tests and could
  not be deployed.
- **Read the suite before adding to it.** Two of the first review's three open
  questions were already answered by tests it had counted but not read.
- **Don't build against `.env.local`.** It holds live credentials. The build
  verification for this pass copied the tracked files to the session scratchpad
  and wrote placeholder values there; the real file was never loaded and
  nothing was connected to.
- **`SECRETS-TODO.md` is the one thing here with a live consequence.** Four
  credentials on disk, none of them committed, all of them real.
- The fake driver in `tests/helpers/fake-sql.ts` routes by regex with
  first-match-wins, and `fake.reset()` drops the routes. Any test calling
  `reset()` mid-file now has to re-arm the account-status route;
  `tests/api/actions.test.ts` has a `resetSql()` helper that does it.

---

# First-pass review, 2026-09-04

Reviewed against the working tree. Scope: `app/` (admin, track, api routes), `lib/auth.ts`,
`lib/ratelimit.ts`, `middleware.ts`, `tests/` (twelve files), `.env.example`, `.env.local`,
`.gitignore`, `README.md`.

## What this project is

A Next.js App Router order-tracking application: staff sign in to an admin area to create, update and
close orders against a Neon Postgres database, and customers follow a public tracking page for their
order id. Rate limiting uses Upstash Redis with an in-memory fallback.

## Verdict

This is production-shaped work and it is close to the best web project in the archive. The security
model is properly built rather than improvised:

- **JWT-signed session cookies** with `httpOnly`, `sameSite: "lax"`, `secure` gated on production, and
  a bounded `maxAge` (`lib/auth.ts:65-69`).
- **Middleware enforces authentication** at the route level with `matcher: ["/admin/:path*"]`, and a
  small explicit set of public admin paths. Pages then treat a missing session as "expired
  mid-render" rather than as an access decision — and the comment in `app/admin/session.ts` says
  exactly that, which is the sort of thing that stops a future contributor turning a display helper
  into an authorisation check.
- **Constant-time comparison** (`lib/auth.ts:84` accumulating into `diff` and testing `diff === 0`).
- **Rate limiting** exists as its own module with a documented degradation path.
- **Twelve test files** covering auth, middleware, the orders route, server actions, schema, and
  three component suites, with a `fake-sql.ts` helper so database logic can be tested without a
  database.

The `.env.example` is also unusually good — it explains *why* to avoid `$` in the admin password
(dotenv-expand treats it as a variable reference locally, while Vercel dashboard variables are not
expanded, so the same password would need two spellings). That is a real trap, documented at the point
someone will hit it.

## The one urgent item

**`.env.local` on disk contains live credentials.** It is correctly listed in `.gitignore` and
`git ls-files` confirms it is **not** committed — the repository is clean. But the file itself holds
what look like real values: a 129-character Neon Postgres connection string, a 23-character admin
password, a 44-character base64 session secret, and a 64-character Upstash token. None are
placeholders.

That is fine for a working directory and not fine for a backup archive. This directory sits inside a
general `code` backup tree that could plausibly be copied to another drive, synced to cloud storage,
zipped and shared, or handed to someone to look through — and the credentials would go with it. A
Postgres connection string is direct database access.

What to do:

- Treat these as exposed if the archive has ever left your machine, and rotate: the Neon password, the
  admin password, `SESSION_SECRET` (which invalidates existing sessions, which is the point), and the
  Upstash token.
- Keep working secrets out of backed-up directories going forward — a password manager, or a secrets
  file outside the tree that the app reads by absolute path.

> **2026-09-25:** still open — rotation is the author's to do. Written up in
> `SECRETS-TODO.md`, which also records that the lengths quoted above are
> slightly off (the connection string is 162 characters, the session secret
> 46) and that nothing has been used to connect to anything.

## Other findings

**1. Confirm what the public API route exposes.** `app/api/orders/[orderId]/route.ts` is outside the
`/admin` matcher, so it is unauthenticated by design — the tracking page needs it. The order id is
therefore the only secret protecting a customer's order details. Two questions worth answering
explicitly in a comment: are order ids unguessable (random, not sequential), and does the response
include only what a customer should see, with no staff notes, internal pricing or phone numbers? A
sequential id would let anyone enumerate every order in the system.

> **2026-09-25: both already true, and already tested.** See correction 3
> above. No change needed.

**2. Rate limiting falls back to in-memory on cold start.** `.env.example` documents this honestly.
Worth being clear about the consequence: on a serverless platform, an in-memory limiter resets per
instance and provides close to no protection against a distributed attempt on the admin login. Since
there is a single shared admin password, the login route is the one that most needs the Redis path to
actually be configured in production. Consider failing loudly at startup if Redis is absent in
production rather than degrading silently.

> **2026-09-25: fixed.** It now fails at `next build`. The premise about a
> shared password is wrong — see correction 2 — but the recommendation was
> right anyway.

**3. A single shared admin password for all staff.** `ADMIN_PASSWORD` is one value that everyone
types, so there is no per-user attribution in the ledger and no way to revoke one person's access
without changing it for everyone. There is a `staff` concept in the code
(`app/admin/staff/`, `lib/staff.ts`), so the model may be richer than the login suggests — worth
confirming whether staff identity is captured on each ledger entry, because for a records system
that is the difference between an audit trail and a log.

> **2026-09-25: premise wrong, both worries right.** See correction 2.
> Revocation was broken and is fixed; attribution was by display name only and
> now carries a staff id.

**4. No `LICENSE`.**

> **2026-09-25: still open**, deliberately — the choice of licence is the
> author's.

## Cleanup

Nothing to remove. No debug output, no analytics, no committed build artifacts. `.gitignore` is
complete and correct. The strings my earlier archive-wide secret scan flagged in
`tests/unit/staff.test.ts` and the README are test fixtures and documentation examples, not real
credentials.

> **2026-09-25: confirmed**, and still true after this pass.

## Action checklist

- [ ] **P1** Rotate the credentials in `.env.local`; stop keeping live secrets inside the backup tree.
      — **author's, see `SECRETS-TODO.md`**
- [x] **P2** Verify order ids are unguessable and the public route returns customer-safe fields only.
      — **verified, no change needed**
- [x] **P2** Fail startup in production when Redis rate limiting is unconfigured, rather than
      degrading to in-memory.
- [x] **P3** Confirm ledger entries record which staff member made them; consider per-user logins.
      — **per-user logins already existed; entries now carry a staff id**
- [ ] **P3** Add a `LICENSE`. — **author's**

Found in this pass and not in the first review:

- [x] **P1** A deactivated account keeps full access until its token expires.
- [x] **P1** Every rate limit is bypassable by varying `X-Forwarded-For`.
- [x] **P2** The in-memory limiter's map grows without bound on attacker-chosen keys.
- [x] **P2** Fourteen of the suite's assertions had never executed on Windows.
- [x] **P3** A 1-in-16 flake in the session-tampering test.

## Notes for a future session

`npm install`, then the dev server; tests run through the configured runner against `tests/`. Read
`.env.example` before touching environment handling — the `$`-expansion note there documents a real
difference between local and Vercel behaviour that has already cost someone an afternoon. The
`fake-sql.ts` helper is what makes the data tests runnable without a database; keep new query code
compatible with it.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs `npm ci`, `tsc --noEmit` and `npm test` on
`ubuntu-latest`. Nothing has been pushed, so it has not run on GitHub yet.
Every job was run before committing, from a fresh clone of this branch, the
way a runner would run it: Linux jobs in a throwaway Ubuntu 24.04 (the image
`ubuntu-latest` uses) with the same tool versions. 355.

It does not run `next build`: collecting page data stops with "DATABASE_URL is
not set", and the workflow holds no secrets. If a build check is wanted, a
dummy `DATABASE_URL` would have to satisfy every import that reads it, which
was not tried.
