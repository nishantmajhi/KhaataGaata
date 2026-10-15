// Seeds a staff account and a few sample orders so you can click around.
// Usage: npm run db:seed
import "./load-env.mjs";
import { neon } from "@neondatabase/serverless";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Checked .env and .env.local in: " + process.cwd() + "\n" +
      "Make sure the file is named exactly .env.local (not .env.local.txt)."
  );
  process.exit(1);
}

const scryptAsync = promisify(scrypt);
const sql = neon(url);

// Mirrors lib/password.ts so the seeded account can actually sign in.
async function hash(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD || "changeme123";

const existing = await sql`select id from staff where username = 'demo' limit 1`;
let demoStaffId;
if (existing.length === 0) {
  const created = await sql`
    insert into staff (username, display_name, password_hash)
    values ('demo', 'Demo Staff', ${await hash(STAFF_PASSWORD)})
    returning id
  `;
  demoStaffId = Number(created[0].id);
  console.log(`Staff account created — username "demo", password "${STAFF_PASSWORD}"`);
} else {
  demoStaffId = Number(existing[0].id);
  console.log('Staff account "demo" already exists, leaving it alone.');
}

const SAMPLES = [
  {
    id: "KG24MB",
    name: "Sunita Shrestha",
    phone: "+977 98XXXXXXXX",
    address: "Jhamsikhel, Lalitpur",
    status: "shipped",
    items: [
      ["A5 ruled, kraft cover", 2, 65000],
      ["A6 plain, indigo cover", 1, 55000],
    ],
    events: [
      ["confirmed", "Payment confirmed, order recorded.", "3 days"],
      ["processing", "Covers stitched and pressed.", "2 days"],
      ["shipped", "Handed to the courier in Patan.", "6 hours"],
    ],
  },
  {
    id: "KG7QRT",
    name: "Bikash Rai",
    phone: "+977 98XXXXXXXX",
    address: "Baneshwor, Kathmandu",
    status: "delivered",
    items: [["B5 dotted, olive cover", 3, 72000]],
    events: [
      ["confirmed", "Payment confirmed, order recorded.", "9 days"],
      ["processing", null, "8 days"],
      ["shipped", null, "6 days"],
      ["out_for_delivery", "Rider left the shop.", "5 days"],
      ["delivered", "Received by the customer.", "5 days"],
    ],
  },
  {
    id: "KG3HNW",
    name: "Anjali Gurung",
    phone: "+977 98XXXXXXXX",
    address: "Pokhara",
    status: "cancelled",
    reason: "Customer changed their mind before dispatch.",
    items: [["A5 ruled, kraft cover", 1, 65000]],
    events: [
      ["confirmed", "Payment confirmed, order recorded.", "4 days"],
      ["processing", null, "3 days"],
      ["cancelled", "Customer changed their mind before dispatch.", "2 days"],
    ],
  },
];

for (const sample of SAMPLES) {
  await sql`delete from orders where order_id = ${sample.id}`;

  const total = sample.items.reduce((sum, [, qty, price]) => sum + qty * price, 0);
  const [order] = await sql`
    insert into orders (order_id, customer_name, customer_phone, address, status,
                        total_paisa, cancelled_reason)
    values (${sample.id}, ${sample.name}, ${sample.phone}, ${sample.address},
            ${sample.status}, ${total}, ${sample.reason ?? null})
    returning id
  `;

  for (const [title, qty, price] of sample.items) {
    await sql`
      insert into order_items (order_id, title, qty, unit_price_paisa)
      values (${order.id}, ${title}, ${qty}, ${price})
    `;
  }

  for (const [status, note, ago] of sample.events) {
    await sql`
      insert into order_events (order_id, status, note, actor_name, actor_staff_id,
                                created_at)
      values (${order.id}, ${status}, ${note}, 'Demo Staff', ${demoStaffId},
              now() - ${ago}::interval)
    `;
  }

  await sql`
    insert into order_audit (order_id, actor_name, actor_staff_id, action, summary)
    values (${order.id}, 'Demo Staff', ${demoStaffId}, 'created', 'Seeded sample order')
  `;
}

console.log(`Seeded ${SAMPLES.length} orders: ${SAMPLES.map((s) => s.id).join(", ")}`);
console.log("Open /track/KG24MB, or sign in at /admin/login");
