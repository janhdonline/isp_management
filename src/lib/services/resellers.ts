import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { round2 } from "@/lib/utils";

/**
 * Zone resellers.
 *
 * Scope is tracking and reporting, and the boundary is worth stating plainly:
 * there is no reseller ledger and no reseller login.
 *
 * Both omissions are on purpose. A separate money ledger would mean two sources
 * of truth for cash — the accounts ledger and the reseller's own — and the
 * commission report would then have to reconcile them rather than derive from
 * them, which is how a commission figure ends up disputed. And a reseller login
 * would mean deciding what a reseller can see in the whole system, which is a
 * permissions design of its own, not a field on a table.
 *
 * So the only question this answers is "who collected what, and what is owed",
 * and the answer is derived from `Payment` rows rather than stored anywhere
 * separately.
 */

export type ResellerRow = {
  id: string;
  name: string;
  phone: string | null;
  areaId: string | null;
  areaName: string | null;
  /** Stored as a Decimal so 7.5% is exact rather than a float approximation. */
  commissionPct: number;
  status: string;
  createdAt: Date;
  customers: number;
  /** What this reseller has collected, all time. */
  collected: number;
};

type ResellerDb = {
  id: string;
  name: string;
  phone: string | null;
  areaId: string | null;
  commissionPct: unknown;
  status: string;
  createdAt: Date;
};

const toRow = (r: ResellerDb, areaName: string | null, customers: number, collected: number): ResellerRow => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  areaId: r.areaId,
  areaName,
  // Prisma returns Decimal as a Decimal instance; the report only ever needs a
  // number, and converting once here keeps `.toFixed()` out of the components.
  commissionPct: Number(r.commissionPct),
  status: r.status,
  createdAt: r.createdAt,
  customers,
  collected,
});

export async function listResellers(): Promise<{
  rows: ResellerRow[];
  metrics: { total: number; active: number; collected: number };
}> {
  const [rows, counts, sums] = await Promise.all([
    prisma.reseller.findMany({
      include: { area: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.customer.groupBy({ by: ["resellerId"], _count: { _all: true } }),
    prisma.payment.groupBy({ by: ["collectedByResellerId"], _sum: { amount: true } }),
  ]);

  const byCustomer = new Map(counts.map((c) => [c.resellerId, c._count._all]));
  const byMoney = new Map(sums.map((s) => [s.collectedByResellerId, s._sum.amount ?? 0]));

  const out = rows.map((r) =>
    toRow(
      r,
      r.area?.name ?? null,
      byCustomer.get(r.id) ?? 0,
      round2(byMoney.get(r.id) ?? 0)
    )
  );

  return {
    rows: out,
    metrics: {
      total: out.length,
      active: out.filter((r) => r.status === "Active").length,
      collected: round2(out.reduce((s, r) => s + r.collected, 0)),
    },
  };
}

export async function getReseller(id: string) {
  const row = await prisma.reseller.findUnique({
    where: { id },
    include: { area: { select: { name: true } } },
  });
  if (!row) return null;

  const [customerCount, collected] = await Promise.all([
    prisma.customer.count({ where: { resellerId: id } }),
    prisma.payment.aggregate({ where: { collectedByResellerId: id }, _sum: { amount: true } }),
  ]);

  return toRow(row, row.area?.name ?? null, customerCount, round2(collected._sum.amount ?? 0));
}

export async function createReseller(input: {
  name: string;
  phone?: string;
  areaId?: string;
  commissionPct: number;
  status?: string;
  userId: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("A name is required");

  const pct = Number(input.commissionPct ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("The commission must be between 0 and 100.");
  }

  const clash = await prisma.reseller.findFirst({ where: { name } });
  if (clash) throw new Error(`There is already a reseller called "${name}".`);

  const row = await prisma.reseller.create({
    data: {
      name,
      phone: input.phone?.trim() || null,
      areaId: input.areaId || null,
      commissionPct: pct,
      status: input.status ?? "Active",
    },
  });

  await logActivity(
    {
      action: "Create",
      entity: "Reseller",
      entityId: row.id,
      summary: `Created reseller ${row.name} at ${pct}% commission`,
    },
    input.userId
  );
  return row;
}

export async function updateReseller(
  id: string,
  input: {
    name?: string;
    phone?: string | null;
    areaId?: string | null;
    commissionPct?: number;
    status?: string;
    userId: string;
  }
) {
  const data: Record<string, unknown> = {};
  if (input.name?.trim()) data.name = input.name.trim();
  if (input.phone !== undefined) data.phone = input.phone?.trim() || null;
  if (input.areaId !== undefined) data.areaId = input.areaId || null;
  if (input.status) data.status = input.status;
  if (input.commissionPct !== undefined) {
    const pct = Number(input.commissionPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error("The commission must be between 0 and 100.");
    }
    data.commissionPct = pct;
  }

  const row = await prisma.reseller.update({ where: { id }, data });
  await logActivity(
    { action: "Update", entity: "Reseller", entityId: id, summary: `Updated reseller ${row.name}` },
    input.userId
  );
  return row;
}

/**
 * Deletes a reseller only when nothing points at them.
 *
 * Customers and payments reference a reseller, and both would otherwise be left
 * pointing at nothing — which loses the very attribution this module exists to
 * keep. Inactive is the right move for a reseller who has stopped working.
 */
export async function deleteReseller(id: string, userId: string) {
  const row = await prisma.reseller.findUniqueOrThrow({ where: { id } });
  const [customers, payments] = await Promise.all([
    prisma.customer.count({ where: { resellerId: id } }),
    prisma.payment.count({ where: { collectedByResellerId: id } }),
  ]);

  if (customers > 0 || payments > 0) {
    throw new Error(
      `${row.name} is still linked to ${customers} customer(s) and ${payments} payment(s). ` +
        `Set them to Inactive instead, so the collections stay attributed.`
    );
  }

  await prisma.reseller.delete({ where: { id } });
  await logActivity(
    { action: "Delete", entity: "Reseller", entityId: id, summary: `Deleted reseller ${row.name}` },
    userId
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Commission                                                          */
/* ------------------------------------------------------------------ */

export type CommissionRow = {
  resellerId: string;
  name: string;
  commissionPct: number;
  /** Cash this reseller collected in the period. */
  collected: number;
  payments: number;
  /** collected × commissionPct. Derived, never stored. */
  commission: number;
  /** Cash collected that is not attributed to any reseller, for reconciliation. */
};

export type CommissionReport = {
  from: Date;
  to: Date;
  rows: CommissionRow[];
  totals: {
    collected: number;
    commission: number;
    payments: number;
    /** The staff-collected figure, so the two halves add up to the whole. */
    staffCollected: number;
    totalCollected: number;
    resellers: number;
  };
};

/**
 * What each reseller collected in a period, and what that costs.
 *
 * The formula is deliberately one line and derived on read:
 *
 *     commission = SUM(Payment.amount WHERE collectedByResellerId = r) × commissionPct
 *
 * Derived rather than stored, so it cannot drift from the payments it is
 * computed from — and so a percentage change applies retroactively to the period
 * as reported, which is what "we agreed 8% for March" means.
 *
 * `totalCollected` includes staff-collected cash as well, because a report that
 * only shows the reseller half invites the question "and what about the rest?"
 * with no way to answer it.
 */
export async function commissionReport(range: {
  gte: Date;
  lte: Date;
}): Promise<CommissionReport> {
  const [resellers, grouped, allTimeCounts, totalAgg] = await Promise.all([
    prisma.reseller.findMany({ orderBy: { name: "asc" } }),
    prisma.payment.groupBy({
      by: ["collectedByResellerId"],
      where: { paymentDate: range, collectedByResellerId: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["collectedByResellerId"],
      where: { paymentDate: range },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({ where: { paymentDate: range }, _sum: { amount: true } }),
  ]);

  const sums = new Map(grouped.map((g) => [g.collectedByResellerId, g._sum.amount ?? 0]));
  const counts = new Map(allTimeCounts.map((g) => [g.collectedByResellerId, g._count._all]));

  const rows: CommissionRow[] = resellers
    .map((r) => {
      const collected = round2(sums.get(r.id) ?? 0);
      const pct = Number(r.commissionPct);
      return {
        resellerId: r.id,
        name: r.name,
        commissionPct: pct,
        collected,
        payments: counts.get(r.id) ?? 0,
        // Rounded to two places: a commission of 7.5% of 1234.56 is a money
        // figure and must not carry a third decimal into an invoice.
        commission: round2((collected * pct) / 100),
      };
    })
    .sort((a, b) => b.collected - a.collected);

  const collected = round2(rows.reduce((s, r) => s + r.collected, 0));
  const totalCollected = round2(totalAgg._sum.amount ?? 0);

  return {
    from: range.gte,
    to: range.lte,
    rows,
    totals: {
      collected,
      commission: round2(rows.reduce((s, r) => s + r.commission, 0)),
      payments: rows.reduce((s, r) => s + r.payments, 0),
      // What the gap between the two figures is, by construction.
      staffCollected: round2(totalCollected - collected),
      totalCollected,
      resellers: rows.length,
    },
  };
}

/** A reseller's assigned customers, for the detail page. */
export async function resellerCustomers(resellerId: string) {
  return prisma.customer.findMany({
    where: { resellerId },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      customerCode: true,
      name: true,
      username: true,
      phone: true,
      connectionStatus: true,
      previousDue: true,
    },
  });
}