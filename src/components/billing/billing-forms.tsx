"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/enums";
import { formatCurrency, formatDate, round2 } from "@/lib/utils";
import { collectPaymentAction, receivePaymentAction, createInvoiceAction, BillingFormState } from "@/app/(app)/billing/actions";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

type Account = { id: string; name: string; type: string; currentBalance: number };
type CustomerOption = { id: string; name: string; customerCode: string; username: string; phone: string };
type InvoiceOption = { id: string; invoiceNumber: string; total: number; paid: number; dueDate: Date };

function Alert({ state }: { state: BillingFormState }) {
  if (state.formError) {
    return (
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <p>{state.formError}</p>
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <div>
          <p>{state.success}</p>
          {state.receiptNumber ? <p className="mt-0.5 font-mono text-xs">Receipt {state.receiptNumber}</p> : null}
        </div>
      </div>
    );
  }
  return null;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Processing..." : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Collect payment                                                     */
/* ------------------------------------------------------------------ */

export function CollectPaymentForm({
  customers,
  accounts,
  resellers,
  invoicesByCustomer,
  defaultCustomerId,
  defaultInvoiceId,
  today,
}: {
  customers: CustomerOption[];
  accounts: Account[];
  /** Optional: only zone resellers exist to take cash on a customer's behalf. */
  resellers?: { id: string; name: string }[];
  invoicesByCustomer: Record<string, InvoiceOption[]>;
  defaultCustomerId?: string;
  defaultInvoiceId?: string;
  /** `YYYY-MM-DD` computed on the server so the render stays pure. */
  today: string;
}) {
  const [state, formAction] = useActionState(collectPaymentAction, {} as BillingFormState);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId ?? "");
  const [method, setMethod] = useState("Cash");
  const [discount, setDiscount] = useState(0);
  /** null means "follow the selected invoice balance". */
  const [override, setOverride] = useState<number | null>(null);

  const invoices = invoicesByCustomer[customerId] ?? [];
  const selected = invoices.find((i) => i.id === invoiceId);
  const balance = selected ? round2(selected.total - selected.paid) : 0;
  const amount: number | "" = override ?? (selected ? balance : "");

  // Choosing a different invoice or customer resets any manual amount.
  const [lastSelection, setLastSelection] = useState({ customerId, invoiceId });
  if (lastSelection.customerId !== customerId || lastSelection.invoiceId !== invoiceId) {
    setLastSelection({ customerId, invoiceId });
    setOverride(null);
  }

  // keep the account aligned with the chosen method
  const suggestedAccount = accounts.find((a) => a.type === methodToType(method));
  const [pickedAccount, setPickedAccount] = useState<string | undefined>(undefined);
  const accountId = pickedAccount ?? suggestedAccount?.id ?? accounts[0]?.id;

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" required error={err("customerId")} className="sm:col-span-2">
          <Select
            name="customerId"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setInvoiceId("");
            }}
            placeholder="Search customer"
            options={customers.map((c) => ({ value: c.id, label: `${c.name} — ${c.username} — ${c.phone}` }))}
            invalid={!!err("customerId")}
          />
        </Field>

        <Field label="Invoice" error={err("invoiceId")} hint={selected ? `Balance ${formatCurrency(balance)}` : "Oldest unpaid invoice is used if left blank"}>
          <Select
            name="invoiceId"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            placeholder="Oldest unpaid invoice"
            options={invoices.map((i) => ({ value: i.id, label: `${i.invoiceNumber} — due ${formatDate(i.dueDate)} — ${formatCurrency(i.total - i.paid)}` }))}
          />
        </Field>

        <Field label="Amount" required error={err("amount")}>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min={0.01}
            value={amount}
            onChange={(e) => setOverride(e.target.value === "" ? null : Number(e.target.value))}
            invalid={!!err("amount")}
          />
        </Field>

        <Field label="Discount" error={err("discount")}>
          <Input name="discount" type="number" step="0.01" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </Field>

        <Field label="Payment Method" required error={err("method")}>
          <Select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
            invalid={!!err("method")}
          />
        </Field>

        <Field label="Account" required error={err("accountId")} hint="Where the money lands">
          <Select
            id="accountId"
            name="accountId"
            value={accountId}
            onChange={(e) => setPickedAccount(e.target.value)}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type}) — ${formatCurrency(a.currentBalance)}` }))}
            placeholder="Select account"
            invalid={!!err("accountId")}
          />
        </Field>

        {/* Optional and easy to miss on purpose: it is only relevant when cash
            came through a zone reseller, and the commission report is derived
            from whatever is set here. */}
        <Field
          label="Collected by reseller"
          error={err("collectedByResellerId")}
          hint="Optional. Only when a zone reseller took the cash, so the commission is tracked."
        >
          <Select
            name="collectedByResellerId"
            defaultValue=""
            options={[{ value: "", label: "Staff at the office" }, ...(resellers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
            placeholder="Staff at the office"
          />
        </Field>

        <Field label="Transaction ID" error={err("transactionId")} hint="Mobile banking / card reference">
          <Input name="transactionId" placeholder="TXN123456" />
        </Field>

        <Field label="Payment Date" required error={err("paymentDate")}>
          <Input name="paymentDate" type="date" defaultValue={today} invalid={!!err("paymentDate")} />
        </Field>

        <Field label="Note" className="sm:col-span-2">
          <Textarea name="note" rows={2} placeholder="Optional reference or remark" />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="sendSms" defaultChecked />
        Send an SMS confirmation to the customer
      </label>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button type="button" variant="outline" onClick={() => window.history.back()}>
          Cancel
        </Button>
        <SubmitButton label="Collect Payment" />
      </div>
    </form>
  );
}

/** Adds `days` to an ISO `YYYY-MM-DD` string without touching `Date.now()`. */
function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function methodToType(method: string) {
  if (method === "Cash") return "Cash";
  if (method === "Bank") return "Bank";
  if (method === "bKash") return "bKash";
  if (method === "Nagad") return "Nagad";
  if (method === "Card") return "Card";
  return "Other";
}

/* ------------------------------------------------------------------ */
/* Receive payment on a specific invoice                               */
/* ------------------------------------------------------------------ */

export function InvoicePaymentForm({
  invoiceId,
  balance,
  dueDate,
  invoiceNumber,
  accounts,
  today,
}: {
  invoiceId: string;
  balance: number;
  dueDate: Date;
  invoiceNumber: string;
  accounts: Account[];
  /** `YYYY-MM-DD` computed on the server so the render stays pure. */
  today: string;
}) {
  const [state, formAction] = useActionState(receivePaymentAction, {} as BillingFormState);
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState(balance);

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Alert state={state} />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
        <p className="font-mono text-xs text-fg-muted">{invoiceNumber}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(balance)}</p>
        <p className="text-xs text-fg-muted">Due {formatDate(dueDate)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" required error={err("amount")}>
          <Input name="amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} invalid={!!err("amount")} />
        </Field>
        <Field label="Discount" error={err("discount")}>
          <Input name="discount" type="number" step="0.01" min={0} defaultValue={0} />
        </Field>
        <Field label="Method" required error={err("method")}>
          <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Account" required error={err("accountId")}>
          <Select name="accountId" defaultValue={accounts[0]?.id} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))} placeholder="Select" invalid={!!err("accountId")} />
        </Field>
        <Field label="Transaction ID">
          <Input name="transactionId" />
        </Field>
        <Field label="Payment Date" required>
          <Input name="paymentDate" type="date" defaultValue={today} />
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton label="Receive Payment" />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* New invoice                                                         */
/* ------------------------------------------------------------------ */

export function CreateInvoiceForm({
  customers,
  defaultCustomerId,
  today,
  dueInDays = 5,
}: {
  customers: (CustomerOption & { monthlyBill: number; packageName: string | null })[];
  defaultCustomerId?: string;
  /** `YYYY-MM-DD` computed on the server so the render stays pure. */
  today: string;
  dueInDays?: number;
}) {
  const [state, formAction] = useActionState(createInvoiceAction, {} as BillingFormState);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const customer = customers.find((c) => c.id === customerId);
  const [discount, setDiscount] = useState(0);
  const [vat, setVat] = useState(0);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDaysIso(today, dueInDays));
  /** null = follow the selected customer's monthly bill. */
  const [override, setOverride] = useState<number | null>(null);

  // Switching customer resets any manual amount back to their package price.
  const [lastCustomer, setLastCustomer] = useState(customerId);
  if (lastCustomer !== customerId) {
    setLastCustomer(customerId);
    setOverride(null);
  }

  const amount = override ?? customer?.monthlyBill ?? 0;
  const total = round2(Math.max(0, amount - discount) + vat);
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" required error={err("customerId")} className="sm:col-span-2">
          <Select
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            options={customers.map((c) => ({ value: c.id, label: `${c.name} — ${c.username}` }))}
            placeholder="Search customer"
            invalid={!!err("customerId")}
          />
        </Field>

        {customer ? (
          <div className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-fg-muted">
            Package: <strong className="text-[var(--fg)]">{customer.packageName ?? "—"}</strong> ·
            Monthly bill: <strong className="tnum text-[var(--fg)]">{formatCurrency(customer.monthlyBill)}</strong>
          </div>
        ) : null}

        <Field label="Issue Date" required error={err("issueDate")}>
          <Input name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field label="Due Date" required error={err("dueDate")}>
          <Input name="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>

        <Field label="Amount" required error={err("amount")}>
          <Input name="amount" type="number" step="0.01" min={0} value={amount} onChange={(e) => setOverride(Number(e.target.value))} />
        </Field>
        <Field label="Discount" error={err("discount")}>
          <Input name="discount" type="number" step="0.01" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </Field>
        <Field label="VAT" error={err("vat")}>
          <Input name="vat" type="number" step="0.01" min={0} value={vat} onChange={(e) => setVat(Number(e.target.value))} />
        </Field>
        <div className="flex items-end">
          <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <p className="text-xs text-fg-muted">Invoice total</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(total)}</p>
          </div>
        </div>

        <Field label="Note" className="sm:col-span-2">
          <Textarea name="note" rows={2} />
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button type="button" variant="outline" onClick={() => window.history.back()}>
          Cancel
        </Button>
        <SubmitButton label="Create Invoice" />
      </div>
    </form>
  );
}
