"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, Undo2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { issueRefundAction, type AcctFormState } from "@/app/(app)/accounts/actions";
import { useToast } from "@/components/providers";

type AccountOption = { id: string; name: string };

type Customer = {
  id: string;
  name: string;
  username: string;
  phone: string;
  previousDue: number;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="danger"
      icon={<Undo2 className="size-4" />}
      loading={pending}
    >
      {pending ? "Refunding..." : "Issue refund"}
    </Button>
  );
}

/**
 * Refund form. The customer's outstanding due is shown as they are picked, so
 * the amount is checked against something visible rather than guessed at — the
 * server refuses a refund larger than the due, and this makes that visible
 * before they submit.
 */
export function RefundForm({
  customers,
  accounts,
}: {
  customers: Customer[];
  accounts: AccountOption[];
}) {
  const [state, formAction] = useActionState(issueRefundAction, {} as AcctFormState);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");

  const { success } = useToast();
  const router = useRouter();
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  // Surface the action's own message as a toast once, then let the inline
  // banner show the form-level result.
  if (state.success && state.success !== lastSuccess) {
    setLastSuccess(state.success);
    success(state.success);
    setAmount("");
    router.refresh();
  }

  const customer = customers.find((c) => c.id === customerId);
  const due = customer?.previousDue ?? 0;
  const amountNum = Number(amount) || 0;
  const tooMuch = customerId && amountNum > due;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.formError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{state.formError}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Customer"
          required
          className="sm:col-span-2"
          error={state.errors?.customerId?.[0]}
        >
          <Select
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="Select a customer"
            options={customers.map((c) => ({
              value: c.id,
              label: `${c.name} — ${c.username} — owes ${formatCurrency(c.previousDue)}`,
            }))}
            invalid={!!state.errors?.customerId}
          />
        </Field>

        {customer ? (
          <div className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
            <span className="text-fg-muted">Outstanding due:</span>{" "}
            <span className="font-semibold tabular-nums">{formatCurrency(due)}</span>
            <span className="ml-2 text-xs text-fg-subtle">
              A refund cannot be more than this. Anything beyond it is an adjustment.
            </span>
          </div>
        ) : null}

        <Field
          label="Refund from account"
          required
          error={state.errors?.accountId?.[0]}
          hint="Usually the account the customer paid into"
        >
          <Select
            name="accountId"
            placeholder="Select an account"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            invalid={!!state.errors?.accountId}
          />
        </Field>

        <Field
          label="Amount"
          required
          error={state.errors?.amount?.[0]}
        >
          <Input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder={due ? String(due) : "0.00"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            invalid={!!state.errors?.amount || !!tooMuch}
          />
        </Field>

        {tooMuch ? (
          <p className="sm:col-span-2 text-xs text-red-600 dark:text-red-400">
            That is more than the {formatCurrency(due)} this customer owes.
          </p>
        ) : null}

        <Field
          label="Reason"
          required
          className="sm:col-span-2"
          error={state.errors?.reason?.[0]}
        >
          <Select
            name="reason"
            placeholder="Select a reason"
            options={[
              { value: "Service not delivered", label: "Service not delivered" },
              { value: "Overcharged", label: "Overcharged" },
              { value: "Customer cancelled", label: "Customer cancelled" },
              { value: "Goodwill", label: "Goodwill" },
              { value: "Duplicate payment", label: "Duplicate payment" },
              { value: "Other", label: "Other" },
            ]}
            invalid={!!state.errors?.reason}
          />
        </Field>

        <Field label="Date" error={state.errors?.date?.[0]}>
          <Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>

        <Field label="Note" error={state.errors?.note?.[0]}>
          <Input name="note" placeholder="Optional internal note" />
        </Field>

        <Field
          label="Against payment ID"
          className="sm:col-span-2"
          hint="Optional — link this refund to a specific payment"
        >
          <Input name="paymentId" placeholder="e.g. PAY-000123" />
        </Field>
      </div>

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
