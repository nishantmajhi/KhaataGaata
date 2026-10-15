"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { closeOrderAction, type FormState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? "Saving…" : "Close this order"}
    </button>
  );
}

export function CloseForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState<FormState, FormData>(closeOrderAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Cancel or refund…
      </button>
    );
  }

  return (
    <form action={action} className="danger-zone">
      <input type="hidden" name="orderId" value={orderId} />

      <div className="field">
        <label className="label" htmlFor="closeStatus">
          Outcome
        </label>
        <select id="closeStatus" name="status" className="select" defaultValue="cancelled">
          <option value="cancelled">Cancelled — no money changed hands</option>
          <option value="refunded">Refunded — money returned</option>
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="reason">
          Reason
        </label>
        <input
          id="reason"
          name="reason"
          className="input"
          placeholder="Customer changed their mind"
          required
        />
        <p className="hint">The customer sees this on their tracking page.</p>
      </div>

      <label className="confirm">
        <input type="checkbox" name="confirmClose" value="yes" />
        <span>I&apos;m sure. This stops the delivery timeline.</span>
      </label>

      <p className="error-msg" role="alert">
        {state.error ?? ""}
      </p>
      {state.ok ? <p className="ok-msg">{state.ok}</p> : null}

      <div className="link-row">
        <Submit />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Never mind
        </button>
      </div>
    </form>
  );
}
