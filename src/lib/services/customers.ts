import { prisma } from "@/lib/prisma";
import { returnEquipment } from "@/lib/services/inventory";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_PER_PAGE, ListParams, ListResult } from "@/lib/query";
import { addDays, round2, startOfDay } from "@/lib/utils";
import { recomputeCustomerBilling } from "./billing";
import { Tx } from "@/lib/counter";
import { prismaLog, logActivity } from "./activity";

const SORTABLE = [
  "customerCode",
  "name",
  "phone",
  "username",
  "monthlyBill",
  "expiryDate",
  "previousDue",
  "connectionStatus",
  "billingStatus",
  "createdAt",
] as const;

export type CustomerRow = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  username: string;
  ipAddress: string | null;
  onlineStatus: string;
  monthlyBill: number;
  previousDue: number;
  expiryDate: Date | null;
  connectionStatus: string;
  billingStatus: string;
  package: { id: string; name: string; downloadSpeed: number; uploadSpeed: number } | null;
  area: { id: string; name: string } | null;
};

/** Applies every filter from the Customers toolbar in one place. */
export function buildCustomerWhere(p: ListParams): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};
  const and: Prisma.CustomerWhereInput[] = [];

  if (p.q?.trim()) {
    const term = p.q.trim();
    and.push({
      OR: [
        { name: { contains: term } },
        { username: { contains: term } },
        { phone: { contains: term } },
        { customerCode: { contains: term } },
        { ipAddress: { contains: term } },
        { macAddress: { contains: term } },
        { nid: { contains: term } },
      ],
    });
  }
  if (p.areaId) and.push({ areaId: p.areaId });
  if (p.zoneId) and.push({ area: { zoneId: p.zoneId } });
  if (p.packageId) and.push({ packageId: p.packageId });
  if (p.routerId) and.push({ routerId: p.routerId });
  if (p.status) and.push({ connectionStatus: p.status });
  if (p.connectionStatus) and.push({ connectionStatus: p.connectionStatus });
  if (p.billingStatus) and.push({ billingStatus: p.billingStatus });
  if (p.onlineStatus) and.push({ onlineStatus: p.onlineStatus });
  if (p.expiredOnly) and.push({ expiryDate: { lt: new Date() } });

  if (p.from || p.to) {
    const range: Prisma.DateTimeFilter = {};
    if (p.from) range.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    and.push({ connectionDate: range });
  }
  if (p.expiryFrom || p.expiryTo) {
    const range: Prisma.DateTimeFilter = {};
    if (p.expiryFrom) range.gte = startOfDay(new Date(p.expiryFrom));
    if (p.expiryTo) {
      const t = new Date(p.expiryTo);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    and.push({ expiryDate: range });
  }
  if (and.length) where.AND = and;
  return where;
}

const include = {
  package: { select: { id: true, name: true, downloadSpeed: true, uploadSpeed: true } },
  area: { select: { id: true, name: true } },
} satisfies Prisma.CustomerInclude;

export async function listCustomers(
  p: ListParams = {}
): Promise<ListResult<CustomerRow> & { metrics: Record<string, number> }> {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where = buildCustomerWhere(p);

  const sortKey = p.sort && (SORTABLE as readonly string[]).includes(p.sort) ? p.sort : "createdAt";
  const orderBy = { [sortKey]: p.dir ?? "desc" } as Prisma.CustomerOrderByWithRelationInput;

  const [total, rows, metrics] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.customer.aggregate({
      where,
      _count: { _all: true },
      _sum: { previousDue: true, monthlyBill: true },
    }),
  ]);

  return {
    rows: rows as unknown as CustomerRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      monthlyBill: round2(metrics._sum.monthlyBill ?? 0),
      due: round2(metrics._sum.previousDue ?? 0),
    },
    csv: {
      headers: [
        "Customer ID",
        "Name",
        "Phone",
        "Username",
        "Package",
        "Area",
        "Monthly Bill",
        "Expiry",
        "Due",
        "Connection",
        "Billing",
      ],
      filename: "customers.csv",
      rows: rows.map((c) => [
        c.customerCode,
        c.name,
        c.phone,
        c.username,
        c.package?.name ?? "",
        c.area?.name ?? "",
        c.monthlyBill,
        c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : "",
        c.previousDue,
        c.connectionStatus,
        c.billingStatus,
      ]),
    },
  };
}

/** List of customers whose expiry date falls inside the window. */
export async function listExpiring(
  p: ListParams & { window?: "today" | "week" | "month" } = {}
) {
  const now = new Date();
  const from = startOfDay(now);
  const toMap = {
    today: addDays(from, 1),
    week: addDays(from, 7),
    month: addDays(from, 30),
  } as const;
  const to = toMap[p.window ?? "week"];

  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.CustomerWhereInput = {
    connectionStatus: "Active",
    expiryDate: { gte: from, lte: to },
    ...(p.areaId ? { areaId: p.areaId } : {}),
    ...(p.packageId ? { packageId: p.packageId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include,
      orderBy: { expiryDate: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return {
    rows: rows as unknown as CustomerRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    csv: {
      headers: ["Customer ID", "Customer", "Package", "Expiry", "Due", "Status"],
      filename: "expiring-customers.csv",
      rows: rows.map((c) => [
        c.customerCode,
        c.name,
        c.package?.name ?? "",
        c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : "",
        c.previousDue,
        c.billingStatus,
      ]),
    },
  };
}

/** Customers with an outstanding balance, with aging buckets. */
export async function listDue(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const now = startOfDay(new Date());

  const where: Prisma.CustomerWhereInput = {
    previousDue: { gt: 0 },
    connectionStatus: { not: "Disconnected" },
    ...(p.areaId ? { areaId: p.areaId } : {}),
    ...(p.packageId ? { packageId: p.packageId } : {}),
  };
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [{ name: { contains: term } }, { phone: { contains: term } }, { username: { contains: term } }];
  }

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: {
        ...include,
        invoices: {
          where: { status: { in: ["Due", "Partial", "Overdue"] } },
          orderBy: { dueDate: "asc" },
          take: 1,
        },
      },
      orderBy: { previousDue: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const withDays = rows.map((c) => {
    const inv = c.invoices[0];
    const daysOverdue = inv ? Math.max(0, Math.round((now.getTime() - inv.dueDate.getTime()) / 86400000)) : 0;
    return { ...(c as unknown as CustomerRow), oldestInvoice: inv ?? null, daysOverdue };
  });

  const filtered =
    p.dueBucket === undefined
      ? withDays
      : withDays.filter((r) => {
          if (!r.oldestInvoice) return false;
          const d = r.daysOverdue;
          if (p.dueBucket === "1-7") return d >= 1 && d <= 7;
          if (p.dueBucket === "8-30") return d >= 8 && d <= 30;
          return d > 30;
        });

  return {
    rows: filtered,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    csv: {
      headers: ["Customer", "Phone", "Package", "Invoice", "Due", "Days Overdue"],
      filename: "due-customers.csv",
      rows: filtered.map((r) => [
        r.name,
        r.phone,
        r.package?.name ?? "",
        r.oldestInvoice?.invoiceNumber ?? "",
        r.previousDue,
        r.daysOverdue,
      ]),
    },
  };
}

/** Aggregate counters used by the Active / Online / Offline / Suspended tabs. */
export async function customerStatusMetrics() {
  const now = new Date();
  const soon = addDays(now, 3);
  const [
    total,
    active,
    online,
    suspended,
    disconnected,
    expired,
    pending,
    withDue,
    withoutDue,
    activeOnline,
    expiringToday,
    expiredToday,
  ] = await Promise.all([
    prisma.customer.count({ where: { connectionStatus: { not: "Archived" } } }),
    prisma.customer.count({ where: { connectionStatus: "Active" } }),
    prisma.customer.count({ where: { connectionStatus: "Active", onlineStatus: "Online" } }),
    prisma.customer.count({ where: { connectionStatus: "Suspended" } }),
    prisma.customer.count({ where: { connectionStatus: "Disconnected" } }),
    prisma.customer.count({
      where: { connectionStatus: "Active", expiryDate: { lt: now } },
    }),
    prisma.customer.count({ where: { connectionStatus: "Pending" } }),
    prisma.customer.count({ where: { connectionStatus: "Active", previousDue: { gt: 0 } } }),
    prisma.customer.count({ where: { connectionStatus: "Active", previousDue: { lte: 0 } } }),
    prisma.customer.count({ where: { connectionStatus: "Active", onlineStatus: "Online" } }),
    prisma.customer.count({
      where: { connectionStatus: "Active", expiryDate: { gte: now, lte: soon } },
    }),
    prisma.customer.count({
      where: { expiryDate: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } },
    }),
  ]);

  return {
    total,
    active,
    online,
    offline: active - online,
    suspended,
    disconnected,
    expired,
    pending,
    activeWithDue: withDue,
    activeWithoutDue: withoutDue,
    activeOnline,
    expiringSoon: expiringToday,
    expiredToday,
  };
}

export async function getCustomerFull(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      area: { include: { zone: true } },
      package: true,
      router: true,
      olt: true,
      onu: true,
      invoices: {
        include: { payments: true },
        orderBy: { issueDate: "desc" },
      },
      payments: {
        include: { account: true, invoice: true, receipt: true, collectedBy: true },
        orderBy: { paymentDate: "desc" },
      },
      tickets: {
        include: { technician: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      sessionLogs: { orderBy: { loginTime: "desc" }, take: 20 },
      packageLogs: {
        include: { fromPkg: true, toPkg: true },
        orderBy: { createdAt: "desc" },
      },
      notifications: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

export async function getCustomerActivity(id: string, take = 30) {
  return prisma.activityLog.findMany({
    where: { entity: "Customer", entityId: id },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle actions — all transactional + audited (ISP.md rules 15, 16, 20)
// ---------------------------------------------------------------------------

export async function suspendCustomer(
  tx: Tx,
  id: string,
  reason: string,
  userId?: string
) {
  const c = await tx.customer.update({
    where: { id },
    data: { connectionStatus: "Suspended", onlineStatus: "Offline", suspendReason: reason, suspendedAt: new Date() },
  });
  await prismaLog(
    tx,
    { action: "Suspend", entity: "Customer", entityId: id, summary: `Suspended ${c.name} (${c.username}) - ${reason}` },
    userId
  );
  return c;
}

export async function reconnectCustomer(
  tx: Tx,
  id: string,
  userId?: string
) {
  const c = await tx.customer.update({
    where: { id },
    data: {
      connectionStatus: "Active",
      suspendReason: null,
      suspendedAt: null,
      disconnectReason: null,
      disconnectedAt: null,
    },
  });
  await prismaLog(
    tx,
    { action: "Reconnect", entity: "Customer", entityId: id, summary: `Reconnected ${c.name} (${c.username})` },
    userId
  );
  return c;
}

export async function disconnectCustomer(
  tx: Tx,
  id: string,
  reason: string,
  userId?: string
) {
  const c = await tx.customer.update({
    where: { id },
    data: {
      connectionStatus: "Disconnected",
      onlineStatus: "Offline",
      disconnectReason: reason,
      disconnectedAt: new Date(),
    },
  });
  await prismaLog(
    tx,
    { action: "Disconnect", entity: "Customer", entityId: id, summary: `Disconnected ${c.name} - ${reason}` },
    userId
  );
  return c;
}

export async function changePackage(
  tx: Tx,
  id: string,
  packageId: string,
  reason: string,
  userId?: string
) {
  const pkg = await tx.package.findUniqueOrThrow({ where: { id: packageId } });
  const before = await tx.customer.findUniqueOrThrow({ where: { id } });
  if (before.packageId === packageId) return before;

  const c = await tx.customer.update({
    where: { id },
    data: {
      packageId: pkg.id,
      monthlyBill: pkg.monthlyPrice,
      installationFee: pkg.installationFee,
    },
  });
  await tx.customerPackageChange.create({
    data: {
      customerId: id,
      fromPkgId: before.packageId,
      toPkgId: pkg.id,
      reason,
      changedById: userId,
    },
  });
  await prismaLog(
    tx,
    {
      action: "Change Package",
      entity: "Customer",
      entityId: id,
      summary: `${c.name} moved from ${before.packageId ? "previous package" : "no package"} to ${pkg.name}`,
      meta: { from: before.packageId, to: pkg.id, reason },
    },
    userId
  );
  return c;
}

export async function renewCustomer(
  tx: Tx,
  id: string,
  days: number,
  userId?: string
) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id } });
  const base = c.expiryDate && c.expiryDate > new Date() ? c.expiryDate : startOfDay(new Date());
  const expiryDate = addDays(base, days);
  const updated = await tx.customer.update({
    where: { id },
    data: { expiryDate, connectionStatus: "Active", suspendReason: null, suspendedAt: null },
  });
  await prismaLog(
    tx,
    { action: "Renew", entity: "Customer", entityId: id, summary: `Renewed ${c.name} for ${days} days until ${expiryDate.toDateString()}` },
    userId
  );
  return updated;
}

export async function deleteCustomer(id: string, userId?: string) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id } });

  // Equipment is taken back *before* the row goes, not after.
  //
  // `CustomerEquipment.customer` cascades, so deleting the customer would
  // silently delete the assignment rows with it — and with them the only record
  // that the ONU ever left the storeroom. The device would sit in a customer's
  // house with no trace in the system and no way back onto the shelf. That is
  // the exact failure the equipment trail exists to prevent, so the return runs
  // first, through the ordinary service, which is what puts the stock back and
  // writes the movement that explains it.
  const assigned = await prisma.customerEquipment.findMany({
    where: { customerId: id, status: "Assigned" },
    select: { id: true, serial: true, item: { select: { name: true, sku: true } } },
  });

  for (const row of assigned) {
    await returnEquipment({
      equipmentId: row.id,
      status: "Returned",
      // The device came back because the subscription ended, not because the
      // customer said so — worth recording, since it is the one case where the
      // return reason is the same for every device.
      note: "Returned on customer deletion",
      userId,
    });
  }

  await prisma.customer.delete({ where: { id } });

  await logActivity(
    {
      action: "Delete",
      entity: "Customer",
      entityId: id,
      summary:
        `Deleted customer ${c.name} (${c.username})` +
        (assigned.length
          ? `; returned ${assigned.length} device(s) to stock (${assigned.map((a) => a.serial).join(", ")})`
          : ""),
    },
    userId
  );
}

/** Recompute helper exposed for the "sync" action on the customers toolbar. */
export async function resyncCustomerBilling(customerId: string) {
  return prisma.$transaction((tx) => recomputeCustomerBilling(tx, customerId));
}
