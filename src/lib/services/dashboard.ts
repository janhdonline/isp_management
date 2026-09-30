import { prisma } from "@/lib/prisma";
import { addDays, round2, startOfDay, endOfDay } from "@/lib/utils";
import { customerStatusMetrics } from "./customers";
import { invoiceStatusMetrics, paymentMetrics } from "./billing-queries";

export type RangeKey = "today" | "week" | "month" | "year" | "custom";

export function resolveRange(key: RangeKey, from?: string, to?: string) {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "week":
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
    case "month":
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
    case "custom":
    default:
      return {
        from: from ? startOfDay(new Date(from)) : startOfDay(addDays(now, -29)),
        to: to ? endOfDay(new Date(to)) : endOfDay(now),
      };
  }
}

async function collectionSeries(from: Date, to: Date) {
  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: from, lte: to } },
    select: { paymentDate: true, amount: true },
  });

  const spanDays = Math.max(1, Math.round((endOfDay(to).getTime() - from.getTime()) / 86400000));
  const bucketByDay = spanDays <= 45;
  const buckets = new Map<string, number>();

  if (bucketByDay) {
    for (let i = 0; i < spanDays; i++) {
      buckets.set(startOfDay(addDays(from, i)).toISOString().slice(0, 10), 0);
    }
  } else {
    const start = new Date(from.getFullYear(), 0, 1);
    for (let d = new Date(start); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      buckets.set(d.toISOString().slice(0, 7), 0);
    }
  }

  for (const p of payments) {
    const key = bucketByDay
      ? startOfDay(p.paymentDate).toISOString().slice(0, 10)
      : new Date(p.paymentDate.getFullYear(), p.paymentDate.getMonth(), 1).toISOString().slice(0, 7);
    buckets.set(key, round2((buckets.get(key) ?? 0) + p.amount));
  }

  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

async function customerGrowth() {
  const now = new Date();
  const from = startOfDay(addDays(now, -29));
  const [connections, disconnects, reconnects] = await Promise.all([
    prisma.customer.findMany({
      where: { connectionDate: { gte: from } },
      select: { connectionDate: true },
    }),
    prisma.customer.findMany({
      where: { disconnectedAt: { gte: from } },
      select: { disconnectedAt: true },
    }),
    prisma.activityLog.findMany({
      where: { action: "Reconnect", createdAt: { gte: from } },
      select: { createdAt: true },
    }),
  ]);

  const days = 30;
  const map = new Map<string, { New: number; Disconnected: number; Reconnected: number }>();
  for (let i = 0; i < days; i++) {
    map.set(startOfDay(addDays(from, i)).toISOString().slice(0, 10), {
      New: 0,
      Disconnected: 0,
      Reconnected: 0,
    });
  }
  const bump = (d: Date | null, k: "New" | "Disconnected" | "Reconnected") => {
    if (!d) return;
    const key = startOfDay(d).toISOString().slice(0, 10);
    const row = map.get(key);
    if (row) row[k] += 1;
  };
  connections.forEach((c) => bump(c.connectionDate, "New"));
  disconnects.forEach((c) => bump(c.disconnectedAt, "Disconnected"));
  reconnects.forEach((c) => bump(c.createdAt, "Reconnected"));

  return [...map.entries()].map(([label, v]) => ({ label, ...v }));
}

export async function getDashboardStats() {
  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    customers,
    invoices,
    payments,
    todayCollection,
    monthCollection,
    monthExpense,
    openTickets,
    totalDueAgg,
    recentPayments,
    onlineUsers,
    expiring,
    expiringWeek,
  ] = await Promise.all([
    customerStatusMetrics(),
    invoiceStatusMetrics(),
    paymentMetrics(),
    prisma.payment.aggregate({ where: { paymentDate: { gte: today } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { paymentDate: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { date: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.ticket.count({ where: { status: { in: ["Open", "Pending", "In Progress"] } } }),
    prisma.customer.aggregate({
      where: { connectionStatus: { not: "Disconnected" } },
      _sum: { previousDue: true },
    }),
    prisma.payment.findMany({
      take: 8,
      orderBy: { paymentDate: "desc" },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        account: { select: { name: true, type: true } },
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    prisma.customer.findMany({
      where: { onlineStatus: "Online", connectionStatus: "Active" },
      take: 8,
      orderBy: { loginTime: "desc" },
      include: { package: { select: { name: true, downloadSpeed: true } } },
    }),
    prisma.customer.count({
      where: {
        connectionStatus: "Active",
        expiryDate: { gte: today, lt: addDays(today, 1) },
      },
    }),
    prisma.customer.count({
      where: {
        connectionStatus: "Active",
        expiryDate: { gte: today, lt: addDays(today, 7) },
      },
    }),
  ]);

  const monthRevenue = round2(monthCollection._sum.amount ?? 0);
  const monthExp = round2(monthExpense._sum.amount ?? 0);

  return {
    cards: {
      totalCustomers: customers.total,
      activeCustomers: customers.active,
      onlineNow: customers.online,
      offline: customers.offline,
      todayCollection: round2(todayCollection._sum.amount ?? 0),
      monthlyCollection: monthRevenue,
      totalDue: round2(totalDueAgg._sum.previousDue ?? 0),
      monthlyExpense: monthExp,
      expiringToday: expiring,
      expired: customers.expired,
      suspended: customers.suspended,
      openTickets,
    },
    invoice: invoices,
    payment: payments,
    finance: {
      revenue: monthRevenue,
      expense: monthExp,
      profit: round2(monthRevenue - monthExp),
      margin: monthRevenue > 0 ? round2(((monthRevenue - monthExp) / monthRevenue) * 100) : 0,
    },
    alerts: { expiringToday: expiring, expiringWeek },
    recentPayments,
    onlineUsers,
  };
}

export async function getDashboardCharts(range: RangeKey, from?: string, to?: string) {
  const { from: start, to: end } = resolveRange(range, from, to);

  const [collection, growth, statusRows, pkgRows] = await Promise.all([
    collectionSeries(start, end),
    customerGrowth(),
    prisma.customer.groupBy({
      by: ["connectionStatus"],
      _count: { _all: true },
    }),
    prisma.customer.groupBy({
      by: ["packageId"],
      where: { packageId: { not: null }, connectionStatus: { not: "Archived" } },
      _count: { _all: true },
    }),
  ]);

  const statusColors: Record<string, string> = {
    Active: "#3b665f",
    Pending: "#e3be6e",
    Suspended: "#c9973b",
    Disconnected: "#94a3b8",
    Archived: "#cbd5e1",
  };

  const statusChart = statusRows
    .filter((r) => r.connectionStatus !== "Archived")
    .map((r) => ({
      label: r.connectionStatus,
      value: r._count._all,
      color: statusColors[r.connectionStatus] ?? "#64748b",
    }));

  const packages = await prisma.package.findMany({
    where: { id: { in: pkgRows.map((p) => p.packageId!).filter(Boolean) } },
    select: { id: true, name: true },
  });
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));
  const palette = ["#c9973b", "#3b665f", "#e3be6e", "#4e8078", "#ab7e2c", "#2a4643", "#e8a33d", "#9abbb5"];

  const packageChart = pkgRows
    .map((p) => ({ label: pkgName.get(p.packageId!) ?? "Unassigned", value: p._count._all }))
    .sort((a, b) => b.value - a.value)
    .map((c, i) => ({ ...c, color: palette[i % palette.length] }));

  return { collection, growth, statusChart, packageChart };
}

/** Expired / suspended / disconnected counts + action candidates for cron jobs. */
export async function lifecycleCandidates() {
  const now = new Date();
  const [expired, expiringSoon, unpaid] = await Promise.all([
    prisma.customer.count({
      where: { connectionStatus: "Active", expiryDate: { lt: now }, previousDue: { gt: 0 } },
    }),
    prisma.customer.count({
      where: {
        connectionStatus: "Active",
        expiryDate: { gte: now, lte: addDays(now, 3) },
        previousDue: { gt: 0 },
      },
    }),
    prisma.customer.count({ where: { connectionStatus: "Active", previousDue: { gt: 0 } } }),
  ]);
  return { expired, expiringSoon, unpaid };
}
