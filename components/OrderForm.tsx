"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/admin/actions";

export type ItemDraft = { title: string; qty: string; price: string };

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  orderId?: string;
  defaults?: {
    customerName?: string;
    customerPhone?: string;
    address?: string;
    items?: ItemDraft[];
  };
  /** Only the create form seeds the first timeline entry. */
  showNote?: boolean;
};

type Line = ItemDraft & { key: number };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, title: "", qty: "1", price: "" });

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function OrderForm({
  action,
  submitLabel,
  pendingLabel,
  orderId,
  defaults,
  showNote = false,
}: Props) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [lines, setLines] = useState<Line[]>(() =>
    defaults?.items?.length
      ? defaults.items.map((it) => ({ ...it, key: nextKey++ }))
      : [blank()]
  );

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.price) || 0),
    0
  );

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <form action={formAction}>
      {orderId ? <input type="hidden" name="orderId" value={orderId} /> : null}

      <div className="field">
        <label className="label" htmlFor="customerName">
          Customer name
        </label>
        <input
          id="customerName"
          name="customerName"
          className="input"
          defaultValue={defaults?.customerName ?? ""}
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="customerPhone">
          WhatsApp number
        </label>
        <input
          id="customerPhone"
          name="customerPhone"
          className="input"
          inputMode="tel"
          placeholder="+977…"
          defaultValue={defaults?.customerPhone ?? ""}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="address">
          Delivery address
        </label>
        <textarea
          id="address"
          name="address"
          className="textarea"
          rows={2}
          defaultValue={defaults?.address ?? ""}
        />
      </div>

      <div className="label" style={{ marginTop: "1.75rem", marginBottom: "0.75rem" }}>
        Items
      </div>

      {lines.map((line, i) => (
        <div className="item-row" key={line.key}>
          <div>
            {i === 0 && <label className="label">Notebook</label>}
            <input
              name="itemTitle"
              className="input"
              value={line.title}
              onChange={(e) => update(line.key, { title: e.target.value })}
              placeholder="A5 ruled, kraft cover"
            />
          </div>
          <div>
            {i === 0 && <label className="label">Qty</label>}
            <input
              name="itemQty"
              className="input"
              inputMode="numeric"
              value={line.qty}
              onChange={(e) => update(line.key, { qty: e.target.value })}
            />
          </div>
          <div>
            {i === 0 && <label className="label">Rs each</label>}
            <input
              name="itemPrice"
              className="input"
              inputMode="decimal"
              value={line.price}
              onChange={(e) => update(line.key, { price: e.target.value })}
              placeholder="0"
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-label={`Remove item ${i + 1}`}
            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
            disabled={lines.length === 1}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setLines((prev) => [...prev, blank()])}
      >
        + Add item
      </button>

      <div className="total-line">
        <span>Total</span>
        <b>Rs {total.toLocaleString("en-IN")}</b>
      </div>

      {showNote ? (
        <div className="field" style={{ marginTop: "1.75rem" }}>
          <label className="label" htmlFor="note">
            First timeline note
          </label>
          <input
            id="note"
            name="note"
            className="input"
            defaultValue="Payment confirmed, order recorded."
          />
          <p className="hint">The customer sees this on their tracking page.</p>
        </div>
      ) : null}

      <p className="error-msg" role="alert">
        {state.error ?? ""}
      </p>

      <Submit label={submitLabel} pending={pendingLabel} />
    </form>
  );
}
