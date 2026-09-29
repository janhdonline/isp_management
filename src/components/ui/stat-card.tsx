import { cn } from "@/lib/utils";
import * as React from "react";
import { Card } from "./card";
import { Skeleton } from "./skeleton";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

export type StatCardProps = {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Signed percentage change, e.g. +12 or -4 */
  delta?: number | null;
  deltaLabel?: string;
  hint?: React.ReactNode;
  tone?: "brand" | "success" | "warning" | "danger" | "neutral" | "info";
  href?: string;
  loading?: boolean;
  className?: string;
};

const TONES = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  danger: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  info: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
  neutral: "bg-[var(--surface-3)] text-fg-muted",
} as const;

function StatCardBody({ label, value, icon: Icon, delta, deltaLabel, hint, tone, loading, className }: StatCardProps) {
  return (
    <Card className={cn("group relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-fg-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="tnum mt-1.5 text-[1.7rem] leading-8 font-semibold tracking-tight text-[var(--fg)]">{value}</p>
          )}
        </div>
        {Icon ? (
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-[4px_4px_10px_var(--neu-dark),-4px_-4px_10px_var(--neu-light)]", TONES[tone ?? "neutral"])}>
            <Icon className="size-5" />
          </span>
        ) : null}
      </div>

      {delta !== undefined && delta !== null || hint ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta !== undefined && delta !== null ? (
            <span
              className={cn(
                "tnum inline-flex items-center gap-0.5 font-medium",
                delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              )}
            >
              {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(delta)}%
            </span>
          ) : null}
          {deltaLabel || hint ? <span className="truncate text-fg-subtle">{deltaLabel ?? hint}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function StatCard(props: StatCardProps) {
  if (!props.href) return <StatCardBody {...props} />;
  return (
    <a href={props.href} className="block">
      <StatCardBody {...props} />
    </a>
  );
}

export function StatCardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
  );
}
