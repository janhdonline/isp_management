"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, Column } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { DropdownMenu, MenuItem } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/providers";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { INVOICE_STATUSES, PAYMENT_METHODS } from "@/lib/enums";
import { cancelInvoiceAction, refundPaymentAction } from "@/app/(app)/billing/actions";
import { Banknote, Eye, FileDown, MoreHorizontal, Printer, Receipt, RotateCcw, XCircle } from "lucide-react";

/* ================================================================== */
/* Invoices                                                            */
/* ================================================================== */

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customer: { id: string; name: string; username: string; customerCode: string };
  package: { id: string; name: string } | null;
  issueDate: Date;
  dueDate: Date;
  amount: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  status: string;
};

export function InvoicesTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
  areas,
  packages,
}: {
  rows: InvoiceRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  areas: { id: string; name: string }[];
  packages: { id: string; name: string }[];
}) {
  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (r) => (
        <Link href={`/billing/invoices/${r.id}`} className="font-mono text-xs font-medium hover:text-brand-600">
          {r.invoiceNumber}
        </Link>
      ),
      exportValue: (r) => r.invoiceNumber,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/customers/${r.customer.id}`} className="block truncate font-medium hover:text-brand-600">
            {r.customer.name}
          </Link>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.customer.username}</span>
        </div>
      ),
      exportValue: (r) => r.customer.name,
    },
    { key: "package", header: "Package", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.package?.name ?? "—"}</span>, exportValue: (r) => r.package?.name ?? "" },
    { key: "issue", header: "Issued", hideBelow: "sm", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.issueDate)}</span>, exportValue: (r) => formatDate(r.issueDate) },
    { key: "due", header: "Due", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.dueDate)}</span>, exportValue: (r) => formatDate(r.dueDate) },
    { key: "total", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.total)}</span>, exportValue: (r) => r.total },
    { key: "paid", header: "Paid", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs">{formatCurrency(r.paid)}</span>, exportValue: (r) => r.paid },
    {
      key: "balance",
      header: "Due",
      align: "right",
      cell: (r) => <span className={`tnum text-xs font-medium ${r.total - r.paid > 0 ? "text-red-600 dark:text-red-400" : "text-fg-subtle"}`}>{formatCurrency(r.total - r.paid)}</span>,
      exportValue: (r) => r.total - r.paid,
    },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <InvoiceRowActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search invoice or customer..."
          filters={
            <>
              <FilterSelect param="status" placeholder="All statuses" options={INVOICE_STATUSES.map((s) => ({ value: s, label: s }))} />
              <FilterSelect param="areaId" placeholder="All areas" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
              <FilterSelect param="packageId" placeholder="All packages" options={packages.map((p) => ({ value: p.id, label: p.name }))} width="w-40" />
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="invoices" />
              <Link
                href="/billing/invoices/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Receipt className="size-4" /> New Invoice
              </Link>
            </div>
          }
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={<EmptyInvoices />}
    />
  );
}

function EmptyInvoices() {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">No invoices found</p>
      <p className="mt-1 text-xs text-fg-muted">Create an invoice or adjust your filters.</p>
      <Link href="/billing/invoices/new" className="mt-3 inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white">
        New Invoice
      </Link>
    </div>
  );
}

function InvoiceRowActions({ row }: { row: InvoiceRow }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const run = async (fn: () => Promise<{ success?: string; formError?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.formError) error(r.formError);
      else {
        success(r.success ?? "Done");
        setConfirmCancel(false);
        startTransition(() => router.refresh());
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const items: (MenuItem | "separator")[] = [
    { label: "View", icon: <Eye />, onSelect: () => router.push(`/billing/invoices/${row.id}`) },
    { label: "Print", icon: <Printer />, onSelect: () => window.open(`/billing/invoices/${row.id}?print=1`, "_blank") },
    { label: "Download PDF", icon: <FileDown />, onSelect: () => window.print() },
    { label: "Collect payment", icon: <Banknote />, onSelect: () => router.push(`/billing/invoices/${row.id}?tab=payment`), disabled: row.status === "Paid" },
    "separator",
    { label: "Cancel invoice", icon: <XCircle />, danger: true, onSelect: () => setConfirmCancel(true), disabled: row.status === "Paid" || row.status === "Cancelled" },
  ];

  return (
    <>
      <DropdownMenu items={items} trigger={<MoreHorizontal className="size-4" />} />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => run(() => cancelInvoiceAction(row.id))}
        title="Cancel invoice?"
        description={`${row.invoiceNumber} will be marked cancelled and excluded from billing totals. This action cannot be undone.`}
        confirmLabel="Cancel invoice"
        loading={busy}
      />
    </>
  );
}

/* ================================================================== */
/* Payments                                                            */
/* ================================================================== */

export type PaymentRow = {
  id: string;
  paymentId: string;
  customer: { id: string; name: string; username: string; customerCode: string };
  invoice: { id: string; invoiceNumber: string } | null;
  account: { id: string; name: string; type: string };
  collectedBy: { id: string; name: string } | null;
  receipt: { id: string; receiptNumber: string; issuedAt: Date } | null;
  amount: number;
  method: string;
  transactionId: string | null;
  paymentDate: Date;
};

export function PaymentsTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
  areas,
}: {
  rows: PaymentRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  areas: { id: string; name: string }[];
}) {
  const columns: Column<PaymentRow>[] = [
    {
      key: "paymentId",
      header: "Payment ID",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.paymentId}</span>,
      exportValue: (r) => r.paymentId,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <Link href={`/customers/${r.customer.id}`} className="truncate font-medium hover:text-brand-600">
          {r.customer.name}
        </Link>
      ),
      exportValue: (r) => r.customer.name,
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
          <span className="text-xs text-fg-subtle">Unlinked</span>
        ),
      exportValue: (r) => r.invoice?.invoiceNumber ?? "",
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "method", header: "Method", cell: (r) => <Badge>{r.method}</Badge>, exportValue: (r) => r.method },
    { key: "txn", header: "Transaction ID", hideBelow: "lg", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.transactionId ?? "—"}</span>, exportValue: (r) => r.transactionId ?? "" },
    { key: "account", header: "Account", hideBelow: "md", cell: (r) => <span className="text-xs text-fg-muted">{r.account.name}</span>, exportValue: (r) => r.account.name },
    { key: "date", header: "Date", align: "right", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.paymentDate)}</span>, exportValue: (r) => formatDate(r.paymentDate) },
    { key: "by", header: "Collected by", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.collectedBy?.name ?? "System"}</span>, exportValue: (r) => r.collectedBy?.name ?? "" },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <PaymentRowActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search payment, customer, transaction..."
          filters={
            <>
              <FilterSelect param="method" placeholder="All methods" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
              <FilterSelect param="areaId" placeholder="All areas" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="payments" />
              <Link
                href="/billing/payments/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Banknote className="size-4" /> Collect Payment
              </Link>
            </div>
          }
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium">No payments recorded</p>
          <p className="mt-1 text-xs text-fg-muted">Collect a payment to see it listed here.</p>
        </div>
      }
    />
  );
}

function PaymentRowActions({ row }: { row: PaymentRow }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const items: (MenuItem | "separator")[] = [
    { label: "View receipt", icon: <Receipt />, onSelect: () => router.push(`/billing/receipts?paymentId=${row.id}`) },
    { label: "View customer", icon: <Eye />, onSelect: () => router.push(`/customers/${row.customer.id}?tab=payments`) },
    "separator",
    { label: "Refund", icon: <RotateCcw />, danger: true, onSelect: () => setConfirm(true) },
  ];

  return (
    <>
      <DropdownMenu items={items} trigger={<MoreHorizontal className="size-4" />} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          const r = await refundPaymentAction(row.id);
          setBusy(false);
          setConfirm(false);
          if (r.formError) error(r.formError);
          else {
            success(r.success ?? "Refunded");
            startTransition(() => router.refresh());
          }
        }}
        title="Refund this payment?"
        description={`${formatCurrency(row.amount)} will be reversed from ${row.account.name}, the invoice reopened and the receipt marked as refunded.`}
        confirmLabel="Refund payment"
        loading={busy}
      />
    </>
  );
}

/* ================================================================== */
/* Receipts                                                            */
/* ================================================================== */

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

export function ReceiptsTable({
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
        <Link href={`/customers/${r.payment.customer.id}`} className="truncate font-medium hover:text-brand-600">
          {r.payment.customer.name}
        </Link>
      ),
      exportValue: (r) => r.payment.customer.name,
    },
    {
      key: "invoice",
      header: "Invoice",
      hideBelow: "sm",
      cell: (r) => (r.invoice ? <span className="font-mono text-[11px]">{r.invoice.invoiceNumber}</span> : <span className="text-xs text-fg-subtle">—</span>),
      exportValue: (r) => r.invoice?.invoiceNumber ?? "",
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "method", header: "Method", cell: (r) => <Badge>{r.method}</Badge>, exportValue: (r) => r.method },
    { key: "date", header: "Date", align: "right", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.issuedAt)}</span>, exportValue: (r) => formatDate(r.issuedAt) },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <ReceiptRowActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search receipt or customer..."
          filters={<FilterSelect param="method" placeholder="All methods" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />}
          actions={<ExportCsvButton rows={rows} columns={columns} filename="receipts" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium">No receipts yet</p>
          <p className="mt-1 text-xs text-fg-muted">A receipt is generated automatically for every payment.</p>
        </div>
      }
    />
  );
}

function ReceiptRowActions({ row }: { row: ReceiptRow }) {
  const router = useRouter();
  return (
    <DropdownMenu
      items={[
        { label: "View", icon: <Eye />, onSelect: () => window.open(`/billing/receipts/${row.id}`, "_blank") },
        { label: "Print", icon: <Printer />, onSelect: () => window.open(`/billing/receipts/${row.id}?print=1`, "_blank") },
        { label: "Download PDF", icon: <FileDown />, onSelect: () => window.open(`/billing/receipts/${row.id}?print=1`, "_blank") },
        { label: "View customer", icon: <Eye />, onSelect: () => router.push(`/customers/${row.payment.customer.id}?tab=payments`) },
      ]}
      trigger={<MoreHorizontal className="size-4" />}
    />
  );
}
