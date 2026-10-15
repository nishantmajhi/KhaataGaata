# KhaataGaata — order tracking

A shop records an order, sends the customer a six-character ID over WhatsApp,
and the customer watches it move on a page that updates itself. Built for a
small notebook shop in Kathmandu.

Next.js 15 (App Router) + Neon Postgres + Upstash Redis. Deploys to Vercel.
No credit card needed for any account in this stack.

The original design is preserved exactly: paper grain, ruled lines, Playfair
Display / Lora / DM Mono. The fonts are self-hosted by `next/font` instead of
loaded from Google at runtime.

---

## Contents

- [Quick start](#quick-start)
- [Seeded demo account and orders](#seeded-demo-account-and-orders)
- [Environment variables](#environment-variables)
- [Accounts, sign-in and sessions](#accounts-sign-in-and-sessions)
- [The staff handbook](#the-staff-handbook)
- [What the customer sees](#what-the-customer-sees)
- [Statuses](#statuses)
- [Screen map](#screen-map)
- [Full setup: Neon, Upstash, Vercel](#full-setup)
- [Tests](#tests)
- [Structure](#structure)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Troubleshooting](#troubleshooting)
- [Free tier headroom](#free-tier-headroom)
- [Before you launch: the Vercel Hobby restriction](#before-you-launch-the-vercel-hobby-restriction)

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the values, see below
openssl rand -base64 32        # paste the output into SESSION_SECRET
npm run db:push                # creates the tables
npm run db:seed                # optional: demo account + three sample orders
npm run dev
```

| Where to go | URL |
| --- | --- |
| Customer landing page | <http://localhost:3000> |
| A sample tracking page | <http://localhost:3000/track/KG24MB> |
| Staff sign-in | <http://localhost:3000/admin/login> |
| The ledger (after sign-in) | <http://localhost:3000/admin> |

You need `DATABASE_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET` filled in before
anything will run. The two Upstash variables can stay empty for local work; a
production build refuses to start without them unless you opt out explicitly.

---

## Seeded demo account and orders

`npm run db:seed` exists so you can click around a populated app without typing
in fake orders yourself. It creates one staff login and three orders.

**The seeded login:**

| | |
| --- | --- |
| Username | `demo` |
| Password | `changeme123` |
| Display name | Demo Staff |

Sign in with those at `/admin/login`.

To seed a different password, set `SEED_STAFF_PASSWORD` before running the
script — either in `.env.local`, or inline:

```bash
SEED_STAFF_PASSWORD="a-better-password" npm run db:seed
```

**The seeded orders:**

| Order ID | Customer | Status | Total | Illustrates |
| --- | --- | --- | --- | --- |
| `KG24MB` | Sunita Shrestha | Shipped | Rs 1,850 | An order mid-journey, two line items |
| `KG7QRT` | Bikash Rai | Delivered | Rs 2,160 | A completed order, full timeline |
| `KG3HNW` | Anjali Gurung | Cancelled | Rs 650 | An order stopped part-way, with a reason |

**What re-running the seed does.** The three sample orders are deleted and
rewritten every time, so any edits you make to *them* are lost. Orders you
created yourself are untouched. The `demo` account is left alone if it already
exists, so re-seeding will not reset a password you have changed.

**Do not seed a production database.** `changeme123` is published in this file
and in `scripts/seed.mjs`. If you have already run it against a live shop:
sign in, create your own account on the Staff page, then deactivate `demo`.

---

## Environment variables

Copy `.env.example` to `.env.local` for local work. On Vercel, set the same
names under **Settings → Environment Variables**.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon **pooled** connection string. |
| `ADMIN_PASSWORD` | Yes | One-time setup key for creating the first staff account. Not a login — see below. |
| `SESSION_SECRET` | Yes | Signs the staff session cookie. 16+ characters; use `openssl rand -base64 32`. |
| `UPSTASH_REDIS_REST_URL` | In production | Redis REST endpoint for rate limiting. |
| `UPSTASH_REDIS_REST_TOKEN` | In production | Token for the above. |
| `ALLOW_MEMORY_RATELIMIT` | No | Set to exactly `1` to deploy without Redis anyway. |
| `SEED_STAFF_PASSWORD` | No | Password for the seeded `demo` account. Defaults to `changeme123`. Only read by `npm run db:seed`. |

Without the two Upstash variables the app falls back to an in-memory limiter.
That is fine locally and close to useless in production: each serverless
instance keeps its own counters and a cold start wipes them, so against a
single shared login form there is effectively no limit at all.

So **a production build stops rather than degrading quietly**. Leave the
variables out and `next build` fails with:

> Rate limiting is not configured. Set UPSTASH_REDIS_REST_URL and
> UPSTASH_REDIS_REST_TOKEN, or set ALLOW_MEMORY_RATELIMIT=1 to accept the
> per-instance in-memory fallback.

Deploying without Redis is still allowed — set `ALLOW_MEMORY_RATELIMIT=1` and
it proceeds. The point is that it has to be typed by someone who meant it,
rather than being what a misspelled variable name quietly produces. The value
is checked for exactly `1`, because `0` and `false` are what people set when
they mean the opposite.

**Avoid `$` in `ADMIN_PASSWORD` and `SESSION_SECRET`.** Next.js expands `.env`
files with dotenv-expand, so `"SuperU$3r"` is read as `"SuperU"` — the `$3r` is
treated as a variable reference and vanishes. You can escape it as `\$` in
`.env.local`, but variables set in the Vercel dashboard are *not* expanded, so
the same password would need different spelling in each place. Letters, digits,
`-` and `_` sidestep the problem. `db:push` and `db:seed` print a warning if
they spot an unescaped `$`.

---

## Accounts, sign-in and sessions

### First run on a fresh database

With no accounts in the `staff` table, `/admin` sends you to `/admin/setup`:

1. Enter your `ADMIN_PASSWORD` as the **setup key**.
2. Pick your own name, username and password.
3. You are signed in as that account.

Once one account exists, setup closes permanently and `ADMIN_PASSWORD` is never
used to sign in again. Add colleagues from the Staff page instead.

### Rules

| | |
| --- | --- |
| Username | 3–32 characters: lowercase letters, digits, `.`, `-`, `_`. Normalised to lowercase on entry. |
| Password | 8–200 characters. Length is the only rule — no character-class requirements. |
| Storage | scrypt, salted per account (`lib/password.ts`). Plain passwords are never stored or logged. |
| Session | A signed, httpOnly cookie (`kg_session`) that lasts **12 hours** — one working day. Then you sign in again. The account behind it is re-checked from the database on every admin request, so a session is only as alive as the account. |

### There are no roles

Every signed-in staff member can do everything: record orders, edit them,
cancel or refund, add colleagues, deactivate colleagues. This is deliberate for
a shop of a few people who know each other. The audit trail is what makes it
workable — every change is stamped with a name. If you grow past the point
where that is comfortable, roles are the first thing to add.

### Leaving and locking out

- **Someone leaves.** Deactivate their account on the Staff page. It takes
  effect at once, including on the tab they may still have open: every request
  under `/admin` re-checks the account, so they are bounced to the login page
  on their next click rather than keeping the ledger until the twelve hours
  run out. Their name stays on every past order they touched.
- **You cannot deactivate yourself**, and you cannot deactivate the last active
  account. Both would lock everyone out with no route back except editing the
  database by hand.
- **Forgotten password.** There is no email reset — the shop has no mail
  provider. Any other signed-in staff member can create a fresh account for the
  person and deactivate the old one. If *nobody* can sign in, see
  [Troubleshooting](#troubleshooting).
- **Changing your own password** happens on the Staff page and requires your
  current one.

---

## The staff handbook

This is the whole job, in order.

### 1. A customer messages and pays

The shop takes orders and payment over WhatsApp Business, as it already did.
Nothing in this app touches payment.

### 2. Record the order

Sign in at `/admin/login`. On the ledger, tap the round **+** button in the
bottom-right corner — it stays there as you scroll.

Fill in:

| Field | Required | Notes |
| --- | --- | --- |
| Customer name | Yes | Appears on the ledger and in the WhatsApp message. |
| Phone | No | Searchable from the ledger. Never exposed publicly. |
| Address | No | Staff-only. |
| Notebook / Qty / Rs each | At least one line | Prices in rupees; stored as paisa. Add as many lines as you need. |
| Note | No | Goes on the customer's timeline as the first entry. |

Save, and the app generates an ID like `KG24MB` and opens the order.

### 3. Send the ID to the customer

On the order page, tap **Copy WhatsApp message**. That puts a ready-made
message on your clipboard — greeting, order ID, total, and a tracking link —
and you paste it into the WhatsApp Business app yourself.

This is on purpose. Sending messages through Meta's API needs business
verification, message templates and a payment method. Copy-and-paste needs
none of that.

### 4. Move it along

Open the order from the ledger (tap the ID) and pick the next status. Add a
note when it helps the customer: *"Handed to the courier in Patan."* The note
appears on their timeline; leaving it blank is fine.

- **Moving backwards** — say you marked something Shipped by mistake — is
  allowed, but you must tick a confirmation box. Corrections should be
  deliberate, not a mis-click.
- The customer's open tracking page picks up any change within 15 seconds.

### 5. When something goes wrong

Use **Cancel or refund…** on the order page. You must give a reason and tick
the confirmation box. **The reason is shown to the customer**, so write it for
them: *"Customer changed their mind before dispatch."*

A cancelled order keeps the progress it had already made, so the timeline still
shows what happened before things stopped.

### 6. Reopening

A cancelled or refunded order can be put back on the delivery track: open it
and pick a status under **Reopen at**. Useful when a customer changes their
mind back, or when the wrong order was cancelled.

### 7. Fixing details

**Edit details** on the order page changes the name, phone, address and line
items. Edits are recorded in the staff-only audit trail at the bottom of the
order — the customer's timeline stays a clean delivery narrative and does not
show them.

### 8. Finding things

The ledger searches order ID, customer name and phone, filters by status, and
pages through older orders. The counts along the top (`3 recorded`,
`1 still moving`, …) are live.

### 9. Managing the team

**Staff details** in the ledger header adds accounts, deactivates them, and
changes your own password.

### Two limits you may notice

Both exist to stop a stuck form or a leaked session doing damage quickly:

- **40 writes per minute** per staff member. Past that you get *"That's a lot
  of changes at once. Wait a minute."*
- **5 sign-in attempts per 10 minutes** per address. The address is taken
  from the last entry in `X-Forwarded-For` — the one the hosting platform's
  proxy writes — because the earlier entries are supplied by the caller and
  counting against those would let anyone mint a fresh allowance per request.

---

## What the customer sees

They never sign in. They have a URL and an ID.

- **`/`** — a form where they type their order ID.
- **`/track/<ID>`** — a five-step timeline with dates in Nepal time, the notes
  staff have added, and the order total. If the order was cancelled or
  refunded, the reason is shown.
- The page refreshes itself every 15 seconds while they watch, stops once the
  order is delivered, pauses when the tab is hidden, and backs off to two
  minutes if the network is failing.

**What they never see:** their own name, phone or address is not returned by
the public endpoint, only the timeline and total. Order IDs are short, and
therefore guessable — so nothing personal hangs off one. Names, phones and
addresses live behind the staff session.

---

## Statuses

Five steps in sequence, plus two exits:

| Key | Label | |
| --- | --- | --- |
| `confirmed` | Order confirmed | Set automatically when the order is recorded |
| `processing` | Processing | |
| `shipped` | Shipped | |
| `out_for_delivery` | Out for delivery | |
| `delivered` | Delivered | Terminal — polling stops |
| `cancelled` | Cancelled | Outside the sequence; needs a reason |
| `refunded` | Refunded | Outside the sequence; needs a reason |

---

## Screen map

| Path | Who | What |
| --- | --- | --- |
| `/` | Public | Landing page, order ID lookup |
| `/track/<ID>` | Public | The customer's live timeline |
| `/api/orders/<ID>` | Public | JSON for the timeline. No personal data. Rate limited |
| `/admin/setup` | First run only | Creates the very first account |
| `/admin/login` | Public | Staff sign-in |
| `/admin` | Staff | The ledger: search, filter, page |
| `/admin/orders/new` | Staff | Record an order (the **+** button) |
| `/admin/orders/<ID>` | Staff | One order: timeline, status form, cancel/refund, audit trail |
| `/admin/orders/<ID>/edit` | Staff | Change details and line items |
| `/admin/staff` | Staff | Accounts and your own password |

Everything under `/admin` is guarded by `middleware.ts`, which bounces you to
the login page and remembers where you were headed.

---

## Full setup

### 1. Database — Neon

1. Sign up at [neon.com](https://neon.com). No card.
2. Create a project in the region closest to Nepal (Singapore or Mumbai).
3. Copy the **pooled** connection string into `DATABASE_URL`.
4. `npm run db:push` creates the tables.

### 2. Rate limiting — Upstash *(required to deploy)*

1. Sign up at [upstash.com](https://upstash.com). No card.
2. Create a Redis database in the same region.
3. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### 3. Deploy to Vercel

```bash
git init && git add -A && git commit -m "KhaataGaata"
gh repo create khaatagaata --private --source=. --push
```

Then on [vercel.com](https://vercel.com): **Add New → Project → import the
repo.** Add all the environment variables under **Settings → Environment
Variables** before the first deploy. Framework preset and build command are
detected automatically. Visit `/admin` on the deployed URL and you will land on
the setup page.

**Read the note on Vercel's Hobby terms at the bottom of this file before you
point a real shop at it.**

### Upgrading an existing deployment

`npm run db:push` is the migration. Every statement is re-runnable: constraints
are dropped before being re-added, and new columns use
`add column if not exists`. Existing orders keep their data; rows written
before a column existed simply have nothing in it — old `order_events` rows
have no `actor_name`, and rows from before September 2026 have no
`actor_staff_id`. Neither is guessed at after the fact.

---

## Tests

```bash
npm test              # run once
npm run test:watch    # re-run on save
npm run test:coverage # with a coverage table
```

355 tests, no database required — the Neon driver is faked at the query level,
so the tests exercise the actual SQL the app builds. See `tests/README.md` for
what is and isn't covered.

`npx tsc --noEmit` typechecks, and `npm run build` is worth running before a
deploy: middleware runs on the Edge runtime, where a stray `node:` import
compiles fine under `tsc` and fails only at bundle time.

---

## What replaced what

| Original plan | Now | Why |
| --- | --- | --- |
| FastAPI on Railway | Next.js route handlers + server components | One deploy, one language, one free tier |
| Redis Pub/Sub event bus | *(removed)* | An order changes status ~5 times over several days |
| WebSocket live updates | 15-second polling with backoff | WebSockets on serverless are pinned to one instance with a duration cap |
| Hardcoded `API_BASE` + CORS | Server component queries Postgres directly | Nothing to update between environments |
| WhatsApp Cloud API | WhatsApp Business app + "copy message" button | Outbound templates cost money and need a payment method on Meta |

---

## Structure

```
khaatagaata/
├── app/
│   ├── layout.tsx                  fonts, metadata, paper background
│   ├── page.tsx                    landing + order ID form
│   ├── TrackForm.tsx               client-side ID validation
│   ├── not-found.tsx               shared 404
│   ├── globals.css                 the whole design system, including the "+" button
│   ├── track/
│   │   └── [orderId]/
│   │       ├── page.tsx            server component, queries Postgres
│   │       └── LiveOrder.tsx       polling client wrapper
│   ├── api/
│   │   └── orders/
│   │       └── [orderId]/
│   │           └── route.ts        public JSON lookup, rate limited
│   └── admin/
│       ├── actions.ts              server actions (auth, create, advance, close)
│       ├── session.ts              reads the signed-in staff member
│       ├── page.tsx                the ledger + the floating "+" button
│       ├── LedgerFilters.tsx       search box and status filter
│       ├── login/
│       │   ├── page.tsx
│       │   └── LoginForm.tsx       staff sign in
│       ├── setup/
│       │   ├── page.tsx
│       │   └── SetupForm.tsx       one-time first-account page
│       ├── staff/
│       │   ├── page.tsx
│       │   └── StaffForms.tsx      add, deactivate, change own password
│       └── orders/
│           ├── new/
│           │   └── page.tsx        record an order
│           └── [orderId]/
│               ├── page.tsx        one order, timeline, audit trail
│               ├── StatusForm.tsx  advance, or reopen a closed order
│               ├── CloseForm.tsx   cancel or refund, with a reason
│               ├── CopyId.tsx      builds the WhatsApp message
│               └── edit/
│                   └── page.tsx    change details and line items
├── components/
│   ├── Brand.tsx                   brand mark and footer
│   ├── OrderForm.tsx               shared by "new" and "edit"
│   └── Timeline.tsx                the five-step timeline
├── lib/
│   ├── db.ts                       Neon client
│   ├── orders.ts                   all SQL for orders
│   ├── staff.ts                    all SQL for accounts
│   ├── staff-status.ts             is this account still active? (edge-safe)
│   ├── status.ts                   status list, ID validation and generation
│   ├── auth.ts                     signed session cookie, setup key check
│   ├── password.ts                 scrypt hashing and the password floor
│   ├── ratelimit.ts                Upstash, and the key everything counts against
│   └── memory-limiter.ts           the bounded in-memory fallback
├── db/
│   └── schema.sql                  five tables, every statement re-runnable
├── scripts/
│   ├── load-env.mjs                reads .env the way Next does
│   ├── push-schema.mjs             npm run db:push
│   └── seed.mjs                    npm run db:seed — demo account, sample orders
├── tests/                          355 tests, no database — see tests/README.md
│   ├── unit/                       status, auth, staff, orders, ratelimit, env
│   ├── components/                 Timeline, LiveOrder, the two forms
│   ├── api/                        route handler, middleware, server actions
│   ├── integration/                schema.sql still agrees with the code
│   ├── helpers/fake-sql.ts         stands in for the Neon driver
│   └── setup.ts                    jsdom + testing-library
├── middleware.ts                   guards everything under /admin
├── next.config.mjs
├── vitest.config.ts
├── tsconfig.json
├── package.json
├── .env.example                    every variable, with notes
└── SECRETS-TODO.md                 credentials on disk to rotate — read this first
```

---

## Design decisions worth knowing

**Order IDs avoid `I`, `O`, `0` and `1`.** Customers read these aloud over the
phone and copy them out of WhatsApp messages. Six characters from a 32-symbol
alphabet is about a billion combinations.

**The public API returns no personal data.** Order IDs are short and therefore
guessable, so `/api/orders/<ID>` deliberately omits name, phone and address.

**`order_events` is append-only.** It draws the customer's timeline and doubles
as an audit trail — you can always see when an order moved.

**`order_audit` is separate and staff-only.** Corrections and edits belong in
the shop's history but not in the customer's narrative.

**Every entry records a staff id as well as a name.** The name is what the page
prints; the id is what identifies the person. Nothing makes display names
unique, so two people with the same one would otherwise leave entries nobody
could tell apart, and a corrected spelling would leave the old one scattered
through the history.

**A session is checked against the database, not just verified.** The cookie is
a self-contained JWT, so it cannot know the account was switched off after it
was issued. Both gates — `middleware.ts` for reads, `requireStaff()` for
writes — ask whether the account is still active, which costs one indexed
lookup and is what makes the deactivate button mean anything.

**The rate-limit key is the address the proxy vouched for.** `X-Forwarded-For`
is a list each hop appends to, so the leftmost entry is whatever the caller
sent. Counting against that would not weaken the limits, it would remove them.
Behind a chain of proxies the rightmost entry is the proxy rather than the
visitor, which lumps people together — the safe direction for a limiter to be
wrong in.

**Money is stored in paisa as integers.** No floats anywhere near a total.

**A failed sign-in is deliberately slow.** An unknown username still runs a
scrypt hash against a decoy, so it cannot be told apart from a wrong password
by timing. Deactivated accounts fail with the same message as wrong
credentials, for the same reason.

**Timestamps are formatted in `Asia/Kathmandu` explicitly.** Without a fixed
time zone the server and browser would render different strings and React would
report a hydration mismatch.

**Polling stops when it should.** It halts on delivery, pauses on hidden tabs,
and backs off exponentially on errors up to two minutes.

---

## Troubleshooting

**`DATABASE_URL is not set` when running `db:push` or `db:seed`.** The scripts
read `.env` and `.env.local` from the project root. Check the file is named
exactly `.env.local` — Windows will happily save it as `.env.local.txt`.

**Nobody can sign in and there is no working account.** Deactivate is
guarded so this should not happen, but if it does, reactivate an account
directly in the Neon SQL editor:

```sql
update staff set is_active = true where username = 'demo';
```

To start over completely, `delete from staff;` reopens `/admin/setup` and lets
you create a first account again with `ADMIN_PASSWORD`. Orders are untouched.

**`/admin/setup` says accounts already exist.** That page only runs once, by
design. Sign in instead, or clear the `staff` table as above.

**The setup key is rejected but `ADMIN_PASSWORD` looks right.** Check for a `$`
in the value — see [Environment variables](#environment-variables).

**Signed out unexpectedly.** Sessions last 12 hours. Changing `SESSION_SECRET`
also invalidates every existing session immediately.

**"Too many attempts. Wait ten minutes."** Five failed sign-ins from one IP.
Without Upstash configured this counter is per serverless instance and resets
on cold start.

**A seeded order looks wrong or is missing.** Re-run `npm run db:seed`; the
three samples are rewritten every time.

---

## Free tier headroom

| Service | Free allowance | Roughly |
| --- | --- | --- |
| Vercel Hobby | 100 GB transfer, 1M function invocations / month | Far more than a shop needs |
| Neon | 0.5 GB storage, 100 compute-hours / project | Tens of thousands of orders |
| Upstash | 256 MB, 500K commands / month | ~160,000 page views |

Neon scales to zero after 5 minutes idle, so a quiet week costs no compute
hours at all.

---

## Before you launch: the Vercel Hobby restriction

Vercel's Fair Use Guidelines limit the Hobby plan to personal, non-commercial
projects, and they define commercial broadly enough to include processing
payment and advertising a product. A notebook shop qualifies.

Three honest options:

1. **Pay for Vercel Pro** ($20/month) when the shop is earning.
2. **Move to Cloudflare Workers**, which has no commercial-use restriction on
   its free plan (100,000 requests/day). This codebase runs there via
   [OpenNext](https://opennext.js.org/cloudflare) — `npx opennextjs-cloudflare`.
   Neon and Upstash both work from Workers; Upstash specifically because it
   speaks HTTP rather than raw TCP, which Workers don't allow outbound.
3. **Stay on Hobby** while you're testing with friends and family, and move
   before you advertise.

Nothing in this code is Vercel-specific, so option 2 stays open.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
