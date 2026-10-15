# Tests

```bash
npm test              # run once
npm run test:watch    # re-run on save
npm run test:coverage # with a coverage table
```

No database is required. `tests/helpers/fake-sql.ts` stands in for the Neon
driver: it records every statement, substitutes `$1`/`$2` the way the real
driver does, and lets a test route statements to canned rows by regex. That
means the tests exercise the actual SQL the app builds, not a reimplementation
of it.

## Layout

| Path | Covers |
| --- | --- |
| `unit/status.test.ts` | Order ID validation and generation, status helpers |
| `unit/auth.test.ts` | scrypt hashing, session tokens carrying staff identity |
| `unit/staff.test.ts` | Staff accounts: creation, login, deactivation |
| `unit/orders.test.ts` | Every query in the data layer, via the fake driver |
| `unit/ratelimit.test.ts` | The limiter budgets, exercised through the in-memory fallback |
| `unit/ratelimit-config.test.ts` | That production refuses to start without Redis configured |
| `unit/memory-limiter.test.ts` | The fallback limiter itself: windows, sweeping, capacity |
| `unit/clientip.test.ts` | The key every limit counts against, and why it is not spoofable |
| `unit/load-env.test.ts` | `.env` parsing: BOM, CRLF, quotes, `# Tests

```bash
npm test              # run once
npm run test:watch    # re-run on save
npm run test:coverage # with a coverage table
```

No database is required. `tests/helpers/fake-sql.ts` stands in for the Neon
driver: it records every statement, substitutes `$1`/`$2` the way the real
driver does, and lets a test route statements to canned rows by regex. That
means the tests exercise the actual SQL the app builds, not a reimplementation
of it.

## Layout

| Path | Covers |
| --- | --- |
| `unit/status.test.ts` | Order ID validation and generation, status helpers |
| `unit/auth.test.ts` | scrypt hashing, session tokens carrying staff identity |
| `unit/staff.test.ts` | Staff accounts: creation, login, deactivation |
| `unit/orders.test.ts` | Every query in the data layer, via the fake driver |
 expansion |
| `components/Timeline.test.tsx` | Timeline states and Kathmandu time formatting |
| `components/LiveOrder.test.tsx` | Polling: intervals, stop conditions, backoff |
| `components/forms.test.tsx` | Customer lookup form, staff order form |
| `api/orders-route.test.ts` | Public lookup endpoint, including what it withholds |
| `api/middleware.test.ts` | The `/admin` guard |
| `api/actions.test.ts` | Server actions: sign in, create, edit, advance, cancel, staff |
| `api/revocation.test.ts` | That deactivating an account ends the session already open |
| `integration/schema.test.ts` | That `db/schema.sql` still agrees with the code |

## What these are really protecting

A few tests exist because of a specific bug or a specific decision, and they
will look strange without that context:

- **`auth.test.ts` — the dotenv-expand case.** Next.js expands `.env` files, so
  `ADMIN_PASSWORD="SuperU$3r"` arrives as `"SuperU"` and nobody can log in.
  This cost an afternoon once. The test pins the behaviour so it is discovered
  by a failing test rather than a locked-out staff member.

- **`orders.test.ts` — bigint coercion.** Postgres returns `bigint` as a
  string. Left alone, `qty * unit_price_paisa` concatenates instead of
  multiplying, and a customer sees a wrong total.

- **`orders.test.ts` and `orders-route.test.ts` — the PII assertions.** Order
  IDs are six characters, so they are guessable. Both tests assert on the
  serialised response that no name, phone, address, item or total appears.
  If someone adds a field to `PublicOrder`, these fail loudly.

- **`Timeline.test.tsx` — the +05:45 offset.** Kathmandu is 45 minutes off the
  hour. A refactor to a whole-hour offset would pass a casual eyeball and fail
  this test.

- **`LiveOrder.test.tsx` — the stop conditions.** Polling replaced a WebSocket,
  and polling that never stops is worse than the thing it replaced. These
  assert it halts on delivery, pauses on a hidden tab, and backs off on errors.

- **`staff.test.ts` — the timing decoy.** An unknown username must not answer
  faster than a wrong password, or the login form becomes an account-
  enumeration oracle. The first version of this used a placeholder hash, which
  `verifyPassword` rejected instantly — the test caught it. It now measures the
  two paths as a ratio rather than an absolute time, so it is not flaky.

- **`revocation.test.ts` — the whole file.** The session is a self-contained
  JWT with a twelve-hour life, so nothing in the token can express "this
  account was switched off an hour ago". Before September 2026 the only
  `is_active` check lived in `authenticate()`, which is on the sign-in path —
  the one path a person who is already signed in never takes again. Every
  assertion here succeeded against that code, including the worst of them:
  somebody deactivated at nine in the morning reactivating themselves from the
  tab still open in their browser.

- **`clientip.test.ts` — the last hop, not the first.** `X-Forwarded-For` is a
  list each proxy appends to, so the leftmost entry is whatever the caller
  sent. Keying the rate limits on it did not weaken them, it removed them: a
  different first entry per request is a fresh allowance per request. Two
  assertions in `ratelimit.test.ts` used to require the old behaviour by name
  and are corrected in place with a note, because a test that asserts a bug is
  worse than no test.

- **`auth.test.ts` — flipping the first character of a signature, not the
  last.** An HS256 signature is 32 bytes, which base64url-encodes to 43
  characters, and the last one carries only four significant bits; the other
  two are padding. Swapping it for a neighbour that differs only in those bits
  produces a different string that decodes to the same signature, so the
  "tampered" token verifies and the assertion fails. That is what the test
  used to do, and it failed one run in sixteen — measured at 97 of 1600 tokens
  with distinct payloads. Note that the payload has to vary to measure it:
  identical input inside the same second gives an identical token. A second
  test now asserts the padding equivalence directly, so the subtlety is pinned
  rather than merely stepped around.

- **`actions.test.ts` — the backwards-move guard.** Moving an order back down
  the sequence is a legitimate correction and a common mis-click, so it is
  allowed but never silent. The test asserts nothing is written until the
  staff member ticks the box.

- **`orders.test.ts` — `describeChanges` and the null/empty case.** A cleared
  form field arrives as `""` while the database holds `null`. Without treating
  them as equal, opening and saving an unchanged form would log a phantom edit
  against someone's name.

- **`status.test.ts` — `progressReached`.** An order cancelled while shipped
  keeps "shipped" as its high-water mark, so the customer still sees what
  happened rather than an empty timeline.

- **`schema.test.ts` — drift.** The status list lives in two places: a
  TypeScript array and two SQL check constraints. These tests fail if they
  stop matching, which otherwise surfaces as a runtime insert error.

## What is not covered

Deliberate gaps, so nobody assumes more safety than exists:

- **No end-to-end run against real Postgres.** The fake driver checks the SQL
  we build, not that Neon accepts it. `npm run db:push` against a scratch Neon
  branch is the real check.
- **No browser-level test.** Nothing drives an actual browser through
  record-order → copy message → customer sees the update. Playwright would be
  the tool if this grows.
- **Server components are not rendered.** `app/**/page.tsx` files are thin —
  they await params, call a query, and render tested components. The queries
  and components underneath are covered; the assembly is not.
- **`push-schema.mjs` and `seed.mjs` are not covered.** They run as separate
  processes. They were verified by hand against a mocked Neon endpoint.
- **Nothing here catches an Edge-runtime import.** `middleware.ts` runs on the
  Edge runtime, where a `node:` import type-checks and unit-tests perfectly
  well and then fails the production bundle. Only `npm run build` sees it;
  this happened once, on the commit that added the account check to the
  middleware, and all 339 tests were green at the time.
- **The rate limiters are only exercised through the in-memory path.** No test
  talks to Upstash, so what is verified is the budgets and the fallback, not
  that the Upstash sliding window agrees with them.

## Adding a test that touches the database

`vi.mock` is hoisted above every `const`, so the fake has to be built inside
`vi.hoisted`:

```ts
const fake = await vi.hoisted(async () => {
  const { createFakeSql } = await import("../helpers/fake-sql");
  return createFakeSql();
});
vi.mock("@/lib/db", () => ({ sql: fake.sql }));

// import AFTER the mock is registered
const { getOrderByPublicId } = await import("@/lib/orders");

fake.when(/from orders/i, () => [{ id: 1, order_id: "KG24MB" /* … */ }]);
```

Then assert on what was sent:

```ts
fake.find(/from orders/i)?.params;  // bound parameters
fake.all(/insert into order_items/i); // every matching statement
```
