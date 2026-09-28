"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Provide to make the header sortable; value is the query param name. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  /** Hide on small screens (ISP.md §19 responsive tables). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Value used by the CSV export. Omit to exclude the column from export. */
  exportValue?: (row: T) => string | number;
  width?: string;
};

const HIDE_CLASS = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export function useTableQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (updates: Record<string, string | null | undefined>, opts?: { keepPage?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!opts?.keepPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { searchParams, setParams, router, pathname };
}

/* --------------------------------------------------------------------- */
/* Pagination                                                            */
/* --------------------------------------------------------------------- */

export function Pagination({
  page,
  perPage,
  total,
  totalPages,
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  className?: string;
}) {
  const { setParams } = useTableQuery();
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const pages = buildPageList(page, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <span className="tnum">
          Showing <strong className="font-semibold text-[var(--fg)]">{from}</strong>–
          <strong className="font-semibold text-[var(--fg)]">{to}</strong> of{" "}
          <strong className="font-semibold text-[var(--fg)]">{total}</strong>
        </span>
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Rows</span>
          <select
            value={perPage}
            onChange={(e) => setParams({ perPage: e.target.value, page: "1" })}
            className="h-7 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-1.5 text-xs focus:border-brand-500 focus:outline-none"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            onClick={() => setParams({ page: String(page - 1) }, { keepPage: true })}
            disabled={page <= 1}
            aria-label="Previous page"
            className="flex size-8 items-center justify-center rounded-md border border-[var(--border-strong)] text-fg-muted transition-colors hover:bg-[var(--surface-3)] disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>

          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1.5 text-xs text-fg-subtle">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => setParams({ page: String(p) }, { keepPage: true })}
                aria-current={p === page ? "page" : undefined}
                className={cn(
                  "tnum flex size-8 items-center justify-center rounded-md text-xs font-medium transition-colors",
                  p === page
                    ? "bg-brand-600 text-white"
                    : "border border-[var(--border-strong)] text-fg-muted hover:bg-[var(--surface-3)]"
                )}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => setParams({ page: String(page + 1) }, { keepPage: true })}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="flex size-8 items-center justify-center rounded-md border border-[var(--border-strong)] text-fg-muted transition-colors hover:bg-[var(--surface-3)] disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function buildPageList(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

/* --------------------------------------------------------------------- */
/* Toolbar                                                               */
/* --------------------------------------------------------------------- */

export function TableToolbar({
  searchPlaceholder = "Search...",
  filters,
  actions,
  bulk,
  right,
}: {
  searchPlaceholder?: string;
  /** Custom filter controls; each uses useTableQuery().setParams itself. */
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered when rows are selected (bulk actions). */
  bulk?: (clear: () => void, count: number) => React.ReactNode;
  right?: React.ReactNode;
}) {
  const { searchParams, setParams } = useTableQuery();
  const q = searchParams.get("q") ?? "";
  const [value, setValue] = React.useState(q);
  const hasFilters = Array.from(searchParams.keys()).some(
    (k) => !["q", "page", "perPage", "sort", "dir", "columns"].includes(k)
  );

  // Reset the input when the URL changes (back button, "clear filters", ...).
  // Adjusting state during render is React's recommended alternative to an effect.
  const [lastQ, setLastQ] = React.useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setValue(q);
  }

  // debounce so typing does not spam the server
  React.useEffect(() => {
    if (value === q) return;
    const t = window.setTimeout(() => setParams({ q: value || null }), 350);
    return () => window.clearTimeout(t);
  }, [value, q, setParams]);

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] pl-8 pr-3 text-sm text-[var(--fg)] placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {filters}

        {hasFilters ? (
          <button
            onClick={() => setParams({ q: null, areaId: null, packageId: null, status: null, billingStatus: null, onlineStatus: null, from: null, to: null, area: null })}
            className="h-9 rounded-lg px-2.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
          >
            Clear filters
          </button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {right}
          {actions}
        </div>
      </div>
      {bulk ? <BulkBar bulk={bulk} /> : null}
    </div>
  );
}

function BulkBar({ bulk }: { bulk: (clear: () => void, count: number) => React.ReactNode }) {
  // The table publishes its selection count on a tiny event bus so the toolbar
  // and the table stay decoupled without lifting state into a provider.
  const count = React.useSyncExternalStore(subscribeSelection, getSelectionCount, () => 0);

  if (count === 0) return null;
  return <>{bulk(() => selectionBus.clear(), count)}</>;
}

const SELECTION_EVENT = "isp:selection";
const CLEAR_EVENT = "isp:clear-selection";
let selectionCount = 0;

function subscribeSelection(onChange: () => void) {
  window.addEventListener(SELECTION_EVENT, onChange);
  return () => window.removeEventListener(SELECTION_EVENT, onChange);
}

function getSelectionCount() {
  return selectionCount;
}

export const selectionBus = {
  emit(count: number) {
    selectionCount = count;
    window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
  },
  clear() {
    selectionCount = 0;
    window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
    window.dispatchEvent(new CustomEvent(CLEAR_EVENT));
  },
};

/* --------------------------------------------------------------------- */
/* Table shell                                                           */
/* --------------------------------------------------------------------- */

export function DataTableShell<T>({
  columns,
  rows,
  rowKey,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  toolbar,
  pagination,
  empty,
  footer,
  onRowClick,
  className,
  compact,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey?: (row: T, index: number) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string, checked: boolean) => void;
  onToggleAll?: (checked: boolean) => void;
  toolbar?: React.ReactNode;
  pagination?: React.ReactNode;
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  compact?: boolean;
}) {
  const { searchParams, setParams } = useTableQuery();
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir") ?? "asc";

  const visible = React.useMemo(() => columns, [columns]);

  const onSort = (sortKey: string) => {
    if (sort === sortKey) {
      setParams({ dir: dir === "asc" ? "desc" : "asc" }, { keepPage: true });
    } else {
      setParams({ sort: sortKey, dir: "asc" }, { keepPage: true });
    }
  };

  const allChecked = selectable && rows.length > 0 && rows.every((r) => selected?.has(rowKey ? rowKey(r, 0) : ""));

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]", className)}>
      {toolbar}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              {selectable ? (
                <th className="w-10 px-3 py-2.5 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={!!allChecked}
                    onChange={(e) => onToggleAll?.(e.target.checked)}
                    className="size-4 cursor-pointer rounded border-[var(--border-strong)] accent-brand-600"
                  />
                </th>
              ) : null}
              {visible.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-muted",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    !col.align && "text-left",
                    col.hideBelow && HIDE_CLASS[col.hideBelow],
                    col.headerClassName
                  )}
                >
                  {col.sortKey ? (
                    <button
                      onClick={() => onSort(col.sortKey!)}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-[var(--fg)]",
                        col.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {col.header}
                      {sort === col.sortKey ? (
                        dir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3 text-brand-600" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visible.length + (selectable ? 1 : 0)} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const id = rowKey ? rowKey(row, i) : String(i);
                const isSelected = selected?.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--surface-2)]",
                      isSelected && "bg-brand-50/60 dark:bg-brand-500/5",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {selectable ? (
                      <td className="px-3 align-middle">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={!!isSelected}
                          onChange={(e) => onToggle?.(id, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="size-4 cursor-pointer rounded border-[var(--border-strong)] accent-brand-600"
                        />
                      </td>
                    ) : null}
                    {visible.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          compact ? "px-3 py-2" : "px-3 py-2.5",
                          "align-middle text-[var(--fg)]",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          col.hideBelow && HIDE_CLASS[col.hideBelow],
                          col.className
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer ? <tfoot className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]">{footer}</tfoot> : null}
        </table>
      </div>
      {pagination}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* CSV export                                                            */
/* --------------------------------------------------------------------- */

export function ExportCsvButton<T>({
  rows,
  columns,
  filename,
  label = "Export",
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  filename: string;
  label?: string;
  className?: string;
}) {
  const exportable = columns.filter((c) => c.exportValue);
  const onClick = () => {
    const headers = exportable.map((c) => (typeof c.header === "string" ? c.header : c.key));
    const body = rows.map((r) => exportable.map((c) => c.exportValue!(r) ?? ""));
    const csv = [headers, ...body]
      .map((line) => line.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={onClick}
      disabled={rows.length === 0}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50",
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      {label}
    </button>
  );
}

/* --------------------------------------------------------------------- */
/* Toolbar filter select                                                 */
/* --------------------------------------------------------------------- */

export function FilterSelect({
  param,
  options,
  placeholder = "All",
  className,
  width = "w-36",
}: {
  param: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  width?: string;
}) {
  const { searchParams, setParams } = useTableQuery();
  const value = searchParams.get(param) ?? "";
  return (
    <select
      value={value}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      aria-label={placeholder}
      className={cn(
        "h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-sm text-[var(--fg)] focus:border-brand-500 focus:outline-none",
        width,
        className
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
