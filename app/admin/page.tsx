import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatStamp } from "@/components/Timeline";
import { LedgerFilters } from "./LedgerFilters";
import { countByStatus, formatNpr, listOrdersPage } from "@/lib/orders";
import { ALL_STEPS, statusLabel } from "@/lib/status";
import { signOut } from "./actions";
import { currentStaff } from "./session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger · KhaataGaata", robots: { index: false } };

function pageHref(params: { q: string; status: string; page: number }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const [ledger, tally, staff] = await Promise.all([
    listOrdersPage({ search: q, status, page }),
    countByStatus(),
    currentStaff(),
  ]);

  const filtered = q !== "" || status !== "all";
  const openCount = ALL_STEPS.filter(
    (s) => s.key !== "delivered" && s.key !== "cancelled" && s.key !== "refunded"
  ).reduce((sum, s) => sum + (tally[s.key] ?? 0), 0);

  const from = (ledger.page - 1) * ledger.perPage + 1;
  const to = Math.min(ledger.page * ledger.perPage, ledger.total);

  return (
    <main className="page page-wide">
      <div className="ledger-head">
        <Brand small link />
        <div className="link-row">
          <span className="who">Signed in as {staff?.displayName ?? "staff"}</span>
          <Link href="/admin/staff" className="btn btn-sm">
            Staff details
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn btn-sm btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="ledger-head" style={{ marginTop: "-0.5rem" }}>
        <div className="ledger-tally">
          <span>
            <b>{tally.total ?? Object.values(tally).reduce((a, b) => a + b, 0)}</b> recorded
          </span>
          <span>
            <b>{openCount}</b> still moving
          </span>
          {ALL_STEPS.filter((s) => (tally[s.key] ?? 0) > 0).map((s) => (
            <span key={s.key}>
              <b>{tally[s.key]}</b> {s.label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div className="card card-lg">
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <LedgerFilters q={q} status={status} />
        </div>

        {ledger.orders.length === 0 ? (
          <div className="empty">
            <div className="empty-title">
              {filtered ? "Nothing matches that" : "The ledger is empty"}
            </div>
            <p className="empty-desc">
              {filtered
                ? "Try a shorter search, or clear the status filter."
                : "Once a customer pays on WhatsApp, record the order here. You'll get an ID to send back to them."}
            </p>
            {filtered ? (
              <Link href="/admin" className="btn btn-ghost">
                Clear filters
              </Link>
            ) : (
              <Link href="/admin/orders/new" className="btn">
                Record the first order
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Last moved</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.orders.map((o) => (
                    <tr key={o.order_id}>
                      <td>
                        <Link href={`/admin/orders/${o.order_id}`} className="ledger-id">
                          {o.order_id}
                        </Link>
                      </td>
                      <td>
                        <span className="ledger-name">{o.customer_name}</span>
                        {o.customer_phone ? (
                          <span className="ledger-phone">{o.customer_phone}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`status-badge ${o.status}`}>
                          {statusLabel(o.status)}
                        </span>
                      </td>
                      <td className="num">{formatNpr(o.total_paisa)}</td>
                      <td className="num">{formatStamp(o.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-footer">
              <span className="ledger-phone">
                Showing {from}–{to} of {ledger.total}
              </span>
              <div className="link-row">
                {ledger.page > 1 ? (
                  <Link
                    className="btn btn-sm btn-ghost"
                    href={pageHref({ q, status, page: ledger.page - 1 })}
                  >
                    ← Newer
                  </Link>
                ) : null}
                {ledger.page < ledger.pageCount ? (
                  <Link
                    className="btn btn-sm btn-ghost"
                    href={pageHref({ q, status, page: ledger.page + 1 })}
                  >
                    Older →
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <Link href="/admin/orders/new" className="fab" aria-label="Record an order">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 5v14M5 12h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="fab-label" aria-hidden="true">
          Record an order
        </span>
      </Link>
    </main>
  );
}
