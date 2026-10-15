"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  SESSION_COOKIE,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
  setupKeyMatches,
  type Session,
} from "@/lib/auth";
import {
  advanceOrder,
  closeOrder,
  createOrder,
  getOrderByPublicId,
  reopenOrder,
  updateOrder,
  type OrderItemInput,
} from "@/lib/orders";
import {
  authenticate,
  changePassword,
  countActiveStaff,
  countStaff,
  createStaff,
  isStaffActive,
  setStaffActive,
} from "@/lib/staff";
import { passwordProblem } from "@/lib/password";
import {
  isBackwardsMove,
  isExceptionStatus,
  isProgressStatus,
  normalizeOrderId,
  normalizeUsername,
  statusLabel,
} from "@/lib/status";
import { clientIp, limitAdminWrite, limitLogin } from "@/lib/ratelimit";

export type FormState = { error?: string; ok?: string };

// Session helpers -------------------------------------------------------------

async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Every write goes through this: it proves there is a signed-in staff member,
 * gives the action their name for the audit trail, and applies the write
 * rate limit keyed to that person rather than to a shared address.
 */
async function requireStaff(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Your session expired. Sign in again." };

  // The token says who they were when they signed in, not whether they are
  // still allowed in. Deactivating an account has to stop the session already
  // open in that person's browser, not merely their next sign-in.
  if (!(await isStaffActive(session.staffId))) {
    return { ok: false, error: "This account is no longer active. Sign in again." };
  }

  const { success } = await limitAdminWrite(`staff:${session.staffId}`);
  if (!success) {
    return { ok: false, error: "That's a lot of changes at once. Wait a minute." };
  }
  return { ok: true, session };
}

async function startSession(staff: { id: number; username: string; display_name: string }) {
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    await createSessionToken({
      staffId: staff.id,
      username: staff.username,
      displayName: staff.display_name,
    }),
    sessionCookieOptions
  );
}

// Sign in / out ---------------------------------------------------------------

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = clientIp(await headers());
  const { success } = await limitLogin(ip);
  if (!success) return { error: "Too many attempts. Wait ten minutes." };

  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");

  // One message for every failure mode, so the form never reveals which
  // usernames exist or which accounts have been deactivated.
  const failure = { error: "That username and password don't match." };
  if (!username || !password) return failure;

  const staff = await authenticate(username, password);
  if (!staff) return failure;

  await startSession(staff);

  const next = String(formData.get("next") ?? "/admin");
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function signOut() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

// First-run setup -------------------------------------------------------------

export async function createFirstStaff(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const ip = clientIp(await headers());
  const { success } = await limitLogin(ip);
  if (!success) return { error: "Too many attempts. Wait ten minutes." };

  // Setup is only reachable while the shop has no accounts at all.
  if ((await countStaff()) > 0) {
    return { error: "Accounts already exist. Sign in instead." };
  }

  if (!setupKeyMatches(String(formData.get("setupKey") ?? ""))) {
    return { error: "That setup key doesn't match ADMIN_PASSWORD." };
  }

  const result = await saveStaff(formData);
  if ("error" in result) return { error: result.error };

  await startSession({
    id: result.id,
    username: result.username,
    display_name: result.displayName,
  });
  redirect("/admin");
}

async function saveStaff(
  formData: FormData
): Promise<{ id: number; username: string; displayName: string } | { error: string }> {
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username) {
    return {
      error: "Usernames are 3–32 characters: lowercase letters, digits, dot, dash, underscore.",
    };
  }
  if (!displayName) return { error: "Add the person's name." };

  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const created = await createStaff({ username, displayName, password });
  if ("error" in created) return created;
  return { id: created.id, username, displayName };
}

// Staff management ------------------------------------------------------------

export async function addStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const result = await saveStaff(formData);
  if ("error" in result) return { error: result.error };

  revalidatePath("/admin/staff");
  return { ok: `Added ${result.displayName}.` };
}

export async function toggleStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const id = Number(formData.get("staffId"));
  const activate = String(formData.get("activate")) === "true";
  if (!Number.isInteger(id)) return { error: "That account doesn't exist." };

  if (!activate) {
    if (id === auth.session.staffId) {
      return { error: "You can't deactivate your own account." };
    }
    // Losing the last active account would lock everyone out with no way
    // back in short of editing the database by hand.
    if ((await countActiveStaff()) <= 1) {
      return { error: "That's the last active account. Add another first." };
    }
  }

  const done = await setStaffActive(id, activate);
  if (!done) return { error: "That account doesn't exist." };

  revalidatePath("/admin/staff");
  return { ok: activate ? "Account reactivated." : "Account deactivated." };
}

export async function changeOwnPassword(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");

  if (!(await authenticate(auth.session.username, current))) {
    return { error: "Your current password doesn't match." };
  }
  const problem = passwordProblem(next);
  if (problem) return { error: problem };

  await changePassword(auth.session.staffId, next);
  return { ok: "Password changed." };
}

// Orders ----------------------------------------------------------------------

function readItems(formData: FormData): OrderItemInput[] {
  const titles = formData.getAll("itemTitle").map(String);
  const qtys = formData.getAll("itemQty").map(String);
  const prices = formData.getAll("itemPrice").map(String);

  return titles
    .map((title, i) => ({
      title: title.trim(),
      qty: Math.max(1, Math.floor(Number(qtys[i]) || 1)),
      // Rupees in the form, paisa in the database - integer money only.
      unitPricePaisa: Math.round((Number(prices[i]) || 0) * 100),
    }))
    .filter((item) => item.title.length > 0);
}

export async function addOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) return { error: "Add the customer's name." };

  const items = readItems(formData);
  if (items.length === 0) return { error: "Add at least one item." };

  let orderId: string;
  try {
    orderId = await createOrder({
      customerName,
      customerPhone: String(formData.get("customerPhone") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
      items,
      actorName: auth.session.displayName,
      actorStaffId: auth.session.staffId,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the order." };
  }

  revalidatePath("/admin");
  redirect(`/admin/orders/${orderId}?created=1`);
}

export async function editOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const orderId = normalizeOrderId(String(formData.get("orderId") ?? ""));
  if (!orderId) return { error: "That order ID isn't valid." };

  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) return { error: "Add the customer's name." };

  const items = readItems(formData);
  if (items.length === 0) return { error: "Add at least one item." };

  const result = await updateOrder({
    orderId,
    customerName,
    customerPhone: String(formData.get("customerPhone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    items,
    actorName: auth.session.displayName,
    actorStaffId: auth.session.staffId,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/track/${orderId}`);
  redirect(`/admin/orders/${orderId}?edited=${result.changes.length}`);
}

export async function updateStatus(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const orderId = normalizeOrderId(String(formData.get("orderId") ?? ""));
  const status = String(formData.get("status") ?? "");
  if (!orderId) return { error: "That order ID isn't valid." };
  if (!isProgressStatus(status)) return { error: "Pick a status from the list." };

  const order = await getOrderByPublicId(orderId);
  if (!order) return { error: "No order with that ID." };

  const note = String(formData.get("note") ?? "").trim();
  const confirmed = String(formData.get("confirmBackwards")) === "yes";
  const backwards = isBackwardsMove(order.status, status);

  // Moving a parcel backwards is a legitimate correction and a common
  // mis-click, so it is allowed but never silent.
  if (backwards && !confirmed) {
    return {
      error: `That moves the order back from ${statusLabel(order.status)} to ${statusLabel(
        status
      )}. Tick the box to confirm.`,
    };
  }

  const reopening = isExceptionStatus(order.status);
  const done = reopening
    ? await reopenOrder(orderId, status, {
        actorName: auth.session.displayName,
        actorStaffId: auth.session.staffId,
        note: note || null,
      })
    : await advanceOrder(orderId, status, {
        note: note || null,
        actorName: auth.session.displayName,
        actorStaffId: auth.session.staffId,
        backwards,
      });

  if (!done) return { error: "No order with that ID." };

  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/track/${orderId}`);
  return { ok: reopening ? "Order reopened." : `Moved to ${statusLabel(status)}.` };
}

export async function closeOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await requireStaff();
  if (!auth.ok) return { error: auth.error };

  const orderId = normalizeOrderId(String(formData.get("orderId") ?? ""));
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!orderId) return { error: "That order ID isn't valid." };
  if (status !== "cancelled" && status !== "refunded") {
    return { error: "Choose cancel or refund." };
  }
  // The reason is shown to the customer on their tracking page, so an empty
  // one would leave them staring at a status with no explanation.
  if (!reason) return { error: "Give a reason — the customer sees it." };
  if (String(formData.get("confirmClose")) !== "yes") {
    return { error: "Tick the box to confirm." };
  }

  const done = await closeOrder(orderId, status, {
    reason,
    actorName: auth.session.displayName,
    actorStaffId: auth.session.staffId,
  });
  if (!done) return { error: "No order with that ID." };

  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/track/${orderId}`);
  return { ok: status === "cancelled" ? "Order cancelled." : "Order marked refunded." };
}
