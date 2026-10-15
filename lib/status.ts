/**
 * The five steps a parcel moves through, in order. These are the only
 * statuses that appear on the customer's timeline.
 */
export const PROGRESS_STEPS = [
  { key: "confirmed", label: "Order confirmed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
] as const;

/**
 * Statuses that end an order without completing it. They sit outside the
 * sequence: an order cancelled while shipped keeps "shipped" as its high-water
 * mark, which is why the timeline is rebuilt from events rather than from the
 * status column alone.
 */
export const EXCEPTION_STEPS = [
  { key: "cancelled", label: "Cancelled" },
  { key: "refunded", label: "Refunded" },
] as const;

export const ALL_STEPS = [...PROGRESS_STEPS, ...EXCEPTION_STEPS];

export type ProgressStatus = (typeof PROGRESS_STEPS)[number]["key"];
export type ExceptionStatus = (typeof EXCEPTION_STEPS)[number]["key"];
export type OrderStatus = ProgressStatus | ExceptionStatus;

const PROGRESS_KEYS = PROGRESS_STEPS.map((s) => s.key) as readonly string[];
const EXCEPTION_KEYS = EXCEPTION_STEPS.map((s) => s.key) as readonly string[];
export const STATUS_KEYS = ALL_STEPS.map((s) => s.key) as readonly string[];

// Kept as an alias so older imports and the timeline keep working.
export const STATUS_STEPS = PROGRESS_STEPS;

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && STATUS_KEYS.includes(v);
}

export function isProgressStatus(v: unknown): v is ProgressStatus {
  return typeof v === "string" && PROGRESS_KEYS.includes(v);
}

export function isExceptionStatus(v: unknown): v is ExceptionStatus {
  return typeof v === "string" && EXCEPTION_KEYS.includes(v);
}

/** Nothing further will happen to an order in one of these states. */
export function isTerminalStatus(v: string): boolean {
  return v === "delivered" || isExceptionStatus(v);
}

export function statusLabel(key: string): string {
  return ALL_STEPS.find((s) => s.key === key)?.label ?? key;
}

/** Position in the five-step sequence, or -1 for cancelled/refunded/unknown. */
export function statusIndex(key: string): number {
  return PROGRESS_STEPS.findIndex((s) => s.key === key);
}

/**
 * How far the order actually got. For a normal order this is just the current
 * status. For a cancelled or refunded one it is the furthest progress status
 * recorded in its events, so the timeline still shows what happened before
 * things went wrong.
 */
export function progressReached(
  status: string,
  events: { status: string }[] = []
): number {
  if (isProgressStatus(status)) return statusIndex(status);
  return events.reduce((furthest, ev) => Math.max(furthest, statusIndex(ev.status)), -1);
}

/**
 * True when moving from `from` to `to` walks back down the sequence. Used to
 * make the staff confirm a correction rather than doing it by mis-click.
 */
export function isBackwardsMove(from: string, to: string): boolean {
  const a = statusIndex(from);
  const b = statusIndex(to);
  return a !== -1 && b !== -1 && b < a;
}

/** Order IDs are 4-8 uppercase alphanumerics. */
export const ORDER_ID_RE = /^[A-Z0-9]{4,8}$/;

export function normalizeOrderId(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return ORDER_ID_RE.test(v) ? v : null;
}

// No I, O, 0 or 1 - these get misread when a customer copies the ID off a
// WhatsApp message or reads it aloud over the phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateOrderId(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

export function normalizeUsername(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return USERNAME_RE.test(v) ? v : null;
}
