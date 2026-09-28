import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { DEFAULT_PER_PAGE, type ListParams, type ListResult } from "@/lib/query";
import { round2 } from "@/lib/utils";
import { logActivity } from "./activity";

export type PackageRow = {
  id: string;
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  monthlyPrice: number;
  installationFee: number;
  validityDays: number;
  billingCycle: string;
  fupLimit: number | null;
  description: string | null;
  status: string;
  _count: { customers: number };
};

export async function listPackages(
  p: ListParams = {}
): Promise<ListResult<PackageRow> & { metrics: Record<string, number> }> {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.PackageWhereInput = {};
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [{ name: { contains: term } }, { description: { contains: term } }];
  }
  if (p.status) where.status = p.status;

  const [total, rows, activeCount, agg] = await Promise.all([
    prisma.package.count({ where }),
    prisma.package.findMany({
      where,
      include: { _count: { select: { customers: true } } },
      orderBy: [{ monthlyPrice: "asc" }, { name: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.package.count({ where: { status: "Active" } }),
    prisma.package.aggregate({ where, _sum: { monthlyPrice: true } }),
  ]);

  const subscribers = rows.reduce((sum, r) => sum + r._count.customers, 0);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      total,
      active: activeCount,
      inactive: total - activeCount,
      subscribers,
      avgPrice: total ? round2((agg._sum.monthlyPrice ?? 0) / total) : 0,
    },
    csv: {
      headers: ["Package", "Download (Mbps)", "Upload (Mbps)", "Monthly Price", "Installation Fee", "Customers", "Status"],
      filename: "packages.csv",
      rows: rows.map((r) => [
        r.name,
        r.downloadSpeed,
        r.uploadSpeed,
        r.monthlyPrice,
        r.installationFee,
        r._count.customers,
        r.status,
      ]),
    },
  };
}

export async function getAllPackages() {
  return prisma.package.findMany({ where: { status: "Active" }, orderBy: { monthlyPrice: "asc" } });
}

export async function packageReport() {
  const [rows, mrr] = await Promise.all([
    prisma.package.findMany({
      include: {
        _count: { select: { customers: true } },
        customers: {
          where: { connectionStatus: "Active" },
          select: { id: true, expiryDate: true, previousDue: true },
        },
      },
      orderBy: { monthlyPrice: "asc" },
    }),
    prisma.customer.aggregate({
      where: { connectionStatus: "Active" },
      _sum: { monthlyBill: true },
    }),
  ]);

  const now = new Date();
  return {
    mrr: round2(mrr._sum.monthlyBill ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      downloadSpeed: r.downloadSpeed,
      uploadSpeed: r.uploadSpeed,
      monthlyPrice: r.monthlyPrice,
      totalCustomers: r._count.customers,
      activeSubscribers: r.customers.length,
      expiredSubscribers: r.customers.filter((c) => c.expiryDate && c.expiryDate < now).length,
      unpaidSubscribers: r.customers.filter((c) => c.previousDue > 0).length,
      revenue: round2(r.monthlyPrice * r._count.customers),
    })),
  };
}

export async function getPackage(id: string) {
  return prisma.package.findUnique({
    where: { id },
    include: {
      _count: { select: { customers: true } },
      customers: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, username: true, expiryDate: true, connectionStatus: true },
      },
    },
  });
}

export async function togglePackageStatus(id: string, userId?: string) {
  const pkg = await prisma.package.findUniqueOrThrow({ where: { id } });
  const status = pkg.status === "Active" ? "Inactive" : "Active";
  await prisma.package.update({ where: { id }, data: { status } });
  await logActivity(
    { action: "Toggle", entity: "Package", entityId: id, summary: `${pkg.name} set to ${status}` },
    userId
  );
  return status;
}

export async function duplicatePackage(id: string, userId?: string) {
  const pkg = await prisma.package.findUniqueOrThrow({ where: { id } });
  const copy = await prisma.package.create({
    data: {
      name: `${pkg.name} (Copy)`,
      downloadSpeed: pkg.downloadSpeed,
      uploadSpeed: pkg.uploadSpeed,
      monthlyPrice: pkg.monthlyPrice,
      installationFee: pkg.installationFee,
      validityDays: pkg.validityDays,
      billingCycle: pkg.billingCycle,
      fupLimit: pkg.fupLimit,
      description: pkg.description,
      status: "Active",
    },
  });
  await logActivity(
    { action: "Duplicate", entity: "Package", entityId: copy.id, summary: `Duplicated ${pkg.name} -> ${copy.name}` },
    userId
  );
  return copy;
}

export async function deletePackage(id: string, userId?: string) {
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { customers: true } } },
  });
  if (pkg._count.customers > 0)
    throw new Error(`${pkg.name} is used by ${pkg._count.customers} customer(s). Deactivate instead.`);
  await prisma.package.delete({ where: { id } });
  await logActivity(
    { action: "Delete", entity: "Package", entityId: id, summary: `Deleted package ${pkg.name}` },
    userId
  );
}
