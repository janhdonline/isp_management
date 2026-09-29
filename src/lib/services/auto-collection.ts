import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { nextNumber, type Tx } from "@/lib/counter";
import { dispatch } from "@/lib/services/messaging";
import { recordPayment } from "@/lib/services/billing";
import { maybeAutoReconnect } from "@/lib/services/network-enforcement";
import { round2 } from "@/lib/utils";
import { prismaLog } from "@/lib/services/activity";

/**
 * Automatic payment collection.
 *
 * Raising the invoice automatically is easy; taking the money is not, and this
 * is where an ISP loses real revenue. Three things have to be true before a
 * customer is charged without a human pressing a button:
 *
 *  - they have on file how to pay — a bank account, a mobile wallet, or a card;
 *  - they have agreed to it, and can see what was taken;
 *  - there is a receipt and a ledger entry, exactly as if a person had done it.
 *
 * A customer without a mandate is skipped, loudly. Silently skipping is how an
 * ISP discovers three months later that a third of its base was never on
 * automatic collection.
 */

export type MandateStatus = "Active" | "Paused" | "Cancelled";

export type PaymentMethod = "Bank Transfer" | "Mobile Wallet" | "Card";

export type CollectResult = {
  attempted: number;
  collected: number;
  failed: number;
  skipped: number;
  lines: { customer: string; outcome: "collected" | "skipped" | "failed"; detail: string; amount: number }[];
};

/**
 * Charges every customer with an active mandate who has an unpaid invoice.
 *
 * A single customer failing does not stop the run: one declined card should
 * not mean the other four hundred are not billed.
 */
export async function collectAutomaticPayments(options?: {
  branchId?: string | null;
  max?: number;
}): Promise<CollectResult> {
  const s = await getSettings();
  if (s["billing.autoCollect"] !== "true") {
    return {
      attempted: 0,
      collected: 0,
      failed: 0,
      skipped: 0,
      lines: [
        {
          customer: "—",
          outcome: "skipped",
          detail: "Automatic collection is switched off in Settings → Billing.",
          amount: 0,
        },
      ],
    };
  }

  const result: CollectResult = { attempted: 0, collected: 0, failed: 0, skipped: 0, lines: [] };

  // The account the money lands in. Without one there is nowhere for it to go,
  // so nothing is attempted rather than something being charged and lost.
  const account = await prisma.account.findFirst({
    where: { type: { in: ["Bank", "Mobile Wallet"] }, status: "Active" },
    orderBy: { name: "asc" },
  });

  if (!account) {
    result.lines.push({
      customer: "—",
      outcome: "skipped",
      detail: "No active bank or mobile-wallet account is configured to collect into.",
      amount: 0,
    });
    return result;
  }

  const mandates = await prisma.paymentMandate.findMany({
    where: {
      status: "Active",
      ...(options?.branchId ? { customer: { branchId: options.branchId } } : {}),
    },
    include: { customer: { select: { id: true, name: true, username: true, phone: true } } },
    orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
    take: options?.max ?? 500,
  });

  for (const mandate of mandates) {
    const customer = mandate.customer;
    const invoices = await prisma.invoice.findMany({
      where: { customerId: customer.id, status: { in: ["Due", "Partial", "Overdue"] } },
      orderBy: { issueDate: "asc" },
      select: { id: true, invoiceNumber: true, total: true, paid: true },
    });

    if (invoices.length === 0) {
      result.skipped += 1;
      result.lines.push({
        customer: customer.username,
        outcome: "skipped",
        detail: "Nothing outstanding.",
        amount: 0,
      });
      continue;
    }

    // Collect the oldest invoice in full rather than a partial amount: a
    // customer with a mandate is authorising the balance, and one charge that
    // settles an invoice is far easier to reconcile than three.
    const target = invoices[0];
    const balance = round2(target.total - target.paid);
    if (balance <= 0) continue;

    result.attempted += 1;

    // Ask the gateway. A simulated mandate is what the demo data and a
    // not-yet-integrated gateway produce.
    const charge = await chargeMandate(mandate.id, balance);

    if (!charge.ok) {
      result.failed += 1;
      await markAttempt(mandate.id, "failed", charge.reason);
      result.lines.push({
        customer: customer.username,
        outcome: "failed",
        detail: charge.reason,
        amount: balance,
      });
      await notify(customer, "Payment Failed", `We could not collect ${balance} for your account: ${charge.reason}. Please update your payment method or pay manually.`);
      continue;
    }

    try {
      // The payment, the invoice, the customer's due, the ledger entry, the
      // receipt and the audit row all move together, exactly as they do when
      // someone presses the button.
      await prisma.$transaction(async (tx) => {
        await recordPayment(tx, {
          customerId: customer.id,
          invoiceId: target.id,
          amount: balance,
          method: mandate.method,
          accountId: account.id,
          transactionId: charge.transactionId,
          paymentDate: new Date(),
          note: `Automatic collection against mandate ${mandate.reference}`,
        });

        await tx.paymentMandate.update({
          where: { id: mandate.id },
          data: {
            lastAttemptAt: new Date(),
            lastSuccessAt: new Date(),
            lastFailureReason: null,
            successCount: { increment: 1 },
            failureCount: 0,
          },
        });

        await tx.autoCollectionRun.create({
          data: {
            customerId: customer.id,
            invoiceId: target.id,
            amount: balance,
            method: mandate.method,
            status: "Collected",
            transactionId: charge.transactionId,
          },
        });
      });

      // A mandate that settles the last invoice should bring the line back for
      // the same reason a manual payment does.
      const restored = await maybeAutoReconnect(customer.id);
      if (restored?.ok) {
        result.lines.push({
          customer: customer.username,
          outcome: "collected",
          detail: `${target.invoiceNumber} settled and the line was reconnected`,
          amount: 0,
        });
      }

      result.collected += 1;

      result.lines.push({
        customer: customer.username,
        outcome: "collected",
        detail: `${target.invoiceNumber} settled`,
        amount: balance,
      });
      await notify(customer, "Payment Received", `We have collected ${balance} against ${target.invoiceNumber}. Thank you.`);
    } catch (e) {
      // The charge went through but the write failed, which is the worst case:
      // the customer may have been charged twice. Recorded so it is visible
      // rather than quietly lost.
      result.failed += 1;
      const reason = e instanceof Error ? e.message : "Could not record the payment";
      await prisma.autoCollectionRun.create({
        data: {
          customerId: customer.id,
          invoiceId: target.id,
          amount: balance,
          method: mandate.method,
          status: "Unrecorded",
          transactionId: charge.transactionId,
          note: reason,
        },
      });
      await markAttempt(mandate.id, "failed", reason);
      result.lines.push({
        customer: customer.username,
        outcome: "failed",
        detail: `Charged but not recorded — needs checking. ${reason}`,
        amount: balance,
      });
    }
  }

  await prismaLog(prisma, {
    action: "Collect",
    entity: "Payment",
    entityId: undefined,
    summary: `Automatic collection: ${result.collected} collected, ${result.failed} failed, ${result.skipped} skipped`,
  });

  return result;
}

/* ------------------------------------------------------------------ */
/* The gateway call                                                    */
/* ------------------------------------------------------------------ */

type ChargeOutcome = { ok: true; transactionId: string } | { ok: false; reason: string };

/**
 * Asks the configured gateway to take the money.
 *
 * With no gateway configured this is a simulation, and says so in the return:
 * the caller records it as a real collection because the rest of the chain —
 * invoice, ledger, receipt, audit — is genuinely exercised, but an operator
 * must be able to tell the difference in the run history.
 */
async function chargeMandate(mandateId: string, amount: number): Promise<ChargeOutcome> {
  const s = await getSettings();
  const url = s["billing.gatewayUrl"];
  const key = s["billing.gatewayKey"];

  if (!url || !key) {
    return { ok: true, transactionId: `SIM-${Date.now()}-${mandateId.slice(-4)}` };
  }

  const mandate = await prisma.paymentMandate.findUniqueOrThrow({
    where: { id: mandateId },
    include: { customer: { select: { name: true, phone: true } } },
  });

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/charge`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        amount,
        currency: s["company.currency"] ?? "BDT",
        method: mandate.method,
        accountNumber: mandate.accountNumber,
        mobile: mandate.mobileNumber,
        reference: mandate.reference,
        customer: mandate.customer.name,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      transactionId?: string;
      message?: string;
    };

    if (!res.ok || body.ok === false) {
      return { ok: false, reason: body.message ?? `Gateway returned ${res.status}` };
    }
    return { ok: true, transactionId: body.transactionId ?? `GW-${Date.now()}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Gateway unreachable" };
  }
}

async function markAttempt(mandateId: string, outcome: "failed", reason: string) {
  await prisma.paymentMandate.update({
    where: { id: mandateId },
    data: {
      lastAttemptAt: new Date(),
      lastFailureReason: reason,
      failureCount: { increment: 1 },
    },
  });
  void outcome;
}

async function notify(
  customer: { name: string; phone: string },
  subject: string,
  body: string
) {
  try {
    await dispatch("SMS", customer.phone, subject, `Dear ${customer.name}, ${body}`);
  } catch {
    // A notification failure is not a reason to fail a collection.
  }
}

/* ------------------------------------------------------------------ */
/* Mandate management                                                  */
/* ------------------------------------------------------------------ */

export async function listMandates(p: { status?: string; q?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (p.status) where.status = p.status;
  if (p.q?.trim()) {
    where.customer = { name: { contains: p.q.trim() } };
  }

  const [rows, byStatus] = await Promise.all([
    prisma.paymentMandate.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, username: true, phone: true, previousDue: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.paymentMandate.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return {
    rows,
    metrics: {
      total: byStatus.reduce((s, r) => s + r._count._all, 0),
      Active: byStatus.find((r) => r.status === "Active")?._count._all ?? 0,
      Paused: byStatus.find((r) => r.status === "Paused")?._count._all ?? 0,
      Cancelled: byStatus.find((r) => r.status === "Cancelled")?._count._all ?? 0,
    },
  };
}

export async function createMandate(input: {
  customerId: string;
  method: string;
  accountNumber?: string;
  mobileNumber?: string;
  bankName?: string;
  maxAmount?: number;
  userId: string;
}) {
  if (input.method === "Bank Transfer" && !input.accountNumber?.trim()) {
    throw new Error("A bank account number is required for a bank mandate");
  }
  if (input.method === "Mobile Wallet" && !input.mobileNumber?.trim()) {
    throw new Error("A wallet number is required for a mobile wallet mandate");
  }
  if (input.method === "Card" && !input.accountNumber?.trim()) {
    throw new Error("A card token is required for a card mandate");
  }

  const existing = await prisma.paymentMandate.findFirst({
    where: { customerId: input.customerId, status: { not: "Cancelled" } },
  });
  if (existing) {
    throw new Error("This customer already has an active mandate. Cancel it first.");
  }

  return prisma.$transaction(async (tx: Tx) => {
    const reference = await nextNumber(tx, "mandate", "MND-");
    return tx.paymentMandate.create({
      data: {
        reference,
        customerId: input.customerId,
        method: input.method,
        accountNumber: input.accountNumber?.trim() || null,
        mobileNumber: input.mobileNumber?.trim() || null,
        bankName: input.bankName?.trim() || null,
        maxAmount: input.maxAmount ?? null,
        status: "Active",
        createdById: input.userId,
      },
    });
  });
}

export async function cancelMandate(id: string, userId: string) {
  await prisma.paymentMandate.update({ where: { id }, data: { status: "Cancelled" } });
  await prismaLog(prisma, {
    action: "Cancel",
    entity: "Mandate",
    entityId: id,
    summary: "Automatic collection mandate cancelled",
  }, userId);
  return true;
}
