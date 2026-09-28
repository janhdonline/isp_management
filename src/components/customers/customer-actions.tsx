"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Textarea, Select } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { formatCurrency } from "@/lib/utils";
import { TICKET_PRIORITIES } from "@/lib/enums";
import {
  changePackageAction,
  createInvoiceForCustomerAction,
  createTicketAction,
  reconnectCustomerAction,
  renewCustomerAction,
  sendSmsAction,
  suspendCustomerAction,
} from "@/app/(app)/customers/actions";
import { PackageDialog, RenewDialog, SuspendDialog, ReconnectDialog } from "./customer-list";
import { CalendarPlus, Package as PackageIcon, PauseCircle, PlayCircle } from "lucide-react";

/**
 * The quick-action bar on the customer profile (ISP.md §3). Every action runs
 * through a transactional server action and revalidates the profile on success.
 */
export function CustomerQuickActions({
  customer,
  packages,
}: {
  customer: {
    id: string;
    name: string;
    connectionStatus: string;
    monthlyBill: number;
    previousDue: number;
  };
  packages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<
    null | "renew" | "package" | "suspend" | "reconnect" | "invoice" | "sms" | "ticket"
  >(null);

  const [amount, setAmount] = useState(customer.previousDue || customer.monthlyBill);
  const [smsBody, setSmsBody] = useState(
    `Dear ${customer.name}, your subscription is expiring. Please renew to avoid interruption.`
  );
  const [ticketSubject, setTicketSubject] = useState("No Internet");
  const [ticketPriority, setTicketPriority] = useState("Medium");
  const [ticketDesc, setTicketDesc] = useState("");

  const run = useCallback(
    async (fn: () => Promise<{ success?: string; formError?: string }>, ok: string) => {
      setBusy(true);
      try {
        const r = await fn();
        if (r.formError) error(r.formError);
        else {
          success(r.success ?? ok);
          setDialog(null);
          startTransition(() => router.refresh());
        }
      } catch (e) {
        error(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(false);
      }
    },
    [error, router, success]
  );

  return (
    <div className="flex flex-wrap gap-2 no-print">
      <Link
        href={`/billing/payments/new?customerId=${customer.id}`}
        className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Collect Payment
      </Link>
      <Button variant="outline" icon={<CalendarPlus className="size-4" />} onClick={() => setDialog("renew")}>
        Renew
      </Button>
      <Button variant="outline" onClick={() => router.push(`/customers/${customer.id}/edit`)}>
        Edit
      </Button>
      <Button variant="outline" icon={<PackageIcon className="size-4" />} onClick={() => setDialog("package")}>
        Change Package
      </Button>
      {customer.connectionStatus === "Suspended" ? (
        <Button variant="outline" icon={<PlayCircle className="size-4" />} onClick={() => setDialog("reconnect")}>
          Reconnect
        </Button>
      ) : (
        <Button variant="outline" icon={<PauseCircle className="size-4" />} onClick={() => setDialog("suspend")}>
          Suspend
        </Button>
      )}
      <Button variant="outline" onClick={() => setDialog("invoice")}>
        Create Invoice
      </Button>
      <Button variant="outline" onClick={() => setDialog("ticket")}>
        Create Ticket
      </Button>
      <Button variant="outline" onClick={() => setDialog("sms")}>
        Send SMS
      </Button>
      <Button variant="outline" onClick={() => window.print()}>
        Print
      </Button>

      <RenewDialog
        open={dialog === "renew"}
        onClose={() => setDialog(null)}
        busy={busy}
        defaultDays={30}
        onConfirm={(days) => run(() => renewCustomerAction(customer.id, days), "Subscription renewed")}
      />
      <PackageDialog
        open={dialog === "package"}
        onClose={() => setDialog(null)}
        busy={busy}
        packages={packages}
        onConfirm={(pkgId, reason) => run(() => changePackageAction(customer.id, pkgId, reason), "Package changed")}
      />
      <SuspendDialog
        open={dialog === "suspend"}
        onClose={() => setDialog(null)}
        busy={busy}
        onConfirm={(reason) => run(() => suspendCustomerAction(customer.id, reason), "Customer suspended")}
      />
      <ReconnectDialog
        open={dialog === "reconnect"}
        onClose={() => setDialog(null)}
        busy={busy}
        onConfirm={() => run(() => reconnectCustomerAction(customer.id), "Customer reconnected")}
      />

      <Modal
        open={dialog === "invoice"}
        onClose={() => setDialog(null)}
        title="Create invoice"
        description="A draft invoice is created for this customer and can be paid straight away."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => run(() => createInvoiceForCustomerAction(customer.id, amount), "Invoice created")}
            >
              Create invoice
            </Button>
          </>
        }
      >
        <Field label="Amount" required>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <p className="mt-2 text-xs text-fg-muted">
          Outstanding due: {formatCurrency(customer.previousDue)} · monthly bill:{" "}
          {formatCurrency(customer.monthlyBill)}
        </p>
      </Modal>

      <Modal
        open={dialog === "sms"}
        onClose={() => setDialog(null)}
        title="Send SMS"
        description="The message is written to the notification log and dispatched through the configured provider."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => run(() => sendSmsAction(customer.id, smsBody), "SMS sent")}>
              Send now
            </Button>
          </>
        }
      >
        <Field label="Message" required>
          <Textarea rows={4} value={smsBody} onChange={(e) => setSmsBody(e.target.value)} />
        </Field>
        <p className="mt-1 text-right text-[11px] text-fg-subtle">{smsBody.length} characters</p>
      </Modal>

      <Modal
        open={dialog === "ticket"}
        onClose={() => setDialog(null)}
        title="Create support ticket"
        description="Opens a ticket linked to this customer so support history stays in one place."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                run(
                  () => createTicketAction(customer.id, ticketSubject, ticketDesc, ticketPriority),
                  "Ticket created"
                )
              }
            >
              Create ticket
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Subject" required>
            <Input value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} />
          </Field>
          <Field label="Priority">
            <Select
              value={ticketPriority}
              onChange={(e) => setTicketPriority(e.target.value)}
              options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Description">
            <Textarea rows={4} value={ticketDesc} onChange={(e) => setTicketDesc(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
