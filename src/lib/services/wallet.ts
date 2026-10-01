/**
 * The customer wallet (ISP.md §30).
 *
 * `Customer.advancePayment` is a cached balance. `WalletTransaction` is the truth:
 * one signed row per movement, each carrying the balance it produced. The two are
 * written together, in the same transaction, always — and there is exactly one
 * function in this file that does it. That is the whole design: not "write the
 * ledger, then update the balance", which is two writes and a window in which a
 * crash leaves them disagreeing, but one operation that cannot be half-done.
 *
 * Every movement takes a caller-supplied transaction rather than opening its own,
 * so a top-up can carry its Payment, the account entry and the receipt in the
 * same commit — the cash, the ledger row and the balance all appear together or
 * not at all.
 *
 * Concurrency: `lockCustomer` takes a row lock on the customer before reading
 * the balance. Two simultaneous top-ups would otherwise both read the same
 * balance and both write the same result, which loses one payment's worth of money
 * and leaves the ledger disagreeing with reality. The lock makes them serialise,
 * and the `balanceAfter` snapshot then reads as a real running balance rather than
 * two rows claiming the same one.
 */

import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/counter";
import { round2 } from "@/lib/utils";

export type WalletType = "TopUp" | "Adjustment" | "InvoiceConsume" | "RefundOut";

export type WalletTransactionRow = {
  id: string;
  customerId: string;
  type: WalletType;
  amount: number;
  balanceAfter: number;
  paymentId: string | null;
  invoiceId: string | null;
  reference: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
};

/**
 * Serialises movements for one customer.
 *
 * `SELECT … FOR UPDATE` rather than an advisory lock, because the thing being
 * protected is the customer's own row and the balance lives on it. Every movement
 * calls this first, so the read of `advancePayment` below always happens with the
 * row held.
 */
async function lockCustomer(tx: Tx, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
}

async function balanceOf(tx: Tx, customerId: string): Promise<number> {
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { advancePayment: true },
  });
  return round2(customer.advancePayment ?? 0);
}

/**
 * The single place a wallet movement happens.
 *
 * Ledger row and cached balance, one after the other inside the caller's
 * transaction. Nothing else in this codebase writes `advancePayment`, and nothing
 * else writes a `WalletTransaction` — that is what makes SUM(amount) ==
 * advancePayment a property of the code rather than something to check.
 */
export async function post(
  tx: Tx,
  input: {
    customerId: string;
    type: WalletType;
    amount: number;
    paymentId?: string | null;
    invoiceId?: string | null;
    reference?: string | null;
    note?: string | null;
    createdById?: string | null;
    /** Floor for the resulting balance. Refunds and adjustments stop here. */
    floor?: number;
  }
): Promise<{ transaction: WalletTransactionRow; balance: number }> {
  await lockCustomer(tx, input.customerId);

  const current = await balanceOf(tx, input.customerId);
  const floor = round2(input.floor ?? 0);

  let next = round2(current + input.amount);
  if (next < floor) {
    // Not a throw by default: a refund larger than the balance is a real event
    // that has to reach the ledger, clamped rather than refused. Callers that
    // must refuse (an adjustment, a consumption) check before calling.
    next = floor;
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      customerId: input.customerId,
      type: input.type as string,
      amount: round2(next - current),
      balanceAfter: next,
      paymentId: input.paymentId ?? null,
      invoiceId: input.invoiceId ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
  // Prisma types `type` as a plain string; the union is ours and enforced above.

  await tx.customer.update({ where: { id: input.customerId }, data: { advancePayment: next } });

  return { transaction: transaction as WalletTransactionRow, balance: next };
}

/* ------------------------------------------------------------------ */
/* Top-up                                                              */
/* ------------------------------------------------------------------ */

/**
 * Money in against a payment.
 *
 * Called with the transaction that created the Payment, so the cash, the receipt,
 * the account entry, the ledger row and the balance all land together. A top-up
 * that exists without its payment — or a payment that exists without its ledger
 * row — is money the operator has taken and cannot account for.
 */
export async function topUp(
  tx: Tx,
  input: {
    customerId: string;
    amount: number;
    paymentId: string;
    invoiceId?: string | null;
    note?: string | null;
    createdById?: string | null;
    reference?: string | null;
  }
): Promise<{ transaction: WalletTransactionRow; balance: number }> {
  if (!(input.amount > 0)) {
    throw new Error("A top-up must be greater than zero.");
  }
  return post(tx, {
    customerId: input.customerId,
    type: "TopUp",
    amount: round2(input.amount),
    paymentId: input.paymentId,
    invoiceId: input.invoiceId ?? null,
    reference: input.reference ?? null,
    note: input.note ?? "Wallet top-up",
    createdById: input.createdById ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Adjustment                                                          */
/* ------------------------------------------------------------------ */

/**
 * A hand-typed correction. The only movement with no payment or invoice behind it.
 *
 * The reason is required and checked here rather than in the form, because the
 * form is one of several callers and an adjustment with an empty reason is
 * indistinguishable from a number somebody typed by accident.
 */
export async function adjust(
  tx: Tx,
  input: {
    customerId: string;
    amount: number;
    reason: string;
    createdById?: string | null;
    reference?: string | null;
  }
): Promise<{ transaction: WalletTransactionRow; balance: number }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error(
      "An adjustment needs a reason. It is the only way the wallet moves without a payment or an invoice behind it, so it is the row somebody will read when the balance looks wrong."
    );
  }
  if (input.amount === 0 || !Number.isFinite(input.amount)) {
    throw new Error("An adjustment must be a non-zero amount.");
  }
  const next = round2((await balanceOf(tx, input.customerId)) + input.amount);
  if (next < 0) {
    throw new Error(
      "An adjustment cannot take the wallet below zero — refund the money instead, so the money leaving the ISP is on the account ledger."
    );
  }
  return post(tx, {
    customerId: input.customerId,
    type: "Adjustment",
    amount: round2(input.amount),
    note: reason,
    createdById: input.createdById ?? null,
    reference: input.reference ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

/**
 * Money back to the customer, out of the wallet.
 *
 * Clamped at zero rather than refused: a customer whose wallet holds 200 and is
 * refunded 250 has a real 250-odd refund, and the clamp belongs on this row
 * where it is visible, not on a validation error that hides the event. The
 * shortfall is the wallet's, and it shows as a negative balance elsewhere rather
 * than as a missing transaction.
 */
export async function refundOut(
  tx: Tx,
  input: {
    customerId: string;
    amount: number;
    reason: string;
    createdById?: string | null;
    reference?: string | null;
  }
): Promise<{ transaction: WalletTransactionRow; balance: number }> {
  if (!(input.amount > 0)) throw new Error("A refund must be greater than zero.");
  const reason = input.reason.trim() || "Wallet refund";
  return post(tx, {
    customerId: input.customerId,
    type: "RefundOut",
    amount: -round2(input.amount),
    note: reason,
    createdById: input.createdById ?? null,
    reference: input.reference ?? null,
    floor: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Invoice consumption                                                 */
/* ------------------------------------------------------------------ */

/**
 * Settles what it can of an invoice from the wallet.
 *
 * Called from inside the transaction that creates the invoice, so an invoice that
 * a wallet covers is created already paid rather than appearing as unpaid for
 * the few minutes between the two writes — which for an FUP or suspension check is
 * long enough to suspend a customer who has already paid.
 *
 * Two limits, both of them the reason this is not just `post` with a negative
 * amount: never more than the invoice's outstanding balance, so a wallet cannot
 * silently swallow a bill it was never meant to cover; and never past zero, so
 * consumption cannot manufacture credit.
 *
 * Returns what was consumed, so the caller can record it on the invoice.
 */
export async function consumeForInvoice(
  tx: Tx,
  input: { invoiceId: string; customerId: string; createdById?: string | null }
): Promise<{ consumed: number; balance: number; transaction: WalletTransactionRow | null }> {
  await lockCustomer(tx, input.customerId);

  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { id: true, total: true, paid: true, status: true, invoiceNumber: true },
  });

  const outstanding = round2(invoice.total - invoice.paid);
  const available = await balanceOf(tx, input.customerId);
  const amount = round2(Math.min(Math.max(0, outstanding), Math.max(0, available)));

  if (amount <= 0) {
    return { consumed: 0, balance: available, transaction: null };
  }

  const result = await post(tx, {
    customerId: input.customerId,
    type: "InvoiceConsume",
    amount: -amount,
    invoiceId: invoice.id,
    reference: invoice.invoiceNumber,
    note: `Wallet balance applied to ${invoice.invoiceNumber}`,
    createdById: input.createdById ?? null,
    floor: 0,
  });

  await tx.invoice.update({
    where: { id: invoice.id },
    data: { paid: round2(invoice.paid + amount) },
  });

  return { consumed: amount, balance: result.balance, transaction: result.transaction };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** One customer's ledger, newest first. */
export async function walletHistory(
  customerId: string,
  opts: { take?: number } = {}
) {
  return prisma.walletTransaction.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.take ?? 50,
  });
}

/**
 * The reconciliation check: the ledger must sum to the cached balance for every
 * customer. Exported because it is the invariant, not a nicety — a wallet whose
 * number and history disagree has no way to tell which one is lying.
 *
 * Done in one grouped query rather than per-customer, so it is usable on a
 * database of any size and can run on every verify.
 */
export async function walletDrift() {
  const rows = await prisma.$queryRaw<
    { customerId: string; ledger: number; cached: number; drift: number }[]
  >`
    SELECT
      c.id                                        AS "customerId",
      COALESCE(SUM(w.amount), 0)::float8          AS ledger,
      COALESCE(c."advancePayment", 0)::float8     AS cached,
      (COALESCE(SUM(w.amount), 0) - COALESCE(c."advancePayment", 0))::float8 AS drift
    FROM "Customer" c
    LEFT JOIN "WalletTransaction" w ON w."customerId" = c.id
    GROUP BY c.id, c."advancePayment"
    HAVING ABS(COALESCE(SUM(w.amount), 0) - COALESCE(c."advancePayment", 0)) > 0.005
  `;
  return rows;
}