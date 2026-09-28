"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, useTableQuery, Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { DropdownMenu, MenuItem } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/providers";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Copy, MoreHorizontal, Package as PackageIcon, Pencil, Power, Trash2 } from "lucide-react";
import { deletePackageAction, duplicatePackageAction, togglePackageStatusAction } from "@/app/(app)/packages/actions";

export type PackageRow = {
  id: string;
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  monthlyPrice: number;
  installationFee: number;
  validityDays: number;
  billingCycle: string;
  fupLimit: number | null;
  status: string;
  _count: { customers: number };
};

export function PackagesTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: PackageRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  const { searchParams } = useTableQuery();
  const hasFilters = Array.from(searchParams.keys()).some((k) => !["page", "perPage", "sort", "dir"].includes(k));

  const columns: Column<PackageRow>[] = [
    {
      key: "name",
      header: "Package",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/packages/${r.id}`} className="block truncate font-medium hover:text-brand-600">
            {r.name}
          </Link>
          <span className="block text-[11px] text-fg-subtle">
            {r.billingCycle} · {r.validityDays}d validity
          </span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: "speed",
      header: "Speed (D/U)",
      hideBelow: "sm",
      cell: (r) => (
        <span className="tnum whitespace-nowrap text-xs">
          {r.downloadSpeed} / {r.uploadSpeed} <span className="text-fg-subtle">Mbps</span>
        </span>
      ),
      exportValue: (r) => `${r.downloadSpeed}/${r.uploadSpeed}`,
    },
    {
      key: "price",
      header: "Monthly Price",
      align: "right",
      cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.monthlyPrice)}</span>,
      exportValue: (r) => r.monthlyPrice,
    },
    {
      key: "fee",
      header: "Install Fee",
      align: "right",
      hideBelow: "lg",
      cell: (r) => <span className="tnum text-xs text-fg-muted">{formatCurrency(r.installationFee)}</span>,
      exportValue: (r) => r.installationFee,
    },
    {
      key: "fup",
      header: "FUP",
      align: "right",
      hideBelow: "xl",
      cell: (r) => <span className="tnum text-xs text-fg-muted">{r.fupLimit ? `${r.fupLimit} GB` : "Unlimited"}</span>,
      exportValue: (r) => r.fupLimit ?? "Unlimited",
    },
    {
      key: "customers",
      header: "Subscribers",
      align: "right",
      cell: (r) => (
        <span className="tnum text-xs font-medium">
          {formatNumber(r._count.customers)}
        </span>
      ),
      exportValue: (r) => r._count.customers,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status === "Active" ? "Active" : "Inactive"} />,
      exportValue: (r) => r.status,
    },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <PackageRowActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search packages..."
          filters={
            <FilterSelect
              param="status"
              placeholder="All statuses"
              options={[
                { value: "Active", label: "Active" },
                { value: "Inactive", label: "Inactive" },
              ]}
            />
          }
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="packages" />
              <Link
                href="/packages/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <PackageIcon className="size-4" /> Add Package
              </Link>
            </div>
          }
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        hasFilters ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">No packages match your filters.</p>
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No packages yet</p>
            <p className="mt-1 text-xs text-fg-muted">Create your first package to start selling connections.</p>
            <Link href="/packages/new" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white">
              <PackageIcon className="size-4" /> Add Package
            </Link>
          </div>
        )
      }
    />
  );
}

export function PackageRowActions({ row }: { row: PackageRow }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const run = async (fn: () => Promise<{ success?: string; formError?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.formError) error(r.formError);
      else {
        success(r.success ?? "Done");
        setConfirmDelete(false);
        startTransition(() => router.refresh());
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const items: (MenuItem | "separator")[] = [
    { label: "View", onSelect: () => router.push(`/packages/${row.id}`) },
    { label: "Edit", icon: <Pencil />, onSelect: () => router.push(`/packages/${row.id}/edit`) },
    { label: "Duplicate", icon: <Copy />, onSelect: () => run(() => duplicatePackageAction(row.id)) },
    "separator",
    {
      label: row.status === "Active" ? "Deactivate" : "Activate",
      icon: <Power />,
      onSelect: () => run(() => togglePackageStatusAction(row.id)),
    },
    { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) },
  ];

  return (
    <>
      <DropdownMenu items={items} trigger={<MoreHorizontal className="size-4" />} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => run(() => deletePackageAction(row.id))}
        title="Delete package?"
        description={
          row._count.customers > 0
            ? `${row.name} is used by ${row._count.customers} customer(s) and cannot be deleted.`
            : `${row.name} will be permanently removed. This action cannot be undone.`
        }
        confirmLabel="Delete"
        loading={busy}
      />
    </>
  );
}
