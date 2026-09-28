"use client";

import Link from "next/link";
import { DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, useTableQuery, type Column } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, NoSearchResults } from "@/components/ui/states";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/enums";
import { Printer, Receipt as ReceiptIcon } from "lucide-react";

export type ReceiptRow = {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  status: string;
  issuedAt: Date;
  invoice: { id: string; invoiceNumber: string } | null;
  payment: { id: string; paymentId: string; customer: { id: string; name: string; customerCode: string } };
};

export function ReceiptsView({
  rows,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: ReceiptRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  const { searchParams } = useTableQuery();
  const hasFilters = Array.from(searchParams.keys()).some((k) => !["page", "perPage"].includes(k));

  const columns: Column<ReceiptRow>[] = [
    {
      key: "receiptNumber",
      header: "Receipt",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.receiptNumber}</span>,
      exportValue: (r) => r.receiptNumber,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <Link href={`/customers/${r.payment.customer.id}?tab=payments`} className="truncate font-medium hover:text-brand-600">
          {r.payment.customer.name}
        </Link>
      ),
      exportValue: (r) => r.payment.customer.name,
    },
    {
      key: "invoice",
      header: "Invoice",
      hideBelow: "sm",
      cell: (r) =>
        r.invoice ? (
          <Link href={`/billing/invoices/${r.invoice.id}`} className="font-mono text-[11px] hover:text-brand-600">
            {r.invoice.invoiceNumber}
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        ),
      exportValue: (r) => r.invoice?.invoiceNumber ?? "",
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "method", header: "Method", cell: (r) => <Badge>{r.method}</Badge>, exportValue: (r) => r.method },
    { key: "date", header: "Date", align: "right", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.issuedAt)}</span>, exportValue: (r) => formatDate(r.issuedAt) },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "52px",
      cell: (r) => (
        <Link
          href={`/billing/receipts/${r.id}`}
          className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
          aria-label="View receipt"
        >
          <Printer className="size-4" />
        </Link>
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search receipt, customer..."
          filters={<FilterSelect param="method" placeholder="All methods" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />}
          actions={<ExportCsvButton rows={rows} columns={columns} filename="receipts" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        hasFilters ? (
          <NoSearchResults />
        ) : (
          <EmptyState
            icon={<ReceiptIcon />}
            title="No receipts yet"
            description="Every payment automatically produces a receipt you can reprint."
          />
        )
      }
    />
  );
}
