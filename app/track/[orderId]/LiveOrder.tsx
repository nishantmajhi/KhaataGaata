"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Timeline } from "@/components/Timeline";
import { isTerminalStatus, statusLabel } from "@/lib/status";
import type { PublicOrder } from "@/lib/orders";

const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;

export function LiveOrder({ initial }: { initial: PublicOrder }) {
  const [order, setOrder] = useState(initial);
  const [connected, setConnected] = useState(true);
  const backoff = useRef(POLL_MS);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      // Delivered, cancelled and refunded are all final, so stop asking.
      if (isTerminalStatus(order.status)) return;
      // A hidden tab is a tab nobody is reading. Skip the round trip.
      if (document.visibilityState !== "visible") {
        timer = setTimeout(tick, POLL_MS);
        return;
      }

      try {
        const res = await fetch(`/api/orders/${initial.order_id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as PublicOrder;
        if (cancelled) return;
        setOrder(next);
        setConnected(true);
        backoff.current = POLL_MS;
      } catch {
        if (cancelled) return;
        // Rate limited or offline: back off instead of hammering.
        setConnected(false);
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
      }
      if (!cancelled) timer = setTimeout(tick, backoff.current);
    }

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initial.order_id, order.status]);

  const isFinal = isTerminalStatus(order.status);
  const closed = order.status === "cancelled" || order.status === "refunded";

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-label">Order details</div>
        <div className="order-meta">
          <h1 className="card-title">Order ID</h1>
          <div className="order-id-badge">{order.order_id}</div>
        </div>

        <div className={`status-badge full ${order.status}`}>
          <span className="status-dot" />
          <span>{statusLabel(order.status)}</span>
        </div>

        <div
          className={`live-badge${connected && !isFinal ? "" : " stale"}`}
          aria-live="polite"
        >
          <span className="live-dot" />
          {closed
            ? `This order was ${order.status}`
            : isFinal
              ? "Delivered — this order is complete"
              : connected
                ? "Updating automatically"
                : "Reconnecting…"}
        </div>
      </div>

      <Timeline status={order.status} events={order.events} />

      <div className="card-footer">
        <Link href="/" className="back-link">
          ← Track another order
        </Link>
      </div>
    </div>
  );
}
