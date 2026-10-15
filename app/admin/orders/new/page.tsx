import Link from "next/link";
import { Brand } from "@/components/Brand";
import { OrderForm } from "@/components/OrderForm";
import { addOrder } from "../../actions";

export const metadata = { title: "Record an order · KhaataGaata", robots: { index: false } };

export default function NewOrderPage() {
  return (
    <main className="page page-wide">
      <div className="ledger-head">
        <Brand small link />
        <Link href="/admin" className="back-link">
          ← Back to ledger
        </Link>
      </div>

      <div className="card card-lg">
        <div className="card-header">
          <div className="card-label">New entry</div>
          <h1 className="card-title">Record an order</h1>
          <p className="card-desc">
            Fill this in after the customer&apos;s payment lands. You&apos;ll get an order
            ID to send back on WhatsApp.
          </p>
        </div>
        <div className="card-body">
          <OrderForm
            action={addOrder}
            submitLabel="Save order"
            pendingLabel="Saving…"
            showNote
          />
        </div>
      </div>
    </main>
  );
}
