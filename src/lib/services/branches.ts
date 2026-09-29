import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/utils";
import { logActivity } from "@/lib/services/activity";

/**
 * Branches and cost centres.
 *
 * An ISP that grows past one office runs into a specific problem: the second
 * office collects cash, but the ledger does not know which office it belongs
 * to, so the branch's own numbers have to be reconstructed by hand from the
 * audit log at month end. A branch attached to cash accounts and expenses makes
 * that a report instead of an investigation.
 *
 * Deliberately not multi-tenancy. Separate companies need separate data and a
 * separate login boundary, which is a different and much larger piece of work.
 * A branch here is a cost centre inside one company: one database, one staff
 * list, and a `branchId` that scopes the reports.
 *
 * Every function takes an optional branch and returns everything when it is
 * absent, so a single-branch ISP is unaffected by the column existing.
 */

export type Branch = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  managerName: string | null;
  isDefault: boolean;
  status: string;
  createdAt: Date;
};

export async function listBranches(): Promise<Branch[]> {
  const rows = await prisma.branch.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows;
}

export async function getBranch(id: string) {
  return prisma.branch.findUnique({ where: { id } });
}

export async function createBranch(input: {
  code: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  managerName?: string;
  isDefault?: boolean;
  userId: string;
}) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("A short code is required");
  if (!input.name.trim()) throw new Error("A name is required");

  const existing = await prisma.branch.findUnique({ where: { code } });
  if (existing) throw new Error(`The code ${code} is already used by ${existing.name}`);

  const branch = await prisma.branch.create({
    data: {
      code,
      name: input.name.trim(),
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      managerName: input.managerName?.trim() || null,
      isDefault: input.isDefault ?? false,
    },
  });

  // The first branch is the default one; there has to be exactly one so a
  // screen that asks for "the" branch without asking has an answer.
  if (input.isDefault) await setDefaultBranch(branch.id);
  else if ((await prisma.branch.count()) === 1) {
    await prisma.branch.update({ where: { id: branch.id }, data: { isDefault: true } });
  }

  await logActivity({
    action: "Create",
    entity: "Branch",
    entityId: branch.id,
    summary: `Created branch ${branch.name} (${branch.code})`,
  }, input.userId);

  return branch;
}

export async function updateBranch(
  id: string,
  input: {
    name?: string;
    city?: string | null;
    address?: string | null;
    phone?: string | null;
    managerName?: string | null;
    status?: string;
    userId: string;
  }
) {
  const branch = await prisma.branch.update({
    where: { id },
    data: {
      name: input.name?.trim() || undefined,
      city: input.city === undefined ? undefined : input.city?.trim() || null,
      address: input.address === undefined ? undefined : input.address?.trim() || null,
      phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
      managerName: input.managerName === undefined ? undefined : input.managerName?.trim() || null,
      status: input.status,
    },
  });

  await logActivity({
    action: "Update",
    entity: "Branch",
    entityId: id,
    summary: `Updated branch ${branch.name}`,
  }, input.userId);

  return branch;
}

/** Exactly one branch is the default. */
export async function setDefaultBranch(id: string) {
  await prisma.$transaction([
    prisma.branch.updateMany({ data: { isDefault: false } }),
    prisma.branch.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return getBranch(id);
}

export async function deleteBranch(id: string, userId: string) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id } });

  // Anything attached keeps the branch alive. Deleting it would silently
  // detach a year of records from the office that actually took the money.
  const [accounts, areas, customers, staff] = await Promise.all([
    prisma.account.count({ where: { branchId: id } }),
    prisma.area.count({ where: { branchId: id } }),
    prisma.customer.count({ where: { branchId: id } }),
    prisma.user.count({ where: { branchId: id } }),
  ]);

  const attached = accounts + areas + customers + staff;
  if (attached > 0) {
    throw new Error(
      `${branch.name} still has ${accounts} account(s), ${areas} area(s), ${customers} customer(s) and ${staff} staff attached. Move them or set it to Inactive instead.`
    );
  }

  await prisma.branch.delete({ where: { id } });
  await logActivity({
    action: "Delete",
    entity: "Branch",
    entityId: id,
    summary: `Deleted branch ${branch.name} (${branch.code})`,
  }, userId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export async function branchPerformance(range: { gte: Date; lte: Date }) {
  const branches = await prisma.branch.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  const rows = await Promise.all(
    branches.map(async (branch) => {
      const accountFilter = { branchId: branch.id };

      const [payments, expenses, customers, activeCustomers, staff] = await Promise.all([
        prisma.payment.aggregate({
          where: { ...accountFilter, paymentDate: range },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.expense.aggregate({
          where: { ...accountFilter, date: range },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.customer.count({ where: { branchId: branch.id } }),
        prisma.customer.count({
          where: { branchId: branch.id, connectionStatus: "Active" },
        }),
        prisma.user.count({ where: { branchId: branch.id, status: "Active" } }),
      ]);

      const collected = round2(payments._sum.amount ?? 0);
      const spent = round2(expenses._sum.amount ?? 0);

      return {
        branch: { id: branch.id, code: branch.code, name: branch.name, city: branch.city },
        collected,
        spent,
        net: round2(collected - spent),
        transactions: payments._count._all,
        expenseEntries: expenses._count._all,
        customers,
        activeCustomers,
        staff,
        // What each customer brings in, which is the number that decides
        // whether an office is worth its rent.
        revenuePerCustomer:
          activeCustomers > 0 ? round2(collected / activeCustomers) : 0,
        // Collected per member of staff, which is the number that decides
        // whether it needs another one.
        revenuePerStaff: staff > 0 ? round2(collected / staff) : 0,
      };
    })
  );

  return {
    rows: rows.sort((a, b) => b.collected - a.collected),
    metrics: {
      branches: branches.length,
      collected: round2(rows.reduce((s, r) => s + r.collected, 0)),
      spent: round2(rows.reduce((s, r) => s + r.spent, 0)),
      net: round2(rows.reduce((s, r) => s + r.net, 0)),
      customers: rows.reduce((s, r) => s + r.customers, 0),
    },
  };
}
