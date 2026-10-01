"use client";

/**
 * The wallet panel on a customer's profile.
 *
 * Two forms and one ledger. The top-up is the ordinary case and takes the
 * customer's cash; the adjustment is the dangerous one and is deliberately not the
 * same shape — it asks for a reason before it asks for anything else, and it is
 * the only control here that can move money with no payment behind it.
 */

import { useActionState, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/billing/billing-forms";
import { type BillingFormState } from "@/app/(app)/billing/actions";

import { formatCurrency, formatDateTime } from "@/lib/utils";
import { walletTopUpAction, walletAdjustAction } from "@/app/(app)/billing/actions";
import { Wallet, ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

export type WalletRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  paymentId: string | null;
  invoiceId: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
};

const TYPE_HINT: Record<string, string> = {
  TopUp: "Cash added, always against a payment receipt.",
  InvoiceConsume: "Applied automatically to a bill the wallet covered.",
  Adjustment: "A manual correction. No payment or invoice behind it.",
  RefundOut: "Money returned to the customer from the wallet.",
};

/** Where the top-up's cash should be booked. */
export type WalletAccountOption = { id: string; name: string; type: string };

export function WalletPanel({
  customerId,
  balance,
  rows,
  accounts,
  today,
}: {
  customerId: string;
  balance: number;
  rows: WalletRow[];
  accounts: WalletAccountOption[];
  today: string;
}) {
  const [mode, setMode] = useState<"topup" | "adjust">("topup");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Wallet balance"
          description="Money the customer has paid in advance. It is applied to their next bill automatically."
        />
        <CardBody>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="tnum text-2xl font-semibold">{formatCurrency(balance)}</span>
            <span className="text-xs text-fg-muted">
              across {rows.length} transaction{rows.length === 1 ? "" : "s"}
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Move money"
          description={
            mode === "topup"
              ? "Takes the customer's cash and books it to the wallet, with a receipt."
              : "Corrects the balance by hand. Everything else is tied to a payment or an invoice."
          }
        />
        <CardBody>
          <div className="mb-3 flex gap-1">
            {(["topup", "adjust"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                  (mode === m
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                    : "border-[var(--border-strong)] text-fg-subtle hover:bg-[var(--surface-3)]")
                }
              >
                {m === "topup" ? "Add to wallet" : "Adjust balance"}
              </button>
            ))}
          </div>

          {mode === "topup" ? (
            <TopUpForm customerId={customerId} accounts={accounts} today={today} />
          ) : (
            <AdjustForm customerId={customerId} balance={balance} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Ledger"
          description="Every movement, newest first. The balance column is what the wallet held immediately after that row."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                      {formatDateTime(new Date(r.createdAt))}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.type} />
                      <p className="mt-0.5 max-w-xs text-[11px] text-fg-subtle">
                        {TYPE_HINT[r.type] ?? ""}
                      </p>
                      {r.note ? (
                        <p className="mt-0.5 max-w-xs text-[11px] text-fg-muted">{r.note}</p>
                      ) : null}
                    </td>
                    <td
                      className={
                        "tnum whitespace-nowrap px-3 py-2 text-right text-xs font-medium " +
                        (r.amount >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400")
                      }
                    >
                      {r.amount >= 0 ? "+" : ""}
                      {formatCurrency(r.amount)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-xs">
                      {formatCurrency(r.balanceAfter)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">
                      {r.reference ?? r.invoiceId ?? r.paymentId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{r.createdByName ?? "System"}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-fg-muted">
                      Nothing in this wallet yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TopUpForm({
  customerId,
  accounts,
  today,
}: {
  customerId: string;
  accounts: WalletAccountOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    walletTopUpAction,
    {} as BillingFormState
  );
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <Alert state={state} />
      <input type="hidden" name="customerId" value={customerId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" required error={err("amount")}>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue="1000"
            required
            invalid={!!err("amount")}
          />
        </Field>
        <Field label="Method" required error={err("method")}>
          <Select name="method" defaultValue="Cash">
            {["Cash", "bKash", "Nagad", "Bank", "Card", "Online"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Booked to account" required error={err("accountId")}>
          <Select name="accountId" defaultValue={accounts[0]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={err("paymentDate")}>
          <Input name="paymentDate" type="date" defaultValue={today} />
        </Field>
      </div>

      <Field label="Note">
        <Textarea name="note" rows={2} placeholder="Paying ahead for the next two months" />
      </Field>

      <Button type="submit" disabled={pending || accounts.length === 0}>
        <Wallet className="size-4" />
        {pending ? "Adding…" : "Add to wallet"}
      </Button>
      {accounts.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          There is no cash account to book this to. Create one in Accounts first — a top-up
          with nowhere to land is money the books cannot account for.
        </p>
      ) : null}
    </form>
  );
}

function AdjustForm({
  customerId,
  balance,
}: {
  customerId: string;
  balance: number;
}) {
  const [state, formAction, pending] = useActionState(
    walletAdjustAction,
    {} as BillingFormState
  );
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <Alert state={state} />
      <input type="hidden" name="customerId" value={customerId} />

      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <Scale className="mr-1 inline size-3.5" />
        An adjustment is the only way this balance moves without a payment or an invoice behind
        it, so it is audited and it needs a reason. Use a refund to send money back — that is
        the one that belongs on the account ledger too.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Amount"
          required
          error={err("amount")}
          hint={`Positive adds, negative takes. Current balance ${formatCurrency(balance)}.`}
        >
          <Input
            name="amount"
            type="number"
            step="0.01"
            required
            placeholder="-250"
            invalid={!!err("amount")}
          />
        </Field>
        <Field label="Reason" required error={err("reason")}>
          <Input
            name="reason"
            required
            placeholder="Cash counted short in the drawer on 12 Oct"
            invalid={!!err("reason")}
          />
        </Field>
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        <ArrowUpRight className="size-4" />
        {pending ? "Adjusting…" : "Adjust balance"}
      </Button>
      <p className="text-xs text-fg-subtle">
        <ArrowDownLeft className="mr-1 inline size-3.5" />
        Refunds belong on the refund flow, which books the money out of the cash account as
        well.
      </p>
    </form>
  );
}