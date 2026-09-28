import { cn } from "@/lib/utils";
import * as React from "react";
import { Inbox, AlertTriangle, RefreshCw, SearchX, Loader2 } from "lucide-react";
import { Button } from "./button";
import { Card } from "./card";

/* --------------------------------------------------------------------- */
/* Loading                                                               */
/* --------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="skeleton h-4 flex-1 rounded"
              style={{ opacity: 1 - r * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-7 w-32 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Spinner className="size-6 text-brand-600" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Empty                                                                 */
/* --------------------------------------------------------------------- */

export function EmptyState({
  title = "No records found",
  description,
  icon,
  action,
  className,
}: {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-[var(--surface-3)] text-fg-subtle [&_svg]:size-5">
        {icon ?? <Inbox />}
      </span>
      <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
      {description ? <p className="max-w-sm text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function NoSearchResults({ onReset }: { onReset?: () => void }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="No matches found"
      description="No records match the current search or filters. Try adjusting or clearing them."
      action={
        onReset ? (
          <Button variant="outline" size="sm" onClick={onReset}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/* --------------------------------------------------------------------- */
/* Error                                                                 */
/* --------------------------------------------------------------------- */

export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  error?: Error | string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const message = typeof error === "string" ? error : error?.message;
  return (
    <Card className={cn("p-6", className)}>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="size-5" />
        </span>
        <p className="text-sm font-medium">{title}</p>
        {description ?? message ? (
          <p className="max-w-md text-xs text-fg-muted">{description ?? message}</p>
        ) : null}
        {onRetry ? (
          <Button variant="outline" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
