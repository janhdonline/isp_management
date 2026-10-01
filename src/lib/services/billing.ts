import { prisma } from "@/lib/prisma";
import { nextNumber, Tx } from "@/lib/counter";
import { getSettings } from "@/lib/settings";
import { addDays, round2, startOfDay } from "@/lib/utils";
import { ActivityInput } from "./activity";

/**
 * Recalculates the denormalised due / billing status columns on a customer.
 * Always called inside a transaction so `previousDue` and invoice sums can
 * never drift apart (ISP.md rule 16: relational consistency).
 */
export async function recomputeCustomerBilling(tx: Tx, customerId: string) {
  const [customer, agg] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id: customerId } }),
    tx.invoice.aggregate({
      where: { customerId, status: { not: "Cancelled" } },
      _sum: { total: true, paid: true },
    }),
  ]);

  const totalBilled = round2(agg._sum.total ?? 0);
  const totalPaid = round2(agg._sum.paid ?? 0);
  const due = round2(Math.max(0, totalBilled - totalPaid));

  // advance payment reduces the outstanding amount
  const netDue = round2(Math.max(0, due - (customer.advancePayment ?? 0)));

  let billingStatus: string = "Unpaid";
  if (netDue <= 0 && totalBilled > 0) billingStatus = "Paid";
  else if (totalPaid > 0 && netDue > 0) billingStatus = "Partial";
  else if (netDue > 0) billingStatus = "Unpaid";

  // overdue = any non-cancelled invoice past its due date and still unpaid
  const overdue = await tx.invoice.count({
    where: { customerId, status: "Due", dueDate: { lt: startOfDay(new Date()) } },
  });
  if (overdue > 0 && netDue > 0) billingStatus = "Overdue";

  await tx.customer.update({
    where: { id: customerId },
    data: { previousDue: netDue, billingStatus },
  });

  return { due: netDue, billingStatus, totalBilled, totalPaid };
}

/** Same recompute, but wrapped in its own transaction for standalone use. */
export function syncCustomerBilling(customerId: string) {
  return prisma.$transaction((tx) => recomputeCustomerBilling(tx, customerId));
}

/** Pushes `billingStatus` on the given invoice from its paid/total ratio. */export async function recomputeInvoiceStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  let status = "Due";
  if (inv.status === "Cancelled") {
    status = "Cancelled";
  } else if (inv.paid >= inv.total - 0.009) {
    status = "Paid";
  } else if (inv.paid > 0) {
    status = "Partial";
  } else if (inv.dueDate < startOfDay(new Date())) {
    status = "Overdue";
  }
  if (status !== inv.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
  return status;
}

/**
 * Maintains the invoice ledger on an account: money in increases balance,
 * money out decreases it. Every row keeps a running `balance` snapshot.
 */
export async function postToAccount(
  tx: Tx,
  input: {
    accountId: string;
    type: string;
    direction: "Credit" | "Debit";
    amount: number;
    description: string;
    reference?: string;
    paymentId?: string;
    expenseId?: string;
    transferId?: string;
    userId?: string;
    date?: Date;
  }
) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: input.accountId } });
  const delta = input.direction === "Credit" ? input.amount : -input.amount;
  const balance = round2(account.currentBalance + delta);

  const row = await tx.accountTransaction.create({
    data: {
      accountId: input.accountId,
      type: input.type,
      direction: input.direction,
      amount: input.amount,
      description: input.description,
      reference: input.reference,
      paymentId: input.paymentId,
      expenseId: input.expenseId,
      transferId: input.transferId,
      userId: input.userId,
      balance,
      date: input.date ?? new Date(),
    },
  });
  await tx.account.update({ where: { id: input.accountId }, data: { currentBalance: balance } });
  return { transaction: row, balance };
}

// ---------------------------------------------------------------------------
// Invoice creation
// ---------------------------------------------------------------------------

export async function createInvoice(
  tx: Tx,
  input: {
    customerId: string;
    packageId?: string | null;
    issueDate: Date;
    dueDate: Date;
    amount: number;
    discount?: number;
    vat?: number;
    note?: string;
    createdById?: string;
  }
) {
  const settings = await getSettings();
  const prefix = settings["billing.invoicePrefix"] ?? "INV";
  const invoiceNumber = await nextNumber(tx, "invoice", `${prefix}-`);

  const discount = round2(input.discount ?? 0);
  const vat = round2(input.vat ?? 0);
  const total = round2(Math.max(0, input.amount - discount) + vat);

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      customerId: input.customerId,
      packageId: input.packageId || null,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      amount: round2(input.amount),
      discount,
      vat,
      total,
      status: "Due",
      note: input.note,
      createdById: input.createdById,
    },
  });

  // The wallet settles what it can, here, inside the transaction that raised the
  // invoice. Doing it a moment later would leave a window in which the invoice is
  // unpaid and the customer's balance has already been spent — long enough for an
  // expiry or FUP sweep to suspend someone who has in fact paid.
  const consumed = await consumeWalletForNewInvoice(tx, invoice.id, input.customerId);
  if (consumed > 0) {
    invoice.paid = round2(consumed);
    invoice.status = await recomputeInvoiceStatus(tx, invoice.id);
    // Consumption moved the invoice's `paid` and the customer's `advancePayment` by
    // the same amount, so the net due is unchanged — but only if it is recomputed
    // from the invoices rather than incremented. A caller that had already added
    // the new invoice's total to `previousDue` is now over-counting by exactly the
    // amount the wallet just paid.
    await recomputeCustomerBilling(tx, input.customerId);
  }

  return invoice;
}

/**
 * Applies the customer's wallet to a freshly created invoice.
 *
 * Kept separate from `wallet.ts` so billing does not import the wallet's
 * transaction helpers directly: `consumeForInvoice` takes its own row lock, and
 * calling it from here would re-lock a row this transaction already holds. That is
 * harmless today but it is one more lock acquisition per invoice than the design
 * needs.
 */
async function consumeWalletForNewInvoice(tx: Tx, invoiceId: string, customerId: string) {
  const { consumeForInvoice } = await import("@/lib/services/wallet");
  const result = await consumeForInvoice(tx, { invoiceId, customerId });
  return result.consumed;
}

/** Generates the renewal invoice for a customer from their current package. */
export async function generateRenewalInvoice(
  tx: Tx,
  customerId: string,
  createdById?: string
) {
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { package: true },
  });
  if (!customer.package) throw new Error("Customer has no package assigned");

  const now = new Date();
  const amount = round2(
    Math.max(0, customer.monthlyBill - (customer.discount ?? 0)) + (customer.vat ?? 0)
  );
  return createInvoice(tx, {
    customerId,
    packageId: customer.packageId,
    issueDate: now,
    dueDate: addDays(now, 0),
    amount,
    discount: customer.discount ?? 0,
    vat: customer.vat ?? 0,
    note: `Auto renewal for ${customer.package.name}`,
    createdById,
  });
}

// ---------------------------------------------------------------------------
// Payment — the ISP.md section 21 payment flow
// ---------------------------------------------------------------------------

export async function recordPayment(
  tx: Tx,
  input: {
    customerId: string;
    invoiceId?: string | null;
    amount: number;
    discount?: number;
    method: string;
    accountId: string;
    transactionId?: string;
    paymentDate: Date;
    note?: string;
    collectedById?: string;
    /** Set when a zone reseller took the cash; the commission report reads it. */
    collectedByResellerId?: string | null;
  },
  activity?: ActivityInput
) {
  const settings = await getSettings();
  const prefix = settings["billing.paymentPrefix"] ?? "PAY";
  const paymentId = await nextNumber(tx, "payment", `${prefix}-`);

  const amount = round2(input.amount);
  const discount = round2(input.discount ?? 0);
  const total = round2(amount - discount);

  const payment = await tx.payment.create({
    data: {
      paymentId,
      customerId: input.customerId,
      invoiceId: input.invoiceId || null,
      amount: total,
      discount,
      method: input.method,
      accountId: input.accountId,
      transactionId: input.transactionId,
      paymentDate: input.paymentDate,
      note: input.note,
      collectedById: input.collectedById,
      // Recorded on the payment itself, not inferred later: this is the fact
      // the commission report is derived from, and it only exists at the moment
      // the cash is taken.
      collectedByResellerId: input.collectedByResellerId ?? null,
    },
  });

  // 1. Invoice updated
  if (input.invoiceId) {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paid: round2(invoice.paid + total) },
    });
    await recomputeInvoiceStatus(tx, invoice.id);
  }

  // 2. Customer due updated
  await recomputeCustomerBilling(tx, input.customerId);

  // 3. Account balance updated
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { name: true, username: true },
  });
  await postToAccount(tx, {
    accountId: input.accountId,
    type: "Payment",
    direction: "Credit",
    amount: total,
    description: `Payment from ${customer?.name ?? input.customerId}${
      input.invoiceId ? ` for invoice` : ""
    }`,
    reference: paymentId,
    paymentId: payment.id,
    userId: input.collectedById,
    date: input.paymentDate,
  });

  // 4. Receipt generated
  const receiptPrefix = settings["billing.receiptPrefix"] ?? "RCP";
  const receiptNumber = await nextNumber(tx, "receipt", `${receiptPrefix}-`);
  await tx.receipt.create({
    data: {
      receiptNumber,
      paymentId: payment.id,
      invoiceId: input.invoiceId || null,
      amount: total,
      method: input.method,
      status: "Paid",
    },
  });

  // 5. SMS credit accounting
  if (activity?.smsBody) {
    const today = startOfDay(new Date());
    const existing = await tx.smsCredit.findFirst({ where: { date: today } });
    if (existing) {
      await tx.smsCredit.update({ where: { id: existing.id }, data: { sent: { increment: 1 } } });
    } else {
      await tx.smsCredit.create({ data: { date: today, sent: 1, balance: 0 } });
    }
  }

  return payment;
}
