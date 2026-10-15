import { NextResponse } from "next/server";
import { getOrderByPublicId, toPublicOrder } from "@/lib/orders";
import { normalizeOrderId } from "@/lib/status";
import { clientIp, limitLookup } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ip = clientIp(request.headers);
  const { success } = await limitLookup(ip);

  if (!success) {
    return NextResponse.json(
      { error: "Too many lookups. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const { orderId: raw } = await params;
  const orderId = normalizeOrderId(decodeURIComponent(raw));
  if (!orderId) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const order = await getOrderByPublicId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Deliberately not the full order: no customer name, phone or address is
  // exposed on a public endpoint keyed by a short, guessable ID.
  return NextResponse.json(toPublicOrder(order), {
    headers: { "Cache-Control": "no-store" },
  });
}
