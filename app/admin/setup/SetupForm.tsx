"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createFirstStaff, type FormState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-block" disabled={pending}>
      {pending ? "Creating…" : "Create account and sign in"}
    </button>
  );
}

export function SetupForm() {
  const [state, action] = useActionState<FormState, FormData>(createFirstStaff, {});

  return (
    <form action={action} style={{ marginTop: "1.5rem" }}>
      <div className="field">
        <label className="label" htmlFor="setupKey">
          Setup key (ADMIN_PASSWORD)
        </label>
        <input
          id="setupKey"
          name="setupKey"
          type="password"
          className="input"
          autoComplete="off"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="displayName">
          Your name
        </label>
        <input id="displayName" name="displayName" className="input" required />
        <p className="hint">Shown in the order history beside anything you change.</p>
      </div>

      <div className="field">
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          className="input"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="sunita"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          required
        />
        <p className="hint">At least 8 characters.</p>
      </div>

      <p className="error-msg" role="alert">
        {state.error ?? ""}
      </p>

      <Submit />
    </form>
  );
}
