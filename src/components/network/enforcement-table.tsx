"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { formatNumber, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react";
import type { EnforcementRow } from "@/lib/services/enforcement-queries";

/**
 * The queue of router actions that have not been carried out.
 *
 * Columns are ordered by what an operator needs first: who, what we tried, and
 * why it did not work. A retry count of nine is the thing that says "this router
 * has been off since Tuesday", so it is given real estate rather than being
 * hidden behind a hover.
 */
export function EnforcementTable({ rows }: { rows: EnforcementRow[] }) {
  const [filter, setFilter] = useState<"All" | "Pending" | "Done" | "Failed">("Pending");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "All" ? true : r.status === filter))
      .filter((r) =>
        q
          ? [r.username, r.customerName, r.lastError, r.routerName]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          : true
      );
  }, [rows, filter, query]);

  const columns: Column<EnforcementRow>[] = [
    {
      key: "username",
      header: "Subscriber",
      cell: (r) => (
        <div>
          <p className="font-mono text-xs font-medium">{r.username}</p>
          {r.customerName ? (
            r.customerId ? (
              <Link
                href={`/customers/${r.customerId}`}
                className="text-[11px] text-fg-subtle hover:text-brand-600"
              >
                {r.customerName}
              </Link>
            ) : (
              <p className="text-[11px] text-fg-subtle">{r.customerName}</p>
            )
          ) : null}
        </div>
      ),
      exportValue: (r) => r.username,
    },
    {
      key: "action",
      header: "Action",
      cell: (r) => (
        <span className="text-xs">
          {r.action === "suspend" ? "Suspend" : r.action === "reconnect" ? "Reconnect" : r.action}
        </span>
      ),
      exportValue: (r) => r.action,
    },
    {
      key: "router",
      header: "Router",
      hideBelow: "md",
      cell: (r) => <span className="text-xs text-fg-subtle">{r.routerName ?? "—"}</span>,
      exportValue: (r) => r.routerName ?? "",
    },
    {
      key: "dbState",
      header: "In the system",
      hideBelow: "lg",
      cell: (r) =>
        r.connectionStatus ? <StatusBadge status={r.connectionStatus} /> : <span className="text-xs text-fg-subtle">customer gone</span>,
      exportValue: (r) => r.connectionStatus ?? "",
    },
    {
      key: "attempts",
      header: "Tries",
      align: "right",
      cell: (r) => (
        <span className={cn("tnum text-xs", (r.attempts ?? 0) >= 5 && "font-semibold text-amber-600")}>
          {r.attempts}
        </span>
      ),
      exportValue: (r) => r.attempts,
    },
    {
      key: "status",
      header: "State",
      cell: (r) => <StatusBadge status={r.status} />,
      exportValue: (r) => r.status,
    },
    {
      key: "error",
      header: "Last attempt",
      hideBelow: "sm",
      cell: (r) => (
        <div className="max-w-xs">
          <p className="truncate text-xs text-fg-subtle" title={r.lastError ?? undefined}>
            {r.lastError ?? "—"}
          </p>
          <p className="text-[10px] text-fg-subtle">{relativeTime(r.updatedAt)}</p>
        </div>
      ),
      exportValue: (r) => r.lastError ?? "",
    },
  ];

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
        <ShieldCheck className="size-7 text-emerald-500" />
        <p className="text-sm font-medium">No router actions recorded</p>
        <p className="max-w-sm text-xs text-fg-muted">
          Suspending or reconnecting a customer writes an entry here. An empty list means
          the database and the routers agree.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["Pending", "Done", "Failed", "All"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "bg-brand-600 text-white"
                : "bg-[var(--surface-2)] text-fg-muted hover:text-fg"
            )}
          >
            {f}
            {f !== "All" ? ` (${rows.filter((r) => r.status === f).length})` : ""}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subscriber, router, or error"
          className="ml-auto min-w-48 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs outline-none focus:border-brand-500"
        />
      </div>

      {visible.length ? (
        <DataTableShell
          columns={columns}
          rows={visible}
          rowKey={(r) => r.id}
          empty="Nothing matches that filter."
        />
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-10 text-center text-xs text-fg-muted">
          Nothing matches that filter.
        </div>
      )}
    </div>
  );
}

/** Shown above the table when work is waiting, so the drift is impossible to miss. */
export function EnforcementBanner({ pending }: { pending: number }) {
  if (pending === 0) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">
          {formatNumber(pending)} router action{pending === 1 ? "" : "s"} waiting
        </p>
        <p className="mt-0.5 text-xs">
          These customers are already suspended or reconnected in the system, but the router has
          not been told yet — most often because it is unreachable. Each one is retried
          automatically, and given up on after ten attempts so nothing waits forever.
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs">
          <RotateCcw className="size-3" />
          Retried by the scheduled job; nothing here needs doing by hand unless a router stays
          offline.
        </p>
      </div>
    </div>
  );
}
