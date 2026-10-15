import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { Timeline, formatStamp } from "@/components/Timeline";
import { formatNpr, getAuditTrail, getOrderByPublicId } from "@/lib/orders";
import { isExceptionStatus, normalizeOrderId, statusLabel } from "@/lib/status";
import { StatusForm } from "./StatusForm";
import { CloseForm } from "./CloseForm";
import { CopyId } from "./CopyId";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order · KhaataGaata", robots: { index: false } };

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ created?: string; edited?: string }>;
}) {
  const [{ orderId: raw }, { created, edited }] = await Promise.all([params, searchParams]);
  const orderId = normalizeOrderId(decodeURIComponent(raw));
  const order = orderId ? await getOrderByPublicId(orderId) : null;
  if (!order) notFound();

  const audit = await getAuditTrail(order.id);
  const halted = isExceptionStatus(order.status);

  const banner = created
    ? "Saved — send this ID to the customer"
    : edited
      ? "Changes saved"
      : "Order";

  return (
    <main className="page page-wide">
      <div className="ledger-head">
        <Brand small link />
        <div className="link-row">
          <Link href={`/admin/orders/${order.order_id}/edit`} className="btn btn-sm btn-ghost">
            Edit details
          </Link>
          <Link href="/admin" className="back-link">
            ← Back to ledger
          </Link>
        </div>
      </div>

      <div className="card card-lg">
        <div className="card-header">
          <div className="card-label">{banner}</div>
          <div className="order-meta">
            <h1 className="card-title">{order.customer_name}</h1>
            <span className={`status-badge ${order.status}`}>
              {statusLabel(order.status)}
            </span>
          </div>
          {halted && order.cancelled_reason ? (
            <p className="card-desc">{order.cancelled_reason}</p>
          ) : null}
        </div>

        <div className="card-body">
          <div className="receipt">
            <div className="card-label" style={{ textAlign: "center" }}>
              Order ID
            </div>
            <span className="receipt-id">{order.order_id}</span>
            <CopyId
              orderId={order.order_id}
              customerName={order.customer_name}
              total={formatNpr(order.total_paisa)}
            />
          </div>

          {order.customer_phone || order.address ? (
            <div className="field">
              <div className="label">Delivery</div>
              <p style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
                {order.customer_phone ? (
                  <>
                    {order.customer_phone}
                    <br />
                  </>
                ) : null}
                {order.address}
              </p>
            </div>
          ) : null}

          <div className="label" style={{ marginTop: "1.5rem" }}>
            Items
          </div>
          <table className="ledger" style={{ marginTop: "0.5rem" }}>
            <tbody>
              {order.items.map((item, i) => (
                <tr key={i}>
                  <td style={{ paddingLeft: 0 }}>{item.title}</td>
                  <td className="num">× {item.qty}</td>
                  <td className="num" style={{ paddingRight: 0 }}>
                    {formatNpr(item.qty * item.unit_price_paisa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="total-line">
            <span>Total</span>
            <b>{formatNpr(order.total_paisa)}</b>
          </div>

          <div className="label" style={{ marginTop: "2rem", marginBottom: "0.5rem" }}>
            {halted ? "Put it back on track" : "Move it along"}
          </div>
          <StatusForm orderId={order.order_id} current={order.status} />

          {!halted ? (
            <div style={{ marginTop: "2rem" }}>
              <CloseForm orderId={order.order_id} />
            </div>
          ) : null}
        </div>

        <Timeline status={order.status} events={order.events} />

        <div className="card-body" style={{ borderTop: "1px solid var(--rule)" }}>
          <div className="label">History</div>
          <ul className="audit">
            {audit.map((entry, i) => (
              <li key={i}>
                <span className="audit-who">{entry.actor_name}</span>
                <span className="audit-what">{entry.summary ?? entry.action}</span>
                <span className="audit-when">{formatStamp(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-footer">
          <Link href={`/track/${order.order_id}`} className="back-link">
            View what the customer sees →
          </Link>
          <span className="ledger-phone">Recorded {formatStamp(order.created_at)}</span>
        </div>
      </div>
    </main>
  );
}
