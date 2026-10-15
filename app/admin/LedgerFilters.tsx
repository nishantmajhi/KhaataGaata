"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ALL_STEPS } from "@/lib/status";

export function LedgerFilters({ q, status }: { q: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const first = useRef(true);

  // Keep the box in step when the browser Back button changes the URL.
  useEffect(() => setValue(q), [q]);

  useEffect(() => {
    // Skip the mount pass, or every page load would push a duplicate entry.
    if (first.current) {
      first.current = false;
      return;
    }
    if (value === q) return;

    // Debounced: staff type an order ID or half a name, and one request per
    // keystroke would burn the Neon compute budget for no benefit.
    const timer = setTimeout(() => {
      const sp = new URLSearchParams();
      if (value.trim()) sp.set("q", value.trim());
      if (status !== "all") sp.set("status", status);
      const qs = sp.toString();
      router.replace(qs ? `/admin?${qs}` : "/admin");
    }, 300);

    return () => clearTimeout(timer);
  }, [value, q, status, router]);

  function pickStatus(next: string) {
    const sp = new URLSearchParams();
    if (value.trim()) sp.set("q", value.trim());
    if (next !== "all") sp.set("status", next);
    const qs = sp.toString();
    router.replace(qs ? `/admin?${qs}` : "/admin");
  }

  return (
    <div className="filters">
      <div className="filter-search">
        <label className="label" htmlFor="ledgerSearch">
          Search
        </label>
        <input
          id="ledgerSearch"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Order ID, name or phone"
          autoComplete="off"
          type="search"
        />
      </div>

      <div className="filter-status">
        <label className="label" htmlFor="ledgerStatus">
          Status
        </label>
        <select
          id="ledgerStatus"
          className="select"
          value={status}
          onChange={(e) => pickStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {ALL_STEPS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
