"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addStaff, changeOwnPassword, toggleStaff, type FormState } from "../actions";

function Submit({
  label,
  pending: pendingLabel,
  className = "btn",
}: {
  label: string;
  pending: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: FormState }) {
  return (
    <>
      <p className="error-msg" role="alert">
        {state.error ?? ""}
      </p>
      {state.ok ? <p className="ok-msg">{state.ok}</p> : null}
    </>
  );
}

export function AddStaffForm() {
  const [state, action] = useActionState<FormState, FormData>(addStaff, {});

  return (
    <form action={action}>
      <div className="staff-grid">
        <div>
          <label className="label" htmlFor="newName">
            Name
          </label>
          <input id="newName" name="displayName" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="newUsername">
            Username
          </label>
          <input
            id="newUsername"
            name="username"
            className="input"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="newPassword">
            Temporary password
          </label>
          <input
            id="newPassword"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      <p className="hint">
        Give them the password in person; they can change it once they&apos;re in.
      </p>
      <Feedback state={state} />
      <Submit label="Add staff member" pending="Adding…" />
    </form>
  );
}

export function ToggleStaffButton({
  staffId,
  activate,
  label,
  disabled = false,
}: {
  staffId: number;
  activate: boolean;
  label: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(toggleStaff, {});

  return (
    <form action={action}>
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="activate" value={String(activate)} />
      <button type="submit" className="btn btn-sm btn-ghost" disabled={disabled}>
        {label}
      </button>
      {state.error ? (
        <span className="error-msg" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changeOwnPassword, {});

  return (
    <form action={action}>
      <div className="staff-grid">
        <div>
          <label className="label" htmlFor="currentPassword">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            className="input"
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="nextPassword">
            New password
          </label>
          <input
            id="nextPassword"
            name="newPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      <Feedback state={state} />
      <Submit label="Change password" pending="Changing…" className="btn btn-sm btn-ghost" />
    </form>
  );
}
