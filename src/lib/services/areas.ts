import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { round2 } from "@/lib/utils";
import { logActivity } from "./activity";

export async function listAreas(p: { q?: string; status?: string } = {}) {
  const where: Prisma.AreaWhereInput = {};
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.OR = [{ name: { contains: term } }, { code: { contains: term } }];
  }
  if (p.status) where.status = p.status;

  const areas = await prisma.area.findMany({
    where,
    include: { zone: true },
    orderBy: { name: "asc" },
  });

  const stats = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { not: null }, connectionStatus: { not: "Archived" } },
    _count: { _all: true },
    _sum: { previousDue: true },
  });
  const activeStats = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { not: null }, connectionStatus: "Active" },
    _count: { _all: true },
  });
  const onlineStats = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { not: null }, onlineStatus: "Online" },
    _count: { _all: true },
  });

  const byId = new Map(
    areas.map((a) => {
      const s = stats.find((x) => x.areaId === a.id);
      return [
        a.id,
        {
          customers: s?._count._all ?? 0,
          active: activeStats.find((x) => x.areaId === a.id)?._count._all ?? 0,
          online: onlineStats.find((x) => x.areaId === a.id)?._count._all ?? 0,
          due: round2(s?._sum.previousDue ?? 0),
        },
      ];
    })
  );

  const rows = areas.map((a) => ({ ...a, ...(byId.get(a.id) ?? { customers: 0, active: 0, online: 0, due: 0 }) }));
  return {
    rows,
    metrics: {
      total: rows.length,
      customers: rows.reduce((s, r) => s + r.customers, 0),
      online: rows.reduce((s, r) => s + r.online, 0),
      due: round2(rows.reduce((s, r) => s + r.due, 0)),
    },
    csv: {
      headers: ["Area", "Zone", "Customers", "Active", "Online", "Due", "Status"],
      filename: "areas.csv",
      rows: rows.map((r) => [r.name, r.zone?.name ?? "", r.customers, r.active, r.online, r.due, r.status]),
    },
  };
}

export async function listZones() {
  const zones = await prisma.zone.findMany({
    include: { areas: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  const areaIds = zones.flatMap((z) => z.areas.map((a) => a.id));
  const stats = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { in: areaIds } },
    _count: { _all: true },
  });
  const active = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { in: areaIds }, connectionStatus: "Active" },
    _count: { _all: true },
  });
  const online = await prisma.customer.groupBy({
    by: ["areaId"],
    where: { areaId: { in: areaIds }, onlineStatus: "Online" },
    _count: { _all: true },
  });

  const rows = zones.map((z) => {
    const areaIdSet = new Set(z.areas.map((a) => a.id));
    const count = (rows2: typeof stats) => rows2.filter((r) => r.areaId && areaIdSet.has(r.areaId)).reduce((s, r) => s + r._count._all, 0);
    return {
      ...z,
      areaCount: z.areas.length,
      customerCount: count(stats),
      activeCount: count(active),
      onlineCount: count(online),
    };
  });

  return {
    rows,
    csv: {
      headers: ["Zone", "Areas", "Customers", "Active", "Online", "Status"],
      filename: "zones.csv",
      rows: rows.map((r) => [r.name, r.areaCount, r.customerCount, r.activeCount, r.onlineCount, r.status]),
    },
  };
}

export async function getAreasSimple() {
  return prisma.area.findMany({
    where: { status: "Active" },
    include: { zone: true },
    orderBy: { name: "asc" },
  });
}

export async function getZonesSimple() {
  return prisma.zone.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
}

export async function areaCoverage() {
  const [areas, routers, olts, onus, customers] = await Promise.all([
    prisma.area.findMany({ include: { zone: true }, orderBy: { name: "asc" } }),
    prisma.router.findMany({ select: { id: true, name: true, location: true, status: true, areaId: true } }),
    prisma.olt.findMany({ select: { id: true, name: true, location: true, status: true, areaId: true, ponPorts: true } }),
    prisma.onu.findMany({ select: { id: true, serialNo: true, status: true, areaId: true, oltId: true } }),
    prisma.customer.groupBy({
      by: ["areaId"],
      where: { areaId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countMap = new Map(customers.map((c) => [c.areaId!, c._count._all]));

  return {
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      zone: a.zone?.name ?? "Unzoned",
      status: a.status,
      customers: countMap.get(a.id) ?? 0,
      routers: routers.filter((r) => r.areaId === a.id),
      olts: olts.filter((o) => o.areaId === a.id),
      onus: onus.filter((o) => o.areaId === a.id).length,
    })),
    devices: { routers, olts, onus },
  };
}

export async function deleteArea(id: string, userId?: string) {
  const area = await prisma.area.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { customers: true } } },
  });
  if (area._count.customers > 0)
    throw new Error(`${area.name} has ${area._count.customers} customer(s). Reassign them first.`);
  await prisma.area.delete({ where: { id } });
  await logActivity({ action: "Delete", entity: "Area", entityId: id, summary: `Deleted area ${area.name}` }, userId);
}

export async function deleteZone(id: string, userId?: string) {
  const zone = await prisma.zone.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { areas: true } } },
  });
  if (zone._count.areas > 0) throw new Error(`${zone.name} has ${zone._count.areas} area(s) linked.`);
  await prisma.zone.delete({ where: { id } });
  await logActivity({ action: "Delete", entity: "Zone", entityId: id, summary: `Deleted zone ${zone.name}` }, userId);
}
