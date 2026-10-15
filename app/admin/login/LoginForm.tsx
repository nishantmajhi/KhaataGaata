"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type FormState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-block" disabled={pending}>
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});

  return (
    <form action={action} style={{ marginTop: "1.5rem" }}>
      <input type="hidden" name="next" value={next} />

      <div className="field">
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          className="input"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
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
          className={`input${state.error ? " error" : ""}`}
          autoComplete="current-password"
          required
        />
        <p className="error-msg" role="alert">
          {state.error ?? ""}
        </p>
      </div>

      <Submit />
    </form>
  );
}
