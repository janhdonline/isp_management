import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { DEFAULT_PER_PAGE, type ListParams } from "@/lib/query";
import { round2 } from "@/lib/utils";
import { adapterForRouter, getAdapterForRouter } from "./network-adapter";
import { getSettings } from "@/lib/settings";

export async function onlineSummary() {
  const rows = await prisma.customer.findMany({
    where: { onlineStatus: "Online" },
    include: { package: { select: { name: true, downloadSpeed: true } } },
    orderBy: { loginTime: "desc" },
  });
  const down = rows.reduce((s, r) => s + Number(r.downloadBytes ?? 0), 0);
  const up = rows.reduce((s, r) => s + Number(r.uploadBytes ?? 0), 0);
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (!r.loginTime) continue;
    const key = r.loginTime.toISOString().slice(0, 13);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const peak = Math.max(0, ...byDay.values());

  return { rows, metrics: { total: rows.length, download: down, upload: up, peak } };
}

export async function listOnline(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where = {
    onlineStatus: "Online",
    ...(p.q?.trim()
      ? {
          OR: [
            { username: { contains: p.q.trim() } },
            { name: { contains: p.q.trim() } },
            { ipAddress: { contains: p.q.trim() } },
            { macAddress: { contains: p.q.trim() } },
          ],
        }
      : {}),
    ...(p.areaId ? { areaId: p.areaId } : {}),
    ...(p.packageId ? { packageId: p.packageId } : {}),
    ...(p.routerId ? { routerId: p.routerId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: {
        package: { select: { name: true, downloadSpeed: true, uploadSpeed: true } },
        area: { select: { name: true } },
        router: { select: { name: true } },
      },
      orderBy: { loginTime: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    csv: {
      headers: ["Username", "Customer", "IP", "MAC", "Package", "Download", "Upload", "Router", "Login Time"],
      filename: "online-users.csv",
      rows: rows.map((r) => [
        r.username,
        r.name,
        r.ipAddress ?? "",
        r.macAddress ?? "",
        r.package?.name ?? "",
        Number(r.downloadBytes ?? 0),
        Number(r.uploadBytes ?? 0),
        r.router?.name ?? "",
        r.loginTime?.toISOString() ?? "",
      ]),
    },
  };
}

export async function listOffline(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.CustomerWhereInput = {
    onlineStatus: "Offline",
    connectionStatus: { in: ["Active", "Suspended"] },
    ...(p.areaId ? { areaId: p.areaId } : {}),
    ...(p.packageId ? { packageId: p.packageId } : {}),
    ...(p.q?.trim()
      ? { OR: [{ username: { contains: p.q.trim() } }, { name: { contains: p.q.trim() } }] }
      : {}),
  };
  if (p.from || p.to) {
    const range: Prisma.DateTimeFilter = {};
    if (p.from) range.gte = new Date(p.from);
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    where.lastOnlineAt = range;
  }

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: {
        package: { select: { name: true } },
        area: { select: { name: true } },
      },
      orderBy: { lastOnlineAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    csv: {
      headers: ["Customer", "Username", "Package", "Last Online", "Expiry", "Due", "Status"],
      filename: "offline-users.csv",
      rows: rows.map((r) => [
        r.name,
        r.username,
        r.package?.name ?? "",
        r.lastOnlineAt?.toISOString() ?? "",
        r.expiryDate?.toISOString().slice(0, 10) ?? "",
        r.previousDue,
        r.connectionStatus,
      ]),
    },
  };
}

export async function listRouters() {
  const rows = await prisma.router.findMany({
    include: {
      area: { select: { name: true } },
      _count: { select: { customers: true } },
    },
    orderBy: { name: "asc" },
  });
  const online = await prisma.customer.groupBy({
    by: ["routerId"],
    where: { routerId: { not: null }, onlineStatus: "Online" },
    _count: { _all: true },
  });
  return rows.map((r) => ({
    ...r,
    customers: r._count.customers,
    onlineUsers: online.find((o) => o.routerId === r.id)?._count._all ?? 0,
  }));
}

/**
 * Builds the adapter for a router, falling back to the global MikroTik
 * credentials in Settings → Network when the row itself has none.
 *
 * A small ISP usually has one router, so making everyone create a per-router
 * account before anything works would be friction for no benefit. A row that
 * does carry its own credentials still takes precedence, so per-router setup
 * remains possible when there is more than one device.
 */
export async function adapterForRouterRow(row: {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  apiUser: string | null;
  apiSecretEnc: string | null;
  useSsl: boolean;
  sessionSource: string;
}) {
  if (row.apiUser && row.apiSecretEnc) {
    return getAdapterForRouter(row);
  }

  const s = await getSettings();
  const host = s["network.mikrotikApiHost"];
  const user = s["network.mikrotikUsername"];
  const secret = s["network.mikrotikPassword"];

  if (!host || !user || !secret) {
    return getAdapterForRouter(row);
  }

  return adapterForRouter({
    id: row.id,
    name: row.name,
    ipAddress: host,
    apiPort: Number(s["network.mikrotikApiPort"] ?? 8728),
    apiUser: user,
    apiSecret: secret,
    useSsl: s["network.mikrotikSsl"] === "true",
    sessionSource: s["network.mikrotikSessionSource"] ?? row.sessionSource,
  });
}

export async function routerHealth(id: string) {
  const router = await prisma.router.findUniqueOrThrow({ where: { id } });
  const adapter = await adapterForRouterRow(router);
  const [health, users] = await Promise.all([adapter.health(), adapter.activeUsers()]);

  await prisma.router.update({
    where: { id },
    data: {
      status: health.status,
      cpu: health.cpu,
      ram: health.ram,
      uptimeSec: health.uptimeSec,
      activeUsers: users.length,
      lastSyncAt: new Date(),
    },
  });
  return { router, health, users, adapterName: adapter.name, live: adapter.live };
}

export async function listOlts() {
  const rows = await prisma.olt.findMany({
    include: { area: { select: { name: true } }, onus: { select: { status: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((o) => ({
    ...o,
    onlineOnu: o.onus.filter((x) => x.status === "Online").length,
    offlineOnu: o.onus.filter((x) => x.status === "Offline").length,
    lowSignalOnu: o.onus.filter((x) => x.status === "Low Signal").length,
    totalOnu: o.onus.length,
  }));
}

export async function listOnus(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.OnuWhereInput = {
    ...(p.q?.trim() ? { serialNo: { contains: p.q.trim() } } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.areaId ? { areaId: p.areaId } : {}),
    ...(p.oltId ? { oltId: p.oltId } : {}),
  };

  const [total, rows, agg] = await Promise.all([
    prisma.onu.count({ where }),
    prisma.onu.findMany({
      where,
      include: {
        olt: { select: { id: true, name: true } },
        area: { select: { name: true } },
        customers: { select: { id: true, name: true, username: true } },
      },
      orderBy: { serialNo: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.onu.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: Object.fromEntries(agg.map((a) => [a.status, a._count._all])),
    csv: {
      headers: ["ONU", "Customer", "OLT", "PON", "RX Power", "TX Power", "Status", "Last Seen"],
      filename: "onus.csv",
      rows: rows.map((o) => [
        o.serialNo,
        o.customers[0]?.name ?? "",
        o.olt?.name ?? "",
        o.ponIndex ?? "",
        o.rxPower ?? "",
        o.txPower ?? "",
        o.status,
        o.lastSeenAt?.toISOString() ?? "",
      ]),
    },
  };
}

export async function onuMetrics() {
  const [total, online, offline, low, ponPorts] = await Promise.all([
    prisma.onu.count(),
    prisma.onu.count({ where: { status: "Online" } }),
    prisma.onu.count({ where: { status: "Offline" } }),
    prisma.onu.count({ where: { status: "Low Signal" } }),
    prisma.olt.aggregate({ _sum: { ponPorts: true } }),
  ]);
  return { total, online, offline, low, ponPorts: ponPorts._sum.ponPorts ?? 0 };
}

export async function bandwidthReport() {
  const sessions = await prisma.onlineSession.findMany({
    where: { logoutTime: null },
    include: { customer: { select: { id: true, name: true, username: true, package: { select: { name: true } } } } },
  });

  const hourly = new Map<string, { down: number; up: number }>();
  for (let h = 0; h < 24; h++) hourly.set(`${String(h).padStart(2, "0")}:00`, { down: 0, up: 0 });
  for (const s of sessions) {
    const h = `${String(s.loginTime.getHours()).padStart(2, "0")}:00`;
    const bucket = hourly.get(h);
    if (!bucket) continue;
    bucket.down += Number(s.downloadBytes ?? 0);
    bucket.up += Number(s.uploadBytes ?? 0);
  }

  const byPackage = new Map<string, { down: number; up: number; users: number }>();
  for (const s of sessions) {
    const name = s.customer.package?.name ?? "Unassigned";
    const row = byPackage.get(name) ?? { down: 0, up: 0, users: 0 };
    row.down += Number(s.downloadBytes ?? 0);
    row.up += Number(s.uploadBytes ?? 0);
    row.users += 1;
    byPackage.set(name, row);
  }

  const totalDown = sessions.reduce((s, x) => s + Number(x.downloadBytes ?? 0), 0);
  const totalUp = sessions.reduce((s, x) => s + Number(x.uploadBytes ?? 0), 0);

  return {
    hourly: [...hourly.entries()].map(([label, v]) => ({ label, download: v.down, upload: v.up })),
    byPackage: [...byPackage.entries()].map(([label, v]) => ({ label, ...v })),
    topUsers: [...sessions]
      .map((s) => ({
        id: s.customer.id,
        name: s.customer.name,
        username: s.customer.username,
        package: s.customer.package?.name ?? "",
        total: Number(s.downloadBytes ?? 0) + Number(s.uploadBytes ?? 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    metrics: {
      totalDownload: totalDown,
      totalUpload: totalUp,
      active: sessions.length,
      peak: hourly.size ? Math.max(...[...hourly.values()].map((v) => v.down + v.up)) : 0,
      average: hourly.size ? round2((totalDown + totalUp) / hourly.size) : 0,
    },
  };
}

export async function disconnectUser(customerId: string) {
  const c = await prisma.customer.update({
    where: { id: customerId },
    data: { onlineStatus: "Offline", loginTime: null, downloadBytes: 0n, uploadBytes: 0n },
  });
  await prisma.onlineSession.updateMany({
    where: { customerId, logoutTime: null },
    data: { logoutTime: new Date() },
  });
  return c;
}
