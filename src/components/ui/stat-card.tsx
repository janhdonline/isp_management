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
  tone?: "brand" | "gold" | "success" | "warning" | "danger" | "neutral" | "info";
  href?: string;
  loading?: boolean;
  className?: string;
};

const TONES = {
  brand: "bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300",
  gold: "bg-gold-500/15 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300",
  success: "bg-pine-100 text-pine-700 dark:bg-pine-500/15 dark:text-pine-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  neutral: "bg-[var(--surface-3)] text-fg-muted",
} as const;

function StatCardBody({ label, value, icon: Icon, delta, deltaLabel, hint, tone, loading, className }: StatCardProps) {
  const hero = tone === "gold";
  return (
    <Card
      className={cn(
        "card-hover group relative overflow-hidden p-5",
        hero && "border-gold-400/60 bg-gold-500 text-pine-950 dark:bg-gold-500 dark:text-pine-950",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("truncate text-xs font-semibold uppercase tracking-wide", hero ? "text-pine-900/70" : "text-fg-muted")}>{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className={cn("tnum mt-1.5 text-[1.7rem] font-bold tracking-tight", hero ? "text-pine-950" : "text-[var(--fg)]")}>{value}</p>
          )}
        </div>
        {Icon ? (
          <span className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110",
            hero ? "bg-pine-950/10 text-pine-950" : TONES[tone ?? "neutral"]
          )}>
            <Icon className="size-5" />
          </span>
        ) : null}
      </div>

      {delta !== undefined && delta !== null || hint ? (
        <div className="mt-2.5 flex items-center gap-2 text-xs">
          {delta !== undefined && delta !== null ? (
            <span
              className={cn(
                "tnum inline-flex items-center gap-0.5 font-semibold",
                hero ? "text-pine-900" : delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              )}
            >
              {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(delta)}%
            </span>
          ) : null}
          {deltaLabel || hint ? <span className={cn("truncate", hero ? "text-pine-900/70" : "text-fg-subtle")}>{deltaLabel ?? hint}</span> : null}
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
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
  );
}
