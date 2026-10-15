import Link from "next/link";
import type { Metadata } from "next";
import { Brand, Footer } from "@/components/Brand";
import { getOrderByPublicId, toPublicOrder } from "@/lib/orders";
import { normalizeOrderId } from "@/lib/status";
import { LiveOrder } from "./LiveOrder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your order · KhaataGaata",
  robots: { index: false, follow: false },
};

export default async function TrackPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId: raw } = await params;
  const orderId = normalizeOrderId(decodeURIComponent(raw));

  // No API_BASE, no CORS, no separate fetch. The page queries Postgres during
  // render and arrives with the timeline already drawn.
  const order = orderId ? await getOrderByPublicId(orderId) : null;

  if (!order) {
    return (
      <main className="page">
        <Brand small link />
        <div className="card">
          <div className="empty">
            <div className="empty-title">No order with that ID</div>
            <p className="empty-desc">
              Check the ID in your confirmation message — it&apos;s 4 to 8 letters and
              numbers. If it still doesn&apos;t work, message us on WhatsApp and
              we&apos;ll look it up.
            </p>
            <Link href="/" className="btn">
              Try another ID
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  return (
    <main className="page">
      <Brand small link />
      <LiveOrder initial={toPublicOrder(order)} />
      <Footer />
    </main>
  );
}
