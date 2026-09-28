"use client";

import * as React from "react";
import { useTableQuery } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 Days" },
  { value: "month", label: "30 Days" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom" },
] as const;

/** Date range picker used by every report/list screen (ISP.md reusable UI). */
export function DateRangePicker({
  className,
  defaultPreset = "month",
  showPresets = true,
}: {
  className?: string;
  defaultPreset?: string;
  showPresets?: boolean;
}) {
  const { searchParams, setParams } = useTableQuery();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const [preset, setPreset] = React.useState(defaultPreset);
  const [showCustom, setShowCustom] = React.useState(false);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {showPresets ? (
        <div className="inline-flex rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => {
                setPreset(r.value);
                setShowCustom(r.value === "custom");
                if (r.value !== "custom") setParams({ from: null, to: null, range: r.value });
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                preset === r.value && !showCustom
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                  : "text-fg-muted hover:text-[var(--fg)]"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {showCustom ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setParams({ from: e.target.value || null, range: "custom" })}
            className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
            aria-label="From date"
          />
          <span className="text-xs text-fg-subtle">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setParams({ to: e.target.value || null, range: "custom" })}
            className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
            aria-label="To date"
          />
        </div>
      ) : null}
    </div>
  );
}
