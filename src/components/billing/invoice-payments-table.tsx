"use client";

import Link from "next/link";
import { DataTableShell, ExportCsvButton, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatDate } from "@/lib/utils";

export type InvoicePaymentRow = {
  id: string;
  paymentId: string;
  amount: number;
  method: string;
  paymentDate: Date;
  accountName: string;
  receiptNumber: string | null;
};

export function InvoicePaymentsTable({ rows }: { rows: InvoicePaymentRow[] }) {
  const columns: Column<InvoicePaymentRow>[] = [
    {
      key: "paymentId",
      header: "Payment",
      cell: (p) => <span className="font-mono text-xs font-medium">{p.paymentId}</span>,
      exportValue: (p) => p.paymentId,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (p) => <span className="tnum text-xs font-semibold">{formatCurrency(p.amount)}</span>,
      exportValue: (p) => p.amount,
    },
    { key: "method", header: "Method", cell: (p) => <Badge>{p.method}</Badge>, exportValue: (p) => p.method },
    {
      key: "account",
      header: "Account",
      hideBelow: "sm",
      cell: (p) => <span className="text-xs text-fg-muted">{p.accountName}</span>,
      exportValue: (p) => p.accountName,
    },
    {
      key: "date",
      header: "Date",
      align: "right",
      cell: (p) => <span className="whitespace-nowrap text-xs">{formatDate(p.paymentDate)}</span>,
      exportValue: (p) => formatDate(p.paymentDate),
    },
    {
      key: "receipt",
      header: "Receipt",
      align: "right",
      cell: (p) => (p.receiptNumber ? <span className="font-mono text-[11px]">{p.receiptNumber}</span> : "—"),
      exportValue: (p) => p.receiptNumber ?? "",
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      compact
      className="border-0"
      toolbar={
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm font-medium">Payments received</p>
          <ExportCsvButton rows={rows} columns={columns} filename="invoice-payments" label="Export" />
        </div>
      }
      empty={
        <EmptyState
          title="Not paid yet"
          description="Switch to the Collect Payment tab to settle this invoice."
          action={
            <Link href="#payment" className="text-sm font-medium text-brand-600 hover:underline">
              Go to payment
            </Link>
          }
        />
      }
    />
  );
}
