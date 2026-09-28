"use client";

import { useTableQuery } from "@/components/ui/data-table";

/** Date range inputs bound to the `from` / `to` query params. */
export function DateRangeFilter({ fromLabel = "From", toLabel = "To" }: { fromLabel?: string; toLabel?: string }) {
  const { searchParams, setParams } = useTableQuery();
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label={fromLabel}
        value={searchParams.get("from") ?? ""}
        onChange={(e) => setParams({ from: e.target.value || null })}
        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
      />
      <span className="text-xs text-fg-subtle">-</span>
      <input
        type="date"
        aria-label={toLabel}
        value={searchParams.get("to") ?? ""}
        onChange={(e) => setParams({ to: e.target.value || null })}
        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
      />
    </div>
  );
}
