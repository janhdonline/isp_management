import { cn } from "@/lib/utils";
import { statusClass } from "@/lib/enums";
import * as React from "react";

export function StatusBadge({
  status,
  className,
  dot = true,
}: {
  status?: string | null;
  className?: string;
  dot?: boolean;
}) {
  const label = status ?? "Unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        statusClass(label),
        className
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {label}
    </span>
  );
}

/** Connection status, online state and billing status shown separately (ISP.md §15). */
export function StatusTriple({
  connection,
  online,
  billing,
  className,
}: {
  connection?: string | null;
  online?: string | null;
  billing?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {connection ? <StatusBadge status={connection} /> : null}
      {online ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
            online === "Online"
              ? "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300"
              : "bg-slate-100 text-slate-500 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400"
          )}
        >
          <span className="size-1 rounded-full bg-current" />
          {online}
        </span>
      ) : null}
      {billing ? <StatusBadge status={billing} dot={false} /> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "bg-[var(--surface-3)] text-fg-muted ring-[var(--border-strong)]",
    brand: "bg-gold-100 text-gold-800 ring-gold-600/25 dark:bg-gold-500/15 dark:text-gold-300",
    success: "bg-pine-100 text-pine-800 ring-pine-600/25 dark:bg-pine-500/15 dark:text-pine-300",
    warning: "bg-amber-100 text-amber-800 ring-amber-600/25 dark:bg-amber-500/15 dark:text-amber-300",
    danger: "bg-red-100 text-red-800 ring-red-600/25 dark:bg-red-500/15 dark:text-red-300",
    info: "bg-sky-100 text-sky-800 ring-sky-600/25 dark:bg-sky-500/15 dark:text-sky-300",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
