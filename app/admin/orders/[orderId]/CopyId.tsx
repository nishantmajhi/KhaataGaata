"use client";

import { useState } from "react";

/**
 * This is the bridge that lets phase one skip the WhatsApp Cloud API entirely.
 * Staff tap once, paste into the WhatsApp Business app, and the customer gets
 * a tracking link. No templates, no Meta billing, no payment method.
 */
export function CopyId({
  orderId,
  customerName,
  total,
}: {
  orderId: string;
  customerName: string;
  total: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const message = [
      `Namaste ${customerName.split(" ")[0]}!`,
      ``,
      `Your KhaataGaata order is confirmed.`,
      `Order ID: ${orderId}`,
      `Total: ${total}`,
      ``,
      `Track it here: ${origin}/track/${orderId}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>
        {copied ? "Copied ✓" : "Copy WhatsApp message"}
      </button>
    </div>
  );
}
