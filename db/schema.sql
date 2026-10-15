-- KhaataGaata schema
-- Run against your Neon database:  npm run db:push
--
-- Every statement is written to be re-runnable, so this file doubles as the
-- migration for an existing database. Constraints are dropped before being
-- re-added, because Postgres has no "add constraint if not exists".

-- Staff ---------------------------------------------------------------------
-- Each person who touches an order has their own login, so the audit log can
-- name them. Passwords are scrypt hashes; see lib/password.ts.
create table if not exists staff (
  id            bigserial primary key,
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  constraint staff_username_format check (username ~ '^[a-z0-9_.-]{3,32}$')
);

-- Orders --------------------------------------------------------------------
create table if not exists orders (
  id            bigserial primary key,
  order_id      text not null unique,
  customer_name text not null,
  customer_phone text,
  address       text,
  status        text not null default 'confirmed',
  total_paisa   bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_order_id_format check (order_id ~ '^[A-Z0-9]{4,8}$')
);

-- Added after the first release; harmless to re-run.
alter table orders add column if not exists cancelled_reason text;

-- 'cancelled' and 'refunded' sit outside the five-step delivery sequence. An
-- order in one of those states keeps whatever progress it had reached, which
-- is why the timeline is rebuilt from order_events rather than this column.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (
  status in ('confirmed','processing','shipped','out_for_delivery','delivered',
             'cancelled','refunded')
);

create table if not exists order_items (
  id               bigserial primary key,
  order_id         bigint not null references orders(id) on delete cascade,
  title            text not null,
  qty              integer not null default 1 check (qty > 0),
  unit_price_paisa bigint not null default 0
);

-- Order events --------------------------------------------------------------
-- Append-only. Draws the customer timeline and records who moved the order.
create table if not exists order_events (
  id         bigserial primary key,
  order_id   bigint not null references orders(id) on delete cascade,
  status     text not null,
  note       text,
  created_at timestamptz not null default now()
);

alter table order_events add column if not exists actor_name text;

alter table order_events drop constraint if exists order_events_status_check;
alter table order_events add constraint order_events_status_check check (
  status in ('confirmed','processing','shipped','out_for_delivery','delivered',
             'cancelled','refunded')
);

-- Audit log -----------------------------------------------------------------
-- Staff-only. Records edits and corrections the customer should not see, so
-- the customer timeline stays a clean delivery narrative while the shop keeps
-- a full history of who changed what.
create table if not exists order_audit (
  id         bigserial primary key,
  order_id   bigint not null references orders(id) on delete cascade,
  actor_name text not null,
  action     text not null,
  summary    text,
  created_at timestamptz not null default now(),
  constraint order_audit_action_check check (
    action in ('created','edited','status_changed','cancelled','refunded','reopened')
  )
);

-- Indexes -------------------------------------------------------------------
create index if not exists order_items_order_id_idx  on order_items(order_id);
create index if not exists order_events_order_id_idx on order_events(order_id, created_at);
create index if not exists order_audit_order_id_idx  on order_audit(order_id, created_at desc);
create index if not exists orders_created_at_idx     on orders(created_at desc);
create index if not exists orders_updated_at_idx     on orders(updated_at desc);
create index if not exists orders_status_idx         on orders(status);

-- Powers the ledger search box. lower() matches the queries in lib/orders.ts
-- so Postgres can use the index rather than scanning every row.
create index if not exists orders_customer_name_idx on orders(lower(customer_name));
create index if not exists orders_phone_idx         on orders(customer_phone);

-- Who did it, by row rather than by name -------------------------------------
-- actor_name is a display name, and nothing makes display names unique: two
-- people called Ram Bahadur get indistinguishable entries, and a name that is
-- later corrected leaves the old spelling scattered through the history. The
-- id is what actually identifies a person. Nullable, because rows written
-- before this column existed cannot be attributed retrospectively — a guess
-- there would be worse than a blank. Added after the first release; harmless
-- to re-run.
alter table order_events add column if not exists
  actor_staff_id bigint references staff(id) on delete set null;
alter table order_audit  add column if not exists
  actor_staff_id bigint references staff(id) on delete set null;

create index if not exists order_audit_actor_idx on order_audit(actor_staff_id);
