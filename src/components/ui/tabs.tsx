"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabItem = {
  value: string;
  label: string;
  href?: string;
  count?: number;
  icon?: React.ReactNode;
};

/**
 * Two modes:
 *  - `value` marks the active item, for tabs that share one route and differ
 *    only by query string (or that are fully controlled)
 *  - otherwise `href` items are matched against the pathname
 */
export function Tabs({
  items,
  value,
  onValueChange,
  className,
  variant = "underline",
}: {
  items: TabItem[];
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  variant?: "underline" | "pill";
}) {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      className={cn(
        "flex gap-1 overflow-x-auto",
        variant === "underline" && "border-b border-[var(--border)]",
        className
      )}
    >
      {items.map((item) => {
        const active =
          value !== undefined
            ? value === item.value
            : item.href
              ? pathname === item.href || pathname.startsWith(item.href + "/")
              : false;
        const base = cn(
          "flex shrink-0 items-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap",
          variant === "underline" &&
            "-mb-px border-b-2 px-3.5 py-2.5",
          variant === "pill" && "rounded-lg px-3 py-1.5"
        );
        const tone = active
          ? variant === "underline"
            ? "border-brand-600 text-brand-600 dark:text-brand-400"
            : "bg-brand-600 text-white shadow-sm"
          : "border-transparent text-fg-muted hover:text-[var(--fg)]";

        const inner = (
          <>
            {item.icon ? <span className="[&_svg]:size-4">{item.icon}</span> : null}
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "tnum rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                  active
                    ? variant === "underline"
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                      : "bg-white/20"
                    : "bg-[var(--surface-3)] text-fg-muted"
                )}
              >
                {item.count}
              </span>
            ) : null}
          </>
        );

        if (item.href) {
          return (
            <Link key={item.value} href={item.href} role="tab" aria-selected={active} className={cn(base, tone)}>
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange?.(item.value)}
            className={cn(base, tone)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
