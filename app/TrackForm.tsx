"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDER_ID_RE } from "@/lib/status";

export function TrackForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = value.trim().toUpperCase();
    if (!ORDER_ID_RE.test(id)) {
      setError("Order IDs are 4–8 letters and numbers.");
      return;
    }
    setBusy(true);
    router.push(`/track/${id}`);
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "1.5rem" }} noValidate>
      <div className="field">
        <label className="label" htmlFor="orderId">
          Order ID
        </label>
        <input
          id="orderId"
          className={`input tracking${error ? " error" : ""}`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            if (error) setError("");
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          placeholder="XXXXXX"
          aria-describedby="orderIdError"
        />
        <p className="error-msg" id="orderIdError" role="alert">
          {error}
        </p>
      </div>

      <button type="submit" className="btn btn-block" disabled={busy}>
        {busy ? "Looking up…" : "Track order"}
      </button>
    </form>
  );
}
