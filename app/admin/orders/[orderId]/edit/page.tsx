import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { OrderForm } from "@/components/OrderForm";
import { getOrderByPublicId } from "@/lib/orders";
import { normalizeOrderId } from "@/lib/status";
import { editOrder } from "../../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit order · KhaataGaata", robots: { index: false } };

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId: raw } = await params;
  const orderId = normalizeOrderId(decodeURIComponent(raw));
  const order = orderId ? await getOrderByPublicId(orderId) : null;
  if (!order) notFound();

  return (
    <main className="page page-wide">
      <div className="ledger-head">
        <Brand small link />
        <Link href={`/admin/orders/${order.order_id}`} className="back-link">
          ← Back to order
        </Link>
      </div>

      <div className="card card-lg">
        <div className="card-header">
          <div className="card-label">Correcting {order.order_id}</div>
          <h1 className="card-title">Edit order</h1>
          <p className="card-desc">
            Fixing a typo or a changed address. The delivery status stays where it is, and
            the change is recorded against your name.
          </p>
        </div>
        <div className="card-body">
          <OrderForm
            action={editOrder}
            orderId={order.order_id}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            defaults={{
              customerName: order.customer_name,
              customerPhone: order.customer_phone ?? "",
              address: order.address ?? "",
              items: order.items.map((it) => ({
                title: it.title,
                qty: String(it.qty),
                price: String(it.unit_price_paisa / 100),
              })),
            }}
          />
        </div>
      </div>
    </main>
  );
}
