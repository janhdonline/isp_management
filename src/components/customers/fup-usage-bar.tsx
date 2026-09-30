"use client";

import { Gauge, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

/**
 * How much of a package's data allowance this customer has used.
 *
 * Renders nothing at all when the package has no limit. A bar reading "0 / 0 GB"
 * or the word "Unlimited" is decoration, and it pushes the graphs further down
 * the page for a customer whose package simply does not have the concept.
 *
 * The bar is capped at full width: usage can run to several times the limit
 * before the next cycle, and a bar that overflows its track looks broken rather
 * than like an overage.
 */
export function FupUsageBar({
  gb,
  limitGb,
  throttled,
  throttledAt,
  from,
  to,
}: {
  gb: number;
  limitGb: number | null;
  throttled: boolean;
  throttledAt: string | null;
  from: string;
  to: string;
}) {
  if (limitGb === null || limitGb <= 0) return null;

  const one = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const percent = Math.min(100, (gb / limitGb) * 100);
  const over = gb >= limitGb;

  // Amber once past 80%, red once past the limit. The threshold is on the
  // *track*, not the text, so the colour change is visible at a glance.
  const bar = over
    ? "bg-red-500"
    : percent >= 80
      ? "bg-amber-500"
      : "bg-[var(--brand-600)]";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 shrink-0 text-fg-subtle" />
          <span className="text-sm font-medium">
            <span className="tnum">{one(gb)}</span>
            <span className="text-fg-subtle"> / {one(limitGb)} GB this cycle</span>
          </span>
        </div>

        {throttled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            <TrendingDown className="size-3" />
            Throttled
            {throttledAt ? ` since ${formatDate(new Date(throttledAt))}` : ""}
          </span>
        ) : over ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300">
            <TrendingDown className="size-3" />
            Over the limit
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            Within allowance
          </span>
        )}
      </div>

      <div
        className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${one(gb)} of ${one(limitGb)} GB used this cycle`}
      >
        <div
          className={cn("h-full rounded-full transition-all", bar)}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] text-fg-subtle">
        Measured over {formatDate(new Date(from))} to {formatDate(new Date(to))}. Sessions are
        counted whole, so a session spanning the start of the cycle is included entirely.
      </p>
    </div>
  );
}
