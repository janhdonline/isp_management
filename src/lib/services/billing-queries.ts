import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { DEFAULT_PER_PAGE, type ListParams, type ListResult } from "@/lib/query";
import { round2, startOfDay } from "@/lib/utils";
import { PAYMENT_METHODS, INVOICE_STATUSES } from "@/lib/enums";
import { logActivity } from "./activity";
import { nextNumber } from "@/lib/counter";
import { postToAccount } from "./billing";
import { prismaLog } from "./activity";

const invoiceInclude = {
  customer: { select: { id: true, name: true, username: true, customerCode: true, phone: true } },
  package: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customer: { id: string; name: string; username: string; customerCode: string; phone: string };
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

/** One invoice with its customer, package and any receipt, for a detail read. */
export async function getInvoiceFull(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      ...invoiceInclude,
      createdBy: { select: { name: true } },
      receipts: { orderBy: { issuedAt: "desc" } },
      payments: { orderBy: { paymentDate: "desc" } },
    },
  });
}

export async function listInvoices(p: ListParams = {}): Promise<ListResult<InvoiceRow>> {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.InvoiceWhereInput = {};

  if (p.status && (INVOICE_STATUSES as readonly string[]).includes(p.status)) {
    where.status = p.status;
  }
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [
      { invoiceNumber: { contains: term } },
      { customer: { name: { contains: term } } },
      { customer: { username: { contains: term } } },
      { customer: { customerCode: { contains: term } } },
    ];
  }
  if (p.areaId) where.customer = { areaId: p.areaId };
  if (p.packageId) where.packageId = p.packageId;
  if (p.from || p.to) {
    where.issueDate = {};
    if (p.from) where.issueDate.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      where.issueDate.lte = t;
    }
  }

  const [total, rows, agg] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { issueDate: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.invoice.aggregate({
      where,
      _sum: { total: true, paid: true },
      _count: { _all: true },
    }),
  ]);

  return {
    rows: rows as unknown as InvoiceRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      total: round2(agg._sum.total ?? 0),
      paid: round2(agg._sum.paid ?? 0),
      due: round2((agg._sum.total ?? 0) - (agg._sum.paid ?? 0)),
    },
    csv: {
      headers: ["Invoice", "Customer", "Package", "Issue Date", "Due Date", "Amount", "Paid", "Due", "Status"],
      filename: "invoices.csv",
      rows: rows.map((i) => [
        i.invoiceNumber,
        i.customer.name,
        i.package?.name ?? "",
        i.issueDate.toISOString().slice(0, 10),
        i.dueDate.toISOString().slice(0, 10),
        i.total,
        i.paid,
        round2(i.total - i.paid),
        i.status,
      ]),
    },
  } as ListResult<InvoiceRow> & { metrics: Record<string, number> };
}

export async function invoiceStatusMetrics() {
  const now = startOfDay(new Date());
  const [total, paid, partial, due, overdue, sum] = await Promise.all([
    prisma.invoice.count({ where: { status: { not: "Cancelled" } } }),
    prisma.invoice.count({ where: { status: "Paid" } }),
    prisma.invoice.count({ where: { status: "Partial" } }),
    prisma.invoice.count({ where: { status: "Due" } }),
    prisma.invoice.count({ where: { status: "Overdue" } }),
    prisma.invoice.aggregate({
      where: { status: { not: "Cancelled" } },
      _sum: { total: true, paid: true },
    }),
  ]);
  return {
    total,
    paid,
    partial,
    due,
    overdue,
    amount: round2(sum._sum.total ?? 0),
    collected: round2(sum._sum.paid ?? 0),
    outstanding: round2((sum._sum.total ?? 0) - (sum._sum.paid ?? 0)),
    overdueDate: now,
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const paymentInclude = {
  customer: { select: { id: true, name: true, username: true, customerCode: true, phone: true } },
  invoice: { select: { id: true, invoiceNumber: true, total: true, dueDate: true } },
  account: { select: { id: true, name: true, type: true } },
  collectedBy: { select: { id: true, name: true } },
  receipt: { select: { id: true, receiptNumber: true, issuedAt: true } },
} satisfies Prisma.PaymentInclude;

export type PaymentRow = {
  id: string;
  paymentId: string;
  customer: { id: string; name: string; username: string; customerCode: string; phone: string };
  invoice: { id: string; invoiceNumber: string; total: number; dueDate: Date } | null;
  account: { id: string; name: string; type: string };
  collectedBy: { id: string; name: string } | null;
  receipt: { id: string; receiptNumber: string; issuedAt: Date } | null;
  amount: number;
  method: string;
  transactionId: string | null;
  paymentDate: Date;
};

export async function listPayments(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.PaymentWhereInput = {};
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [
      { paymentId: { contains: term } },
      { customer: { name: { contains: term } } },
      { customer: { username: { contains: term } } },
      { transactionId: { contains: term } },
    ];
  }
  if (p.method) where.method = p.method;
  if (p.accountId) where.accountId = p.accountId;
  if (p.areaId) where.customer = { areaId: p.areaId };
  if (p.from || p.to) {
    where.paymentDate = {};
    if (p.from) where.paymentDate.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      where.paymentDate.lte = t;
    }
  }

  const [total, rows, agg] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { paymentDate: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);

  // per-method breakdown for the "Today's collection" cards
  const byMethod = await prisma.payment.groupBy({
    by: ["method"],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    rows: rows as unknown as PaymentRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      total: round2(agg._sum.amount ?? 0),
      count: total,
      ...Object.fromEntries(
        PAYMENT_METHODS.map((m) => {
          const hit = byMethod.find((b) => b.method === m);
          return [m, { amount: round2(hit?._sum.amount ?? 0), count: hit?._count._all ?? 0 }];
        })
      ),
    },
    csv: {
      headers: ["Payment ID", "Customer", "Invoice", "Amount", "Method", "Transaction ID", "Account", "Date", "Collected By"],
      filename: "payments.csv",
      rows: rows.map((x) => [
        x.paymentId,
        x.customer.name,
        x.invoice?.invoiceNumber ?? "",
        x.amount,
        x.method,
        x.transactionId ?? "",
        x.account.name,
        x.paymentDate.toISOString().slice(0, 10),
        x.collectedBy?.name ?? "",
      ]),
    },
  };
}

export async function paymentMetrics() {
  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [todayAgg, monthAgg] = await Promise.all([
    prisma.payment.aggregate({ where: { paymentDate: { gte: today } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where: { paymentDate: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  return {
    today: round2(todayAgg._sum.amount ?? 0),
    todayCount: todayAgg._count._all,
    month: round2(monthAgg._sum.amount ?? 0),
    monthCount: monthAgg._count._all,
  };
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export async function listReceipts(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.ReceiptWhereInput = {};
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [
      { receiptNumber: { contains: term } },
      { payment: { customer: { name: { contains: term } } } },
    ];
  }
  if (p.method) where.method = p.method;
  if (p.from || p.to) {
    where.issuedAt = {};
    if (p.from) where.issuedAt.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      where.issuedAt.lte = t;
    }
  }

  const [total, rows, agg] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      include: {
        payment: { include: { customer: { select: { id: true, name: true, customerCode: true } } } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { issuedAt: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.receipt.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: { total: round2(agg._sum.amount ?? 0), count: total },
    csv: {
      headers: ["Receipt", "Customer", "Invoice", "Amount", "Method", "Date", "Status"],
      filename: "receipts.csv",
      rows: rows.map((r) => [
        r.receiptNumber,
        r.payment.customer.name,
        r.invoice?.invoiceNumber ?? "",
        r.amount,
        r.method,
        r.issuedAt.toISOString().slice(0, 10),
        r.status,
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// Billing summary for the /billing/due page
// ---------------------------------------------------------------------------

export async function dueSummary() {
  const now = startOfDay(new Date());
  const rows = await prisma.invoice.findMany({
    where: { status: { in: ["Due", "Partial", "Overdue"] } },
    select: { total: true, paid: true, dueDate: true, customer: { select: { areaId: true, packageId: true } } },
  });

  const buckets = { total: 0, b1: 0, b2: 0, b3: 0, count: 0 };
  const byArea = new Map<string, number>();
  const byPackage = new Map<string, number>();

  for (const r of rows) {
    const due = Math.max(0, r.total - r.paid);
    buckets.total += due;
    buckets.count += 1;
    const days = Math.round((now.getTime() - r.dueDate.getTime()) / 86400000);
    if (days <= 0) continue;
    if (days <= 7) buckets.b1 += due;
    else if (days <= 30) buckets.b2 += due;
    else buckets.b3 += due;

    if (r.customer.areaId)
      byArea.set(r.customer.areaId, round2((byArea.get(r.customer.areaId) ?? 0) + due));
    if (r.customer.packageId)
      byPackage.set(r.customer.packageId, round2((byPackage.get(r.customer.packageId) ?? 0) + due));
  }

  const [areas, packages] = await Promise.all([
    prisma.area.findMany({ where: { id: { in: [...byArea.keys()] } }, select: { id: true, name: true } }),
    prisma.package.findMany({ where: { id: { in: [...byPackage.keys()] } }, select: { id: true, name: true } }),
  ]);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));

  return {
    total: round2(buckets.total),
    count: buckets.count,
    aging: [
      { label: "Not due", value: round2(buckets.total - buckets.b1 - buckets.b2 - buckets.b3) },
      { label: "1-7 days", value: round2(buckets.b1) },
      { label: "8-30 days", value: round2(buckets.b2) },
      { label: "30+ days", value: round2(buckets.b3) },
    ],
    byArea: [...byArea.entries()]
      .map(([id, value]) => ({ label: areaName.get(id) ?? "Unknown", value }))
      .sort((a, b) => b.value - a.value),
    byPackage: [...byPackage.entries()]
      .map(([id, value]) => ({ label: pkgName.get(id) ?? "Unknown", value }))
      .sort((a, b) => b.value - a.value),
  };
}

export type DueSummary = Awaited<ReturnType<typeof dueSummary>>;

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export async function cancelInvoice(id: string, userId?: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "Paid") throw new Error("Paid invoices cannot be cancelled");
  await prisma.invoice.update({
    where: { id },
    data: { status: "Cancelled", cancelledAt: new Date() },
  });
  await logActivity(
    { action: "Cancel", entity: "Invoice", entityId: id, summary: `Cancelled invoice ${inv.invoiceNumber}` },
    userId
  );
}

export async function recordExpense(input: {
  category: string;
  amount: number;
  date: Date;
  accountId: string;
  vendor?: string;
  reference?: string;
  description?: string;
  note?: string;
  userId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        category: input.category,
        amount: round2(input.amount),
        date: input.date,
        accountId: input.accountId,
        vendor: input.vendor,
        reference: input.reference,
        description: input.description,
        note: input.note,
        createdById: input.userId,
      },
    });
    await postToAccount(tx, {
      accountId: input.accountId,
      type: "Expense",
      direction: "Debit",
      amount: expense.amount,
      description: `${input.category} - ${input.description ?? "expense"}`,
      reference: expense.id,
      expenseId: expense.id,
      userId: input.userId,
      date: input.date,
    });
    await prismaLog(
      tx,
      { action: "Create", entity: "Expense", entityId: expense.id, summary: `Recorded expense ${input.category} ${expense.amount}` },
      input.userId
    );
    return expense;
  });
}

export async function transferFunds(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  transferDate: Date;
  reference?: string;
  note?: string;
  userId?: string;
}) {
  if (input.fromAccountId === input.toAccountId) throw new Error("Choose two different accounts");
  const amount = round2(input.amount);
  if (amount <= 0) throw new Error("Amount must be greater than 0");

  return prisma.$transaction(async (tx) => {
    const from = await tx.account.findUniqueOrThrow({ where: { id: input.fromAccountId } });
    if (from.currentBalance < amount) throw new Error("Source account has insufficient balance");

    const reference = input.reference || (await nextNumber(tx, "transfer", "TRF-"));
    const transfer = await tx.accountTransfer.create({
      data: {
        reference,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount,
        transferDate: input.transferDate,
        note: input.note,
      },
    });

    await postToAccount(tx, {
      accountId: input.fromAccountId,
      type: "Transfer",
      direction: "Debit",
      amount,
      description: `Transfer to account - ${reference}`,
      reference,
      transferId: transfer.id,
      userId: input.userId,
      date: input.transferDate,
    });
    await postToAccount(tx, {
      accountId: input.toAccountId,
      type: "Transfer",
      direction: "Credit",
      amount,
      description: `Transfer from account - ${reference}`,
      reference,
      transferId: transfer.id,
      userId: input.userId,
      date: input.transferDate,
    });

    await prismaLog(
      tx,
      {
        action: "Transfer",
        entity: "Account",
        entityId: transfer.id,
        summary: `Transferred ${amount} (${reference})`,
        meta: { from: from.name, amount },
      },
      input.userId
    );
    return transfer;
  });
}
