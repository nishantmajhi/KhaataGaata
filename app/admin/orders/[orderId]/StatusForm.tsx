"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PROGRESS_STEPS, isBackwardsMove, isExceptionStatus, statusLabel } from "@/lib/status";
import { updateStatus, type FormState } from "../../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function StatusForm({ orderId, current }: { orderId: string; current: string }) {
  const [state, action] = useActionState<FormState, FormData>(updateStatus, {});
  const halted = isExceptionStatus(current);
  const [choice, setChoice] = useState(halted ? PROGRESS_STEPS[0].key : current);

  const backwards = !halted && isBackwardsMove(current, choice);

  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />

      <div className="field">
        <label className="label" htmlFor="status">
          {halted ? "Reopen at" : "New status"}
        </label>
        <select
          id="status"
          name="status"
          className="select"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          {PROGRESS_STEPS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="note">
          Note for the customer
        </label>
        <input
          id="note"
          name="note"
          className="input"
          placeholder="Handed to the courier in Patan"
        />
        <p className="hint">Optional. Shows under the step on their tracking page.</p>
      </div>

      {backwards ? (
        <label className="confirm">
          <input type="checkbox" name="confirmBackwards" value="yes" />
          <span>
            This moves the order back from {statusLabel(current)} to {statusLabel(choice)}.
            The customer will see the change.
          </span>
        </label>
      ) : null}

      <p className="error-msg" role="alert">
        {state.error ?? ""}
      </p>
      {state.ok ? <p className="ok-msg">{state.ok}</p> : null}

      <Submit label={halted ? "Reopen order" : "Update status"} />
    </form>
  );
}
