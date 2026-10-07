import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay, addDays, addMonths, round2 } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/enums";

/**
 * Report queries. Every function is scoped by an explicit date range so the
 * report screens can regenerate for any period without touching the UI.
 */
export type ReportRange = { from: Date; to: Date };

export function defaultRange(): ReportRange {
  return { from: startOfDay(addMonths(new Date(), -1)), to: endOfDay(new Date()) };
}

/* ------------------------------------------------------------------ */
/* Customer reports                                                    */
/* ------------------------------------------------------------------ */

export async function customerReport(range: ReportRange) {
  const [total, byStatus, byPackage, byArea, newInRange, disconnects] = await Promise.all([
    prisma.customer.count({ where: { connectionStatus: { not: "Archived" } } }),
    prisma.customer.groupBy({ by: ["connectionStatus"], _count: { _all: true } }),
    prisma.customer.groupBy({
      by: ["packageId"],
      where: { connectionStatus: { not: "Archived" } },
      _count: { _all: true },
    }),
    prisma.customer.groupBy({
      by: ["areaId"],
      where: { connectionStatus: { not: "Archived" } },
      _count: { _all: true },
      _sum: { monthlyBill: true, previousDue: true },
    }),
    prisma.customer.count({ where: { connectionDate: { gte: range.from, lte: range.to } } }),
    prisma.customer.count({ where: { disconnectedAt: { gte: range.from, lte: range.to } } }),
  ]);

  const [packages, areas] = await Promise.all([
    prisma.package.findMany({ select: { id: true, name: true } }),
    prisma.area.findMany({ select: { id: true, name: true } }),
  ]);
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));

  return {
    total,
    newInRange,
    disconnects,
    byStatus: byStatus.map((s) => ({ label: s.connectionStatus, value: s._count._all })),
    byPackage: byPackage
      .map((p) => ({ label: pkgName.get(p.packageId ?? "") ?? "Unassigned", value: p._count._all }))
      .sort((a, b) => b.value - a.value),
    byArea: byArea
      .map((a) => ({
        label: areaName.get(a.areaId ?? "") ?? "Unassigned",
        value: a._count._all,
        bill: round2(a._sum.monthlyBill ?? 0),
        due: round2(a._sum.previousDue ?? 0),
      }))
      .sort((a, b) => b.value - a.value),
  };
}

/* ------------------------------------------------------------------ */
/* SLA compliance reports                                                */
/* ------------------------------------------------------------------ */

export async function slaComplianceReport(range: ReportRange) {
  const now = new Date();
  
  const [byTechnician, byPriority, total, breached, overdueCount] = await Promise.all([
    // SLA compliance per technician
    prisma.ticket.groupBy({
      by: ["technicianId"],
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: { in: ["Open", "Pending", "In Progress"] },
        slaBreached: true,
      },
      _count: { _all: true },
    }),
    // SLA compliance per priority
    prisma.ticket.groupBy({
      by: ["priority"],
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: { in: ["Open", "Pending", "In Progress"] },
        slaBreached: true,
      },
      _count: { _all: true },
    }),
    // Total tickets created in range
    prisma.ticket.count({
      where: { createdAt: { gte: range.from, lte: range.to } },
    }),
    // Total breached tickets in range (current status, not just newly created)
    prisma.ticket.count({
      where: {
        status: { in: ["Open", "Pending", "In Progress"] },
        slaBreached: true,
      },
    }),
    // Overdue tickets (breached without status)
    prisma.ticket.count({
      where: {
        status: { in: ["Open", "Pending", "In Progress"] },
        slaBreached: true,
        resolvedAt: null,
        closedAt: null,
      },
    }),
  ]);

  const technicians = await prisma.employee.findMany({
    where: { role: { contains: "Technician" } },
    select: { id: true, name: true, employeeCode: true },
  });

  return {
    total,
    totalBreachRate: total ? (breached / total) * 100 : 0,
    byTechnician: technicians.map((t) => {
      const data = byTechnician.find(r => r.technicianId === t.id);
      return {
        id: t.id,
        name: t.name,
        employeeCode: t.employeeCode,
        total: data?._count._all ?? 0,
        breachCount: data?._count._all ?? 0,
        breachRate: data?._count._all ? ((data._count._all / total) * 100) : 0,
      };
    }),
    byPriority: [
      { label: "Low", value: byPriority.find(r => r.priority === "Low")?._count._all ?? 0 },
      { label: "Medium", value: byPriority.find(r => r.priority === "Medium")?._count._all ?? 0 },
      { label: "High", value: byPriority.find(r => r.priority === "High")?._count._all ?? 0 },
      { label: "Critical", value: byPriority.find(r => r.priority === "Critical")?._count._all ?? 0 },
    ],
    breached,
    breachCount: breached,
    overdueCount,
    metrics: {
      total,
      breached,
      breachRate: total ? (breached / total) * 100 : 0,
      overdueCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Existing reports continue...
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Collection report                                                   */
/* ------------------------------------------------------------------ */

/**
 * Corporate and dedicated clients, with the contract figures (ISP.md §33).
 *
 * Reconciled against the customer table rather than computed: the receivables
 * column is `previousDue`, the same field the dashboard and the suspension sweep
 * read, so a corporate report that disagreed with the dashboard would be a
 * third number to argue about.
 *
 * **SLA compliance is not computed here.** Phase U owns SLA tracking; until that
 * exists there is no per-ticket resolution data to measure against, and inventing
 * a percentage from what is available would be a figure nobody could defend. The
 * column says so rather than showing a number that means nothing.
 */
export async function corporateReport() {
  const customers = await prisma.customer.findMany({
    where: { customerType: { in: ["Corporate", "Dedicated"] } },
    orderBy: [{ companyName: "asc" }, { name: "asc" }],
    select: {
      id: true,
      customerCode: true,
      name: true,
      username: true,
      customerType: true,
      companyName: true,
      contactPerson: true,
      contactPhone: true,
      tradeLicenseNo: true,
      cirMbps: true,
      mirMbps: true,
      slaHours: true,
      billingLabel: true,
      ipAddress: true,
      ipType: true,
      connectionStatus: true,
      previousDue: true,
      monthlyBill: true,
      package: { select: { name: true, downloadSpeed: true, uploadSpeed: true } },
      area: { select: { name: true } },
      router: { select: { name: true } },
    },
  });

  let totalReceivables = 0;
  let totalMonthly = 0;
  let missingCompany = 0;
  const rows = customers.map((c) => {
    totalReceivables += c.previousDue;
    totalMonthly += c.monthlyBill;
    if (!c.companyName) missingCompany += 1;
    return {
      ...c,
      // The headroom between what is committed and what the link could do. Null
      // when either rate is missing, because "unknown" and "no headroom" are very
      // different things to say about a contract.
      headroomMbps:
        c.cirMbps != null && c.mirMbps != null ? Math.max(0, (c.mirMbps - c.cirMbps)) : null,
    };
  });

  return {
    rows,
    metrics: {
      clients: customers.length,
      totalReceivables: round2(totalReceivables),
      totalMonthly: round2(totalMonthly),
      missingCompany,
      withCir: customers.filter((c) => c.cirMbps != null).length,
      slaCompliance: null as number | null,
      slaComplianceNote: "pending Phase U",
    },
  };
}

/**
 * Receivables by corporate client, with the contracted rates beside the money.
 *
 * A separate report from the customer list because the questions differ: one is
 * "who are our corporate clients and what are they sold?", the other is "who owes
 * us money?". Reconciled with `previousDue`, the same field the dashboard reads.
 */
export async function corporateCollectionReport(range: ReportRange) {
  const [corporate, paidInRange] = await Promise.all([
    prisma.customer.findMany({
      where: { customerType: { in: ["Corporate", "Dedicated"] } },
      orderBy: [{ companyName: "asc" }, { name: "asc" }],
      select: {
        id: true,
        customerCode: true,
        name: true,
        companyName: true,
        customerType: true,
        cirMbps: true,
        mirMbps: true,
        previousDue: true,
        billingStatus: true,
      },
    }),
    prisma.payment.groupBy({
      by: ["customerId"],
      where: { paymentDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
  ]);
  const paid = new Map(paidInRange.map((p) => [p.customerId, p._sum.amount ?? 0]));

  let totalReceivables = 0;
  let totalCollected = 0;
  const rows = corporate.map((c) => {
    const collected = round2(paid.get(c.id) ?? 0);
    totalReceivables += c.previousDue;
    totalCollected += collected;
    return { ...c, collected };
  });

  return {
    rows,
    range,
    metrics: {
      clients: corporate.length,
      totalReceivables: round2(totalReceivables),
      totalCollected: round2(totalCollected),
      debtors: rows.filter((r) => r.previousDue > 0).length,
    },
  };
}

export async function collectionReport(range: ReportRange) {
  const where = { paymentDate: { gte: range.from, lte: range.to } };
  const [byMethod, total, rows, accounts] = await Promise.all([
    prisma.payment.groupBy({ by: ["method"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      take: 500,
      select: {
        id: true,
        paymentDate: true,
        amount: true,
        method: true,
        transactionId: true,
        account: { select: { name: true, type: true } },
        collectedBy: { select: { name: true } },
        customer: { select: { name: true, username: true } },
      },
    }),
    prisma.account.findMany({ select: { id: true, name: true, type: true, currentBalance: true } }),
  ]);

  // daily series for the trend chart
  const byDay = new Map<string, number>();
  for (let d = startOfDay(range.from); d <= range.to; d = addDays(d, 1)) {
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const p of rows) {
    const key = startOfDay(p.paymentDate).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, byDay.get(key)! + p.amount);
  }

  const byAccount = new Map<string, number>();
  for (const p of rows) {
    byAccount.set(p.account.name, (byAccount.get(p.account.name) ?? 0) + p.amount);
  }

  return {
    total: round2(total._sum.amount ?? 0),
    count: total._count._all,
    byMethod: PAYMENT_METHODS.map((m) => {
      const hit = byMethod.find((b) => b.method === m);
      return { label: m, value: round2(hit?._sum.amount ?? 0), count: hit?._count._all ?? 0 };
    }).filter((m) => m.count > 0),
    byAccount: [...byAccount.entries()]
      .map(([label, value]) => ({ label, value: round2(value) }))
      .sort((a, b) => b.value - a.value),
    byDay: [...byDay.entries()].map(([label, value]) => ({ label, value: round2(value) })),
    rows,
    accounts,
  };
}

/* ------------------------------------------------------------------ */
/* Due report                                                          */
/* ------------------------------------------------------------------ */

export async function dueReport() {
  const now = startOfDay(new Date());
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["Due", "Partial", "Overdue"] } },
    select: {
      id: true,
      total: true,
      paid: true,
      dueDate: true,
      customer: {
        select: {
          id: true,
          name: true,
          username: true,
          phone: true,
          previousDue: true,
          area: { select: { name: true } },
          package: { select: { name: true } },
        },
      },
    },
  });

  const buckets = { current: 0, b1: 0, b2: 0, b3: 0 };
  const byArea = new Map<string, number>();
  const byPackage = new Map<string, number>();
  const byCustomer = new Map<string, number>();

  for (const inv of invoices) {
    const balance = Math.max(0, inv.total - inv.paid);
    const days = Math.round((now.getTime() - inv.dueDate.getTime()) / 86400000);
    if (days <= 0) buckets.current += balance;
    else if (days <= 7) buckets.b1 += balance;
    else if (days <= 30) buckets.b2 += balance;
    else buckets.b3 += balance;

    const area = inv.customer.area?.name ?? "Unassigned";
    byArea.set(area, round2((byArea.get(area) ?? 0) + balance));
    const pkg = inv.customer.package?.name ?? "Unassigned";
    byPackage.set(pkg, round2((byPackage.get(pkg) ?? 0) + balance));
    byCustomer.set(inv.customer.name, round2((byCustomer.get(inv.customer.name) ?? 0) + balance));
  }

  const rows = invoices
    .map((inv) => ({
      id: inv.id,
      customerId: inv.customer.id,
      customer: inv.customer.name,
      username: inv.customer.username,
      phone: inv.customer.phone,
      area: inv.customer.area?.name ?? "Unassigned",
      package: inv.customer.package?.name ?? "Unassigned",
      total: inv.total,
      paid: inv.paid,
      balance: round2(Math.max(0, inv.total - inv.paid)),
      dueDate: inv.dueDate,
      daysOverdue: Math.max(0, Math.round((now.getTime() - inv.dueDate.getTime()) / 86400000)),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);

  return {
    rows,
    total: round2(Object.values(buckets).reduce((s, v) => s + v, 0)),
    count: invoices.length,
    aging: [
      { label: "Not due", value: round2(buckets.current) },
      { label: "1-7 days", value: round2(buckets.b1) },
      { label: "8-30 days", value: round2(buckets.b2) },
      { label: "30+ days", value: round2(buckets.b3) },
    ],
    byArea: [...byArea.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    byPackage: [...byPackage.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    byCustomer: [...byCustomer.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 25),
  };
}

/* ------------------------------------------------------------------ */
/* Expense report                                                      */
/* ------------------------------------------------------------------ */

export async function expenseReport(range: ReportRange) {
  const where = { date: { gte: range.from, lte: range.to } };
  const [total, byCategory, byAccount, byDay] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expense.groupBy({ by: ["category"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expense.groupBy({ by: ["accountId"], where, _sum: { amount: true } }),
    prisma.expense.findMany({ where, select: { date: true, amount: true } }),
  ]);

  const accounts = await prisma.account.findMany({ select: { id: true, name: true, type: true } });
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const dayMap = new Map<string, number>();
  for (let d = startOfDay(range.from); d <= range.to; d = addDays(d, 1)) {
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const e of byDay) {
    const key = startOfDay(e.date).toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.set(key, dayMap.get(key)! + e.amount);
  }

  return {
    total: round2(total._sum.amount ?? 0),
    count: total._count._all,
    byCategory: byCategory
      .map((c) => ({ label: c.category, value: round2(c._sum.amount ?? 0), count: c._count._all }))
      .sort((a, b) => b.value - a.value),
    byAccount: byAccount
      .map((a) => ({ label: accountName.get(a.accountId) ?? "Unknown", value: round2(a._sum.amount ?? 0) }))
      .sort((a, b) => b.value - a.value),
    byDay: [...dayMap.entries()].map(([label, value]) => ({ label, value: round2(value) })),
  };
}

/* ------------------------------------------------------------------ */
/* Profit & loss                                                       */
/* ------------------------------------------------------------------ */

export async function profitAndLoss(range: ReportRange) {
  const [revenue, expenses] = await Promise.all([
    prisma.payment.aggregate({
      where: { paymentDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { date: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const income = round2(revenue._sum.amount ?? 0);
  const cost = round2(expenses._sum.amount ?? 0);
  const profit = round2(income - cost);

  const monthly = await monthlySeries(range, income, cost);

  return {
    income,
    cost,
    profit,
    margin: income > 0 ? round2((profit / income) * 100) : 0,
    transactionCount: revenue._count._all,
    expenseCount: expenses._count._all,
    monthly,
  };
}

/** Income vs cost, bucketed by month across the range. */
async function monthlySeries(range: ReportRange, income: number, cost: number) {
  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: range.from, lte: range.to } },
    select: { paymentDate: true, amount: true },
  });
  const costs = await prisma.expense.findMany({
    where: { date: { gte: range.from, lte: range.to } },
    select: { date: true, amount: true },
  });

  const buckets = new Map<string, { label: string; Income: number; Expense: number }>();
  let cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), 1);
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      Income: 0,
      Expense: 0,
    });
    cursor = addMonths(cursor, 1);
  }
  for (const p of payments) {
    const key = `${p.paymentDate.getFullYear()}-${String(p.paymentDate.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (b) b.Income += p.amount;
  }
  for (const e of costs) {
    const key = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (b) b.Expense += e.amount;
  }

  void income;
  void cost;
  return [...buckets.values()].map((b) => ({
    label: b.label,
    Income: round2(b.Income),
    Expense: round2(b.Expense),
    Profit: round2(b.Income - b.Expense),
  }));
}

/* ------------------------------------------------------------------ */
/* Network report                                                      */
/* ------------------------------------------------------------------ */

export async function networkReport() {
  const [routers, olts, onus, online, sessions, packages] = await Promise.all([
    prisma.router.findMany({ orderBy: { name: "asc" } }),
    prisma.olt.findMany({ include: { onus: { select: { status: true } } }, orderBy: { name: "asc" } }),
    prisma.onu.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customer.count({ where: { onlineStatus: "Online" } }),
    prisma.onlineSession.aggregate({
      _sum: { downloadBytes: true, uploadBytes: true },
      _count: { _all: true },
    }),
    prisma.package.findMany({ orderBy: { name: "asc" } }),
  ]);

  const byPackage = await prisma.customer.groupBy({
    by: ["packageId"],
    where: { onlineStatus: "Online" },
    _count: { _all: true },
  });
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));

  const rxValues = await prisma.onu.findMany({ select: { rxPower: true } });
  const rxBuckets = [
    { label: "Excellent (>-20 dBm)", value: rxValues.filter((o) => (o.rxPower ?? -99) > -20).length },
    { label: "Good (-20 to -25)", value: rxValues.filter((o) => (o.rxPower ?? -99) <= -20 && (o.rxPower ?? -99) > -25).length },
    { label: "Fair (-25 to -28)", value: rxValues.filter((o) => (o.rxPower ?? -99) <= -25 && (o.rxPower ?? -99) > -28).length },
    { label: "Poor (<-28 dBm)", value: rxValues.filter((o) => (o.rxPower ?? -99) <= -28).length },
  ];

  return {
    routers: routers.map((r) => ({
      id: r.id,
      name: r.name,
      model: r.model,
      ipAddress: r.ipAddress,
      status: r.status,
      cpu: r.cpu,
      ram: r.ram,
      uptimeSec: r.uptimeSec,
      activeUsers: r.activeUsers,
      lastSyncAt: r.lastSyncAt,
    })),
    olts: olts.map((o) => ({
      id: o.id,
      name: o.name,
      vendor: o.vendor,
      status: o.status,
      ponPorts: o.ponPorts,
      online: o.onus.filter((x) => x.status === "Online").length,
      offline: o.onus.filter((x) => x.status === "Offline").length,
      lowSignal: o.onus.filter((x) => x.status === "Low Signal").length,
    })),
    onus: onus.map((o) => ({ label: o.status, value: o._count._all })),
    rxBuckets,
    online,
    sessions: sessions._count._all,
    download: Number(sessions._sum.downloadBytes ?? 0),
    upload: Number(sessions._sum.uploadBytes ?? 0),
    byPackage: byPackage
      .map((p) => ({ label: pkgName.get(p.packageId ?? "") ?? "Unassigned", value: p._count._all }))
      .sort((a, b) => b.value - a.value),
  };
}

/* ------------------------------------------------------------------ */
/* Attendance report                                                   */
/* ------------------------------------------------------------------ */

export async function attendanceReportData(range: ReportRange) {
  const where = { date: { gte: range.from, lte: range.to } };
  const [byStatus, byEmployee, total, employees] = await Promise.all([
    prisma.attendance.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.attendance.groupBy({
      by: ["employeeId"],
      where,
      _count: { _all: true },
    }),
    prisma.attendance.count({ where }),
    prisma.employee.findMany({ select: { id: true, name: true, employeeCode: true, role: true } }),
  ]);

  const nameMap = new Map(employees.map((e) => [e.id, e]));
  const byDay = new Map<string, number>();
  const days = await prisma.attendance.findMany({ where, select: { date: true, status: true } });
  for (const a of days) {
    const key = a.date.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, 0);
    if (a.status === "Present" || a.status === "Late") byDay.set(key, byDay.get(key)! + 1);
  }

  return {
    total,
    byStatus: byStatus.map((s) => ({ label: s.status, value: s._count._all })),
    byEmployee: byEmployee
      .map((e) => ({ label: nameMap.get(e.employeeId)?.name ?? "Unknown", value: e._count._all }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15),
    byDay: [...byDay.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
