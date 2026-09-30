"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import {
  invoiceSchema,
  paymentSchema,
  receivePaymentSchema,
  fieldErrors,
  type FieldErrors,
} from "@/lib/validators";
import { createInvoice, recordPayment, generateRenewalInvoice } from "@/lib/services/billing";
import { maybeAutoReconnect } from "@/lib/services/network-enforcement";
import { cancelInvoice } from "@/lib/services/billing-queries";
import { prismaLog } from "@/lib/services/activity";
import { round2 } from "@/lib/utils";

export type BillingFormState = {
  errors?: FieldErrors;
  formError?: string;
  success?: string;
  id?: string;
  paymentId?: string;
  receiptNumber?: string;
  invoiceNumber?: string;
};

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export async function createInvoiceAction(
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const session = await requirePermission("billing.create");
  const raw = Object.fromEntries(formData);
  const parsed = invoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await createInvoice(tx, { ...parsed.data, createdById: session.id });
      await prismaLog(
        tx,
        {
          action: "Create",
          entity: "Invoice",
          entityId: created.id,
          summary: `Invoice ${created.invoiceNumber} created for ${round2(created.total)}`,
        },
        session.id
      );
      return created;
    });

    revalidatePath("/billing/invoices");
    revalidatePath("/customers");
    return {
      success: `Invoice ${invoice.invoiceNumber} created.`,
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Invoice creation failed" };
  }
}

export async function autoRenewAction(customerId: string): Promise<BillingFormState> {
  try {
    const session = await requirePermission("billing.create");
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await generateRenewalInvoice(tx, customerId, session.id);
      await prismaLog(
        tx,
        { action: "Create", entity: "Invoice", entityId: created.id, summary: `Auto renewal invoice ${created.invoiceNumber}` },
        session.id
      );
      return created;
    });
    revalidatePath("/billing/invoices");
    revalidatePath("/customers");
    return { success: `Invoice ${invoice.invoiceNumber} created.`, id: invoice.id };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Auto renewal failed" };
  }
}

export async function cancelInvoiceAction(id: string): Promise<BillingFormState> {
  try {
    const session = await requirePermission("billing.delete");
    await cancelInvoice(id, session.id);
    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${id}`);
    return { success: "Invoice cancelled." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Cancel failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export async function collectPaymentAction(
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const session = await requirePermission("payments.create");
  const raw = Object.fromEntries(formData);
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  const d = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // if no invoice was chosen, auto-pick the oldest unpaid one
      let invoiceId = d.invoiceId || null;
      if (!invoiceId) {
        const oldest = await tx.invoice.findFirst({
          where: { customerId: d.customerId, status: { in: ["Due", "Partial", "Overdue"] } },
          orderBy: { dueDate: "asc" },
        });
        invoiceId = oldest?.id ?? null;
      }

      if (invoiceId) {
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
        const balance = round2(inv.total - inv.paid);
        const net = round2(d.amount - (d.discount ?? 0));
        if (net > balance + 0.009) {
          throw new Error(`Amount exceeds the invoice balance of ${balance}`);
        }
      }

      const payment = await recordPayment(tx, {
        customerId: d.customerId,
        invoiceId,
        amount: d.amount,
        discount: d.discount,
        method: d.method,
        accountId: d.accountId,
        transactionId: d.transactionId,
        paymentDate: d.paymentDate,
        note: d.note,
        collectedById: session.id,
        collectedByResellerId: d.collectedByResellerId ?? null,
      });

      const receipt = await tx.receipt.findFirstOrThrow({
        where: { paymentId: payment.id },
      });

      await prismaLog(
        tx,
        {
          action: "Create",
          entity: "Payment",
          entityId: payment.id,
          summary: `Payment ${payment.paymentId} of ${payment.amount} via ${payment.method}`,
        },
        session.id
      );

      // optional SMS receipt
      if (formData.get("sendSms") === "on") {
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: d.customerId } });
        await tx.notification.create({
          data: {
            channel: "SMS",
            recipient: customer.phone,
            customerId: customer.id,
            template: "payment-receipt",
            body: `Dear ${customer.name}, we received your payment of ${payment.amount} on ${payment.paymentDate.toDateString()}. Receipt ${receipt.receiptNumber}.`,
            status: "Sent",
            sentById: session.id,
            sentAt: new Date(),
          },
        });
      }

      return { payment, receipt };
    });

    // A payment that clears the last of what a suspended customer owed brings
    // their line back without anyone touching the router.
    const restored = await maybeAutoReconnect(result.payment.customerId, session.id);

    revalidatePath("/billing/payments");
    revalidatePath("/billing/invoices");
    revalidatePath("/billing/receipts");
    revalidatePath("/customers");
    revalidatePath("/dashboard");
    revalidatePath("/network");

    return {
      success:
        `Payment ${result.payment.paymentId} recorded. Receipt ${result.receipt.receiptNumber}.` +
        (restored?.ok ? " The line has been reconnected automatically." : ""),
      paymentId: result.payment.paymentId,
      receiptNumber: result.receipt.receiptNumber,
      id: result.payment.id,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Payment failed" };
  }
}

export async function receivePaymentAction(
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const session = await requirePermission("payments.create");
  const raw = Object.fromEntries(formData);
  const parsed = receivePaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  const d = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: d.invoiceId },
        select: { customerId: true, total: true, paid: true },
      });
      const balance = round2(invoice.total - invoice.paid);
      const net = round2(d.amount - (d.discount ?? 0));
      if (net > balance + 0.009) {
        throw new Error(`Amount exceeds the invoice balance of ${balance}`);
      }

      const payment = await recordPayment(tx, {
        customerId: invoice.customerId,
        invoiceId: d.invoiceId,
        amount: d.amount,
        discount: d.discount,
        method: d.method,
        accountId: d.accountId,
        transactionId: d.transactionId,
        paymentDate: d.paymentDate,
        note: d.note,
        collectedById: session.id,
        collectedByResellerId: d.collectedByResellerId ?? null,
      });
      const receipt = await tx.receipt.findFirstOrThrow({ where: { paymentId: payment.id } });
      await prismaLog(
        tx,
        { action: "Create", entity: "Payment", entityId: payment.id, summary: `Payment ${payment.paymentId} of ${payment.amount}` },
        session.id
      );
      return { payment, receipt };
    });

    // Money has moved and the invoice is settled. If that was the last thing
    // keeping this customer suspended, the line comes back up on its own —
    // otherwise someone has to go to the router, and in practice nobody does,
    // which is how a paying customer stays cut off for a week.
    const restored = await maybeAutoReconnect(result.payment.customerId, session.id);

    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${d.invoiceId}`);
    revalidatePath("/billing/payments");
    revalidatePath(`/customers/${result.payment.customerId}`);
    return {
      success:
        `Payment ${result.payment.paymentId} recorded. Receipt ${result.receipt.receiptNumber}.` +
        (restored?.ok ? " The line has been reconnected automatically." : ""),
      receiptNumber: result.receipt.receiptNumber,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Payment failed" };
  }
}

export async function refundPaymentAction(paymentId: string): Promise<BillingFormState> {
  try {
    const session = await requirePermission("payments.delete");
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { invoice: true, account: true, receipt: true },
      });
      if (payment.receipt?.status === "Refunded") throw new Error("Payment is already refunded");

      // reverse the account ledger
      const account = await tx.account.findUniqueOrThrow({ where: { id: payment.accountId } });
      const balance = round2(account.currentBalance - payment.amount);
      await tx.account.update({
        where: { id: account.id },
        data: { currentBalance: balance },
      });
      await tx.accountTransaction.create({
        data: {
          accountId: account.id,
          type: "Refund",
          direction: "Debit",
          amount: payment.amount,
          description: `Refund for payment ${payment.paymentId}`,
          reference: payment.paymentId,
          paymentId: payment.id,
          userId: session.id,
          balance,
          date: new Date(),
        },
      });

      if (payment.invoiceId) {
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
        await tx.invoice.update({
          where: { id: inv.id },
          data: { paid: round2(Math.max(0, inv.paid - payment.amount)) },
        });
      }

      if (payment.receipt) {
        await tx.receipt.update({
          where: { id: payment.receipt.id },
          data: { status: "Refunded" },
        });
      }

      await prismaLog(
        tx,
        { action: "Refund", entity: "Payment", entityId: paymentId, summary: `Refunded ${payment.paymentId} of ${payment.amount}` },
        session.id
      );
    });

    revalidatePath("/billing/payments");
    revalidatePath("/billing/receipts");
    revalidatePath("/customers");
    return { success: "Payment refunded and reversed from the account." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Refund failed" };
  }
}

export async function printRedirect(path: string): Promise<never> {
  revalidatePath(path);
  redirect(path);
}
