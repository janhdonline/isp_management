import { cn } from "@/lib/utils";
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/** Breadcrumb + title + description + primary action, per ISP.md §1. */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:px-6", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
          {breadcrumb.map((c, i) => (
            <React.Fragment key={`${c.label}-${i}`}>
              {i > 0 ? <ChevronRight className="size-3 text-fg-subtle" /> : null}
              {c.href ? (
                <Link href={c.href} className="transition-colors hover:text-[var(--fg)]">
                  {c.label}
                </Link>
              ) : (
                <span className="font-medium text-[var(--fg)]">{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-[var(--fg)] sm:text-xl">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>
        ) : null}
      </div>

      {children ? <div className="no-print">{children}</div> : null}
    </div>
  );
}

export function PageContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-4 p-4 sm:p-6", className)} {...props} />;
}
