import { sql } from "./db";
import {
  generateOrderId,
  isProgressStatus,
  type OrderStatus,
  type ProgressStatus,
} from "./status";

/**
 * Neon hands back timestamptz columns as Date objects. Everything downstream
 * (JSON responses, client props) wants a stable ISO string, so normalize once
 * here rather than guessing at each call site.
 */
function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

export type OrderEvent = {
  status: OrderStatus;
  note: string | null;
  actor_name: string | null;
  created_at: string;
};

export type OrderItem = {
  title: string;
  qty: number;
  unit_price_paisa: number;
};

export type AuditEntry = {
  actor_name: string;
  action: string;
  summary: string | null;
  created_at: string;
};

export type Order = {
  id: number;
  order_id: string;
  customer_name: string;
  customer_phone: string | null;
  address: string | null;
  status: OrderStatus;
  total_paisa: number;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  events: OrderEvent[];
};

/** What the tracking page and the public API return. No name, phone or address. */
export type PublicOrder = {
  order_id: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  events: { status: OrderStatus; note: string | null; created_at: string }[];
};

export async function getOrderByPublicId(orderId: string): Promise<Order | null> {
  const rows = (await sql`
    select id, order_id, customer_name, customer_phone, address,
           status, total_paisa, cancelled_reason, created_at, updated_at
    from orders
    where order_id = ${orderId}
    limit 1
  `) as Record<string, unknown>[];

  if (rows.length === 0) return null;
  const order = rows[0] as unknown as Omit<Order, "items" | "events">;

  const [items, events] = await Promise.all([
    sql`select title, qty, unit_price_paisa
        from order_items where order_id = ${order.id} order by id` as Promise<
      Record<string, unknown>[]
    >,
    sql`select status, note, actor_name, created_at
        from order_events where order_id = ${order.id}
        order by created_at asc, id asc` as Promise<Record<string, unknown>[]>,
  ]);

  return {
    ...order,
    id: Number(order.id),
    created_at: iso(order.created_at),
    updated_at: iso(order.updated_at),
    total_paisa: Number(order.total_paisa),
    items: (items as unknown as OrderItem[]).map((it) => ({
      ...it,
      qty: Number(it.qty),
      unit_price_paisa: Number(it.unit_price_paisa),
    })),
    events: (events as unknown as OrderEvent[]).map((ev) => ({
      ...ev,
      created_at: iso(ev.created_at),
    })),
  };
}

export function toPublicOrder(order: Order): PublicOrder {
  return {
    order_id: order.order_id,
    status: order.status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    // actor_name is staff-only: the customer has no reason to learn which
    // employee handled their parcel.
    events: order.events.map((ev) => ({
      status: ev.status,
      note: ev.note,
      created_at: ev.created_at,
    })),
  };
}

export async function getAuditTrail(orderRowId: number): Promise<AuditEntry[]> {
  const rows = (await sql`
    select actor_name, action, summary, created_at
    from order_audit where order_id = ${orderRowId}
    order by created_at desc, id desc
  `) as unknown as AuditEntry[];
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
}

// Ledger ---------------------------------------------------------------------

export type OrderSummary = {
  order_id: string;
  customer_name: string;
  customer_phone: string | null;
  status: OrderStatus;
  total_paisa: number;
  created_at: string;
  updated_at: string;
};

export type LedgerQuery = {
  search?: string;
  status?: string;
  page?: number;
  perPage?: number;
};

export type LedgerPage = {
  orders: OrderSummary[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
};

export const DEFAULT_PER_PAGE = 25;

function normalizeSearch(raw?: string): string | null {
  const v = (raw ?? "").trim();
  if (v.length === 0) return null;
  // Escape the LIKE wildcards so a customer named "100%" is searchable.
  return v.replace(/([\\%_])/g, "\\$1");
}

export async function listOrdersPage(query: LedgerQuery = {}): Promise<LedgerPage> {
  const perPage = Math.min(Math.max(Math.floor(query.perPage ?? DEFAULT_PER_PAGE), 1), 100);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  const offset = (page - 1) * perPage;

  const search = normalizeSearch(query.search);
  const pattern = search ? `%${search.toLowerCase()}%` : null;
  const status = query.status && query.status !== "all" ? query.status : null;

  // A single query shape with null-guarded predicates keeps this readable and
  // still lets Postgres use the indexes when a filter is actually supplied.
  const rows = (await sql`
    select order_id, customer_name, customer_phone, status,
           total_paisa, created_at, updated_at
    from orders
    where (${pattern}::text is null
           or lower(customer_name) like ${pattern}
           or lower(order_id) like ${pattern}
           or coalesce(customer_phone, '') like ${pattern})
      and (${status}::text is null or status = ${status})
    order by updated_at desc
    limit ${perPage} offset ${offset}
  `) as unknown as OrderSummary[];

  const countRows = (await sql`
    select count(*)::int as n
    from orders
    where (${pattern}::text is null
           or lower(customer_name) like ${pattern}
           or lower(order_id) like ${pattern}
           or coalesce(customer_phone, '') like ${pattern})
      and (${status}::text is null or status = ${status})
  `) as unknown as { n: number }[];

  const total = countRows[0]?.n ?? 0;

  return {
    orders: rows.map((r) => ({
      ...r,
      total_paisa: Number(r.total_paisa),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
    })),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function countByStatus() {
  const rows = (await sql`
    select status, count(*)::int as n from orders group by status
  `) as unknown as { status: OrderStatus; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

// Writes ---------------------------------------------------------------------

export type OrderItemInput = { title: string; qty: number; unitPricePaisa: number };

/**
 * Who performed a write, recorded two ways on purpose.
 *
 * actorName is what the staff pages print, and printing a name is all it was
 * ever good for: nothing makes display names unique, so two people called Ram
 * Bahadur leave indistinguishable entries, and correcting a spelling would
 * leave the old one scattered through the history. actorStaffId is what
 * actually identifies the person, and it is the difference between an audit
 * trail and a log. Both are stored — the id to be right, the name so reading
 * a row does not need a join.
 */
export type Actor = { actorName: string; actorStaffId: number };

export type NewOrderInput = {
  customerName: string;
  customerPhone?: string | null;
  address?: string | null;
  note?: string | null;
  items: OrderItemInput[];
} & Actor;

export function totalOf(items: OrderItemInput[]): number {
  return items.reduce((sum, i) => sum + i.qty * i.unitPricePaisa, 0);
}

export async function createOrder(input: NewOrderInput): Promise<string> {
  const total = totalOf(input.items);

  // Collisions are vanishingly rare with a 32-character alphabet at length 6,
  // but the unique constraint means we should still be ready for one.
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderId = generateOrderId();
    try {
      const rows = (await sql`
        insert into orders (order_id, customer_name, customer_phone, address, status, total_paisa)
        values (${orderId}, ${input.customerName}, ${input.customerPhone || null},
                ${input.address || null}, 'confirmed', ${total})
        returning id
      `) as unknown as { id: number }[];

      const id = Number(rows[0].id);

      for (const item of input.items) {
        await sql`
          insert into order_items (order_id, title, qty, unit_price_paisa)
          values (${id}, ${item.title}, ${item.qty}, ${item.unitPricePaisa})
        `;
      }

      await sql`
        insert into order_events (order_id, status, note, actor_name, actor_staff_id)
        values (${id}, 'confirmed', ${input.note || "Payment confirmed, order recorded."},
                ${input.actorName}, ${input.actorStaffId})
      `;

      await sql`
        insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
        values (${id}, ${input.actorName}, ${input.actorStaffId}, 'created', ${`${input.items.length} item(s), total ${formatNpr(total)}`})
      `;

      return orderId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("orders_order_id_key")) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate an order ID. Try again.");
}

export type EditOrderInput = {
  orderId: string;
  customerName: string;
  customerPhone?: string | null;
  address?: string | null;
  items: OrderItemInput[];
} & Actor;

/**
 * Describes what actually changed, so the audit entry says "address, 2 items"
 * rather than the useless "order edited".
 */
export function describeChanges(before: Order, after: EditOrderInput): string[] {
  const changes: string[] = [];
  if (before.customer_name !== after.customerName) changes.push("name");
  if ((before.customer_phone ?? "") !== (after.customerPhone ?? "")) changes.push("phone");
  if ((before.address ?? "") !== (after.address ?? "")) changes.push("address");

  const sameItems =
    before.items.length === after.items.length &&
    before.items.every(
      (it, i) =>
        it.title === after.items[i].title &&
        it.qty === after.items[i].qty &&
        it.unit_price_paisa === after.items[i].unitPricePaisa
    );
  if (!sameItems) changes.push("items");

  return changes;
}

export async function updateOrder(input: EditOrderInput): Promise<
  { ok: true; changes: string[] } | { ok: false; error: string }
> {
  const before = await getOrderByPublicId(input.orderId);
  if (!before) return { ok: false, error: "No order with that ID." };

  const changes = describeChanges(before, input);
  if (changes.length === 0) return { ok: true, changes: [] };

  const total = totalOf(input.items);

  await sql`
    update orders
    set customer_name = ${input.customerName},
        customer_phone = ${input.customerPhone || null},
        address = ${input.address || null},
        total_paisa = ${total},
        updated_at = now()
    where id = ${before.id}
  `;

  // Items are replaced wholesale rather than diffed: an order has a handful
  // of lines, and reconciling edits row by row buys nothing but bugs.
  if (changes.includes("items")) {
    await sql`delete from order_items where order_id = ${before.id}`;
    for (const item of input.items) {
      await sql`
        insert into order_items (order_id, title, qty, unit_price_paisa)
        values (${before.id}, ${item.title}, ${item.qty}, ${item.unitPricePaisa})
      `;
    }
  }

  await sql`
    insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
    values (${before.id}, ${input.actorName}, ${input.actorStaffId}, 'edited', ${`Changed ${changes.join(", ")}`})
  `;

  return { ok: true, changes };
}

export async function advanceOrder(
  orderId: string,
  status: ProgressStatus,
  opts: Actor & { note?: string | null; backwards?: boolean }
): Promise<boolean> {
  const rows = (await sql`
    update orders set status = ${status}, cancelled_reason = null, updated_at = now()
    where order_id = ${orderId}
    returning id, status
  `) as unknown as { id: number }[];

  if (rows.length === 0) return false;
  const id = Number(rows[0].id);

  await sql`
    insert into order_events (order_id, status, note, actor_name, actor_staff_id)
    values (${id}, ${status}, ${opts.note?.trim() || null}, ${opts.actorName},
            ${opts.actorStaffId})
  `;

  await sql`
    insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
    values (${id}, ${opts.actorName}, ${opts.actorStaffId}, 'status_changed',
            ${`${opts.backwards ? "Moved back to" : "Moved to"} ${status}`})
  `;

  return true;
}

export async function closeOrder(
  orderId: string,
  status: "cancelled" | "refunded",
  opts: Actor & { reason: string }
): Promise<boolean> {
  const rows = (await sql`
    update orders set status = ${status}, cancelled_reason = ${opts.reason},
                      updated_at = now()
    where order_id = ${orderId}
    returning id
  `) as unknown as { id: number }[];

  if (rows.length === 0) return false;
  const id = Number(rows[0].id);

  await sql`
    insert into order_events (order_id, status, note, actor_name, actor_staff_id)
    values (${id}, ${status}, ${opts.reason}, ${opts.actorName}, ${opts.actorStaffId})
  `;

  await sql`
    insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
    values (${id}, ${opts.actorName}, ${opts.actorStaffId}, ${status}, ${opts.reason})
  `;

  return true;
}

/** Puts a cancelled or refunded order back on the delivery track. */
export async function reopenOrder(
  orderId: string,
  status: ProgressStatus,
  opts: Actor & { note?: string | null }
): Promise<boolean> {
  if (!isProgressStatus(status)) return false;

  const rows = (await sql`
    update orders set status = ${status}, cancelled_reason = null, updated_at = now()
    where order_id = ${orderId}
    returning id
  `) as unknown as { id: number }[];

  if (rows.length === 0) return false;
  const id = Number(rows[0].id);

  await sql`
    insert into order_events (order_id, status, note, actor_name, actor_staff_id)
    values (${id}, ${status}, ${opts.note?.trim() || "Order reopened."},
            ${opts.actorName}, ${opts.actorStaffId})
  `;

  await sql`
    insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
    values (${id}, ${opts.actorName}, ${opts.actorStaffId}, 'reopened', ${`Reopened at ${status}`})
  `;

  return true;
}

export function formatNpr(paisa: number): string {
  return `Rs ${(paisa / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
