import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { DEFAULT_PER_PAGE, type ListParams } from "@/lib/query";
import { round2 } from "@/lib/utils";
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "@/lib/enums";

export async function listAccounts() {
  const rows = await prisma.account.findMany({
    include: { _count: { select: { transactions: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const totals = round2(rows.reduce((s, r) => s + r.currentBalance, 0));
  return {
    rows,
    metrics: {
      total: totals,
      byType: Object.fromEntries(
        ACCOUNT_TYPES.map((t) => [t, round2(rows.filter((r) => r.type === t).reduce((s, r) => s + r.currentBalance, 0))])
      ),
    },
    csv: {
      headers: ["Account", "Type", "Opening Balance", "Current Balance", "Status"],
      filename: "accounts.csv",
      rows: rows.map((r) => [r.name, r.type, r.openingBalance, r.currentBalance, r.status]),
    },
  };
}

export async function listTransactions(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.AccountTransactionWhereInput = {};
  if (p.accountId) where.accountId = p.accountId;
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [
      { description: { contains: term } },
      { reference: { contains: term } },
      { account: { name: { contains: term } } },
    ];
  }
  if (p.method && (TRANSACTION_TYPES as readonly string[]).includes(p.method)) where.type = p.method;
  if (p.from || p.to) {
    where.date = {};
    if (p.from) where.date.gte = new Date(p.from);
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      where.date.lte = t;
    }
  }

  const [total, rows, agg] = await Promise.all([
    prisma.accountTransaction.count({ where }),
    prisma.accountTransaction.findMany({
      where,
      include: { account: { select: { id: true, name: true, type: true } } },
      orderBy: { date: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.accountTransaction.groupBy({
      by: ["direction"],
      where,
      _sum: { amount: true },
    }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      credit: round2(agg.find((a) => a.direction === "Credit")?._sum.amount ?? 0),
      debit: round2(agg.find((a) => a.direction === "Debit")?._sum.amount ?? 0),
    },
    csv: {
      headers: ["Transaction ID", "Date", "Account", "Type", "Description", "Debit", "Credit", "Balance"],
      filename: "account-history.csv",
      rows: rows.map((t) => [
        t.id,
        t.date.toISOString().slice(0, 19).replace("T", " "),
        t.account.name,
        t.type,
        t.description ?? "",
        t.direction === "Debit" ? t.amount : "",
        t.direction === "Credit" ? t.amount : "",
        t.balance,
      ]),
    },
  };
}

export async function accountDetail(id: string) {
  return prisma.account.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { date: "desc" }, take: 20 },
      _count: { select: { transactions: true, payments: true, expenses: true } },
    },
  });
}

export async function ensureDefaultAccounts() {
  const defaults = [
    { name: "Cash in Hand", type: "Cash", openingBalance: 0 },
    { name: "Bank - Current Account", type: "Bank", openingBalance: 0 },
    { name: "bKash Merchant", type: "bKash", openingBalance: 0 },
    { name: "Nagad Merchant", type: "Nagad", openingBalance: 0 },
  ];
  for (const d of defaults) {
    await prisma.account.upsert({
      where: { name: d.name },
      create: d,
      update: {},
    });
  }
  return prisma.account.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
}
