"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatDate, formatDateTime, formatTime, round2 } from "@/lib/utils";
import { ACCOUNT_TYPES, EXPENSE_CATEGORIES, TRANSACTION_TYPES } from "@/lib/enums";
import { transferFundsAction, createExpenseAction, type AcctFormState } from "@/app/(app)/accounts/actions";
import {
  ArrowRightLeft, Building2, Landmark, Receipt, Wallet, Banknote, Smartphone, CreditCard, AlertCircle, CheckCircle2,
} from "lucide-react";

/* ================================================================== */
/* Account list                                                        */
/* ================================================================== */

export type AccountRow = {
  id: string;
  name: string;
  type: string;
  openingBalance: number;
  currentBalance: number;
  status: string;
  accountNumber: string | null;
  bankName: string | null;
  _count: { transactions: number };
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  Cash: <Banknote className="size-4" />,
  Bank: <Landmark className="size-4" />,
  bKash: <Smartphone className="size-4" />,
  Nagad: <Smartphone className="size-4" />,
  Rocket: <Smartphone className="size-4" />,
  Card: <CreditCard className="size-4" />,
  Other: <Wallet className="size-4" />,
};

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const columns: Column<AccountRow>[] = [
    {
      key: "name",
      header: "Account",
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)] text-fg-muted [&_svg]:size-4">
            {TYPE_ICON[r.type] ?? <Wallet className="size-4" />}
          </span>
          <div className="min-w-0">
            <span className="block truncate font-medium">{r.name}</span>
            {r.bankName ? <span className="block truncate text-[11px] text-fg-subtle">{r.bankName}</span> : null}
          </div>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "type", header: "Type", cell: (r) => <Badge>{r.type}</Badge>, exportValue: (r) => r.type },
    { key: "accountNo", header: "Account No.", hideBelow: "lg", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.accountNumber ?? "—"}</span>, exportValue: (r) => r.accountNumber ?? "" },
    { key: "opening", header: "Opening", align: "right", hideBelow: "xl", cell: (r) => <span className="tnum text-xs text-fg-muted">{formatCurrency(r.openingBalance)}</span>, exportValue: (r) => r.openingBalance },
    {
      key: "balance",
      header: "Current Balance",
      align: "right",
      cell: (r) => (
        <span className={`tnum text-xs font-semibold ${r.currentBalance < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {formatCurrency(r.currentBalance)}
        </span>
      ),
      exportValue: (r) => r.currentBalance,
    },
    { key: "tx", header: "Transactions", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs text-fg-muted">{r._count.transactions}</span>, exportValue: (r) => r._count.transactions },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "120px",
      cell: (r) => (
        <div className="flex justify-end gap-3 text-xs font-medium">
          <Link href={`/accounts/history?accountId=${r.id}`} className="text-brand-600 hover:underline">
            History
          </Link>
          <Link href={`/accounts/transfer?fromAccountId=${r.id}`} className="text-brand-600 hover:underline">
            Transfer
          </Link>
        </div>
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
          searchPlaceholder="Search account, bank..."
          filters={<FilterSelect param="type" placeholder="All types" options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))} />}
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="accounts" />
              <Link
                href="/accounts/transfer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <ArrowRightLeft className="size-4" /> Transfer Fund
              </Link>
            </div>
          }
        />
      }
      empty={
        <EmptyState
          icon={<Landmark />}
          title="No accounts yet"
          description="Create cash, bank or mobile banking accounts to start tracking money."
        />
      }
    />
  );
}

/* ================================================================== */
/* Transfer fund                                                       */
/* ================================================================== */

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Transferring..." : label}
    </Button>
  );
}

export function TransferForm({
  accounts,
  defaultFrom,
}: {
  accounts: AccountRow[];
  defaultFrom?: string;
}) {
  const [state, formAction] = useActionState(transferFundsAction, {} as AcctFormState);
  const [fromId, setFromId] = useState(defaultFrom ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState(0);

  const from = accounts.find((a) => a.id === fromId);
  const available = from?.currentBalance ?? 0;
  const remaining = round2(available - amount);
  const insufficient = amount > available;

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.formError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{state.formError}</p>
        </div>
      ) : null}
      {state.success ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{state.success}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From Account" required error={err("fromAccountId")}>
          <Select
            name="fromAccountId"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))}
            invalid={!!err("fromAccountId")}
          />
        </Field>
        <Field label="To Account" required error={err("toAccountId")}>
          <Select
            name="toAccountId"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            options={accounts.filter((a) => a.id !== fromId).map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))}
            invalid={!!err("toAccountId")}
          />
        </Field>
        <Field label="Amount" required error={err("amount")}>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min={0.01}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            invalid={!!err("amount")}
          />
        </Field>
        <Field label="Transfer Date" required error={err("transferDate")}>
          <Input name="transferDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Reference" error={err("reference")}>
          <Input name="reference" placeholder="Optional" />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Textarea name="note" rows={2} />
        </Field>
      </div>

      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:grid-cols-3">
        <Summary label="Available Balance" value={formatCurrency(available)} />
        <Summary label="Transfer Amount" value={formatCurrency(amount)} />
        <Summary
          label="Remaining Balance"
          value={formatCurrency(remaining)}
          tone={insufficient || remaining < 0 ? "danger" : "default"}
        />
      </div>

      {insufficient ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          The source account does not have enough balance for this transfer.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Submit label="Transfer Fund" />
      </div>
    </form>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "danger" | "default" }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "danger" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</p>
    </div>
  );
}

/* ================================================================== */
/* New expense                                                         */
/* ================================================================== */

export function ExpenseForm({ accounts }: { accounts: { id: string; name: string; type: string; currentBalance: number }[] }) {
  const [state, formAction] = useActionState(createExpenseAction, {} as AcctFormState);
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.formError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{state.formError}</p>
        </div>
      ) : null}
      {state.success ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{state.success}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Expense Category" required error={err("category")}>
          <Select name="category" placeholder="Select category" options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} invalid={!!err("category")} />
        </Field>
        <Field label="Amount" required error={err("amount")}>
          <Input name="amount" type="number" step="0.01" min={0.01} value={amount} onChange={(e) => setAmount(Number(e.target.value))} invalid={!!err("amount")} />
        </Field>
        <Field label="Date" required error={err("date")}>
          <Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Account" required error={err("accountId")} hint={account ? `Balance ${formatCurrency(account.currentBalance)}` : undefined}>
          <Select
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))}
            invalid={!!err("accountId")}
          />
        </Field>
        <Field label="Vendor / Payee" error={err("vendor")}>
          <Input name="vendor" placeholder="Supplier or person paid" />
        </Field>
        <Field label="Reference" error={err("reference")}>
          <Input name="reference" placeholder="Bill / voucher number" />
        </Field>
        <Field label="Description" className="sm:col-span-2" error={err("description")}>
          <Input name="description" placeholder="What was this expense for" />
        </Field>
        <Field label="Attachment URL" className="sm:col-span-2">
          <Input name="attachment" placeholder="https://..." />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Textarea name="note" rows={2} />
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button type="reset" variant="ghost">Reset</Button>
        <Submit label="Save Expense" />
      </div>
    </form>
  );
}

/* ================================================================== */
/* Expense tables                                                      */
/* ================================================================== */

export type ExpenseRow = {
  id: string;
  category: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  date: Date;
  account: { name: string; type: string };
  createdBy: { name: string } | null;
};

export function ExpensesTable({
  rows,
  empty,
  variant = "history",
  filters,
  pagination,
  exportFilename,
  searchPlaceholder,
}: {
  rows: ExpenseRow[];
  empty?: React.ReactNode;
  /** "today" prepends a time column; "history" is the full ledger view. */
  variant?: "today" | "history";
  filters?: React.ReactNode;
  pagination?: React.ReactNode;
  exportFilename?: string;
  searchPlaceholder?: string;
}) {
  const base: Column<ExpenseRow>[] = [
    { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.date)}</span>, exportValue: (r) => formatDate(r.date) },
    { key: "category", header: "Category", cell: (r) => <Badge>{r.category}</Badge>, exportValue: (r) => r.category },
    { key: "description", header: "Description", cell: (r) => <span className="text-xs">{r.description ?? "—"}</span>, exportValue: (r) => r.description ?? "" },
    { key: "vendor", header: "Vendor", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.vendor ?? "—"}</span>, exportValue: (r) => r.vendor ?? "" },
    { key: "account", header: "Account", hideBelow: "md", cell: (r) => <span className="text-xs text-fg-muted">{r.account.name}</span>, exportValue: (r) => r.account.name },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-red-600 dark:text-red-400">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "by", header: "Added by", align: "right", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.createdBy?.name ?? "System"}</span>, exportValue: (r) => r.createdBy?.name ?? "" },
  ];

  const cols: Column<ExpenseRow>[] =
    variant === "today"
      ? [{ key: "time", header: "Time", cell: (r) => <span className="tnum text-xs">{formatTime(r.date)}</span>, exportValue: (r) => formatTime(r.date) }, ...base]
      : base;

  return (
    <DataTableShell
      columns={cols}
      rows={rows}
      rowKey={(r) => r.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder={searchPlaceholder ?? "Search description, vendor, account..."}
          filters={filters}
          actions={
            exportFilename ? (
              <ExportCsvButton rows={rows} columns={cols} filename={exportFilename} label="Export" />
            ) : undefined
          }
        />
      }
      pagination={pagination}
      empty={empty ?? <EmptyState icon={<Receipt />} title="No expenses recorded" description="Expenses you record will be listed here." />}
    />
  );
}

/* ================================================================== */
/* Account history                                                     */
/* ================================================================== */

export type TransactionRow = {
  id: string;
  date: Date;
  type: string;
  direction: string;
  amount: number;
  description: string | null;
  reference: string | null;
  balance: number;
  account: { id: string; name: string; type: string };
};

export function TransactionsTable({
  rows,
  accounts,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: TransactionRow[];
  accounts: { id: string; name: string }[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  const columns: Column<TransactionRow>[] = [
    { key: "id", header: "Transaction", cell: (t) => <span className="font-mono text-[11px] text-fg-muted">{t.id.slice(-8).toUpperCase()}</span>, exportValue: (t) => t.id },
    { key: "date", header: "Date", cell: (t) => <span className="whitespace-nowrap text-xs">{formatDateTime(t.date)}</span>, exportValue: (t) => formatDate(t.date) },
    { key: "account", header: "Account", cell: (t) => <span className="text-xs">{t.account.name}</span>, exportValue: (t) => t.account.name },
    { key: "type", header: "Type", cell: (t) => <Badge>{t.type}</Badge>, exportValue: (t) => t.type },
    { key: "description", header: "Description", hideBelow: "md", cell: (t) => <span className="truncate text-xs text-fg-muted">{t.description ?? "—"}</span>, exportValue: (t) => t.description ?? "" },
    { key: "debit", header: "Debit", align: "right", cell: (t) => <span className="tnum text-xs text-red-600 dark:text-red-400">{t.direction === "Debit" ? formatCurrency(t.amount) : "—"}</span>, exportValue: (t) => (t.direction === "Debit" ? t.amount : "") },
    { key: "credit", header: "Credit", align: "right", cell: (t) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{t.direction === "Credit" ? formatCurrency(t.amount) : "—"}</span>, exportValue: (t) => (t.direction === "Credit" ? t.amount : "") },
    { key: "balance", header: "Balance", align: "right", cell: (t) => <span className="tnum text-xs font-semibold">{formatCurrency(t.balance)}</span>, exportValue: (t) => t.balance },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(t) => t.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search description, reference..."
          filters={
            <>
              <FilterSelect param="accountId" placeholder="All accounts" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
              <FilterSelect param="method" placeholder="All types" options={TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))} />
            </>
          }
          actions={<ExportCsvButton rows={rows} columns={columns} filename="account-history" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={<EmptyState icon={<Building2 />} title="No transactions" description="Account ledger entries will appear here." />}
    />
  );
}
