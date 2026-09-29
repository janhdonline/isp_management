import { prisma } from "@/lib/prisma";
import { adapterForRouterRow } from "./network";
import { prismaLog } from "./activity";

/**
 * Pulls live sessions from every configured router and folds them into the
 * local tables, so the dashboard and the online-users list show the network as
 * it is rather than as it was at some earlier sync.
 *
 * Deliberately conservative about failure: a router that cannot be reached
 * leaves the customers it serves marked as "last seen" rather than flipping
 * them to Offline. Treating an unreachable router as an empty one would show an
 * ISP that its whole subscriber base is offline the moment a link drops, and
 * would trigger suspension sweeps against customers who are in fact online.
 */
export async function syncRouters(): Promise<{
  ok: boolean;
  routers: { name: string; ok: boolean; live: number; error?: string }[];
  markedOnline: number;
  markedOffline: number;
  unmatched: number;
}> {
  const routers = await prisma.router.findMany({
    include: { area: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const summary: {
    name: string;
    ok: boolean;
    live: number;
    error?: string;
  }[] = [];
  let markedOnline = 0;
  let markedOffline = 0;
  let unmatched = 0;

  for (const router of routers) {
    const adapter = await adapterForRouterRow(router);

    if (!adapter.live) {
      // Simulated adapter: nothing to pull, and saying so is better than
      // reporting zero live sessions as though the router reported them.
      summary.push({ name: router.name, ok: false, live: 0, error: "no API credentials" });
      continue;
    }

    let users: { username: string; ipAddress: string | null; macAddress: string | null; downloadBytes: number; uploadBytes: number; uptimeSec: number; loginTime: Date }[];
    try {
      users = await adapter.activeUsers();
    } catch (e) {
      summary.push({
        name: router.name,
        ok: false,
        live: 0,
        error: e instanceof Error ? e.message : "unreachable",
      });
      // Mark the router down so the UI shows the real state.
      await prisma.router.update({
        where: { id: router.id },
        data: { status: "Offline", lastSyncAt: new Date() },
      });
      continue;
    }

    // Match sessions to customers by PPPoE username, which is what the ISP
    // actually authenticates with. MAC address is the fallback for setups where
    // the username is not the customer code.
    const names = users.map((u) => u.username).filter(Boolean);
    const macs = users.map((u) => u.macAddress).filter(Boolean) as string[];

    const matched = await prisma.customer.findMany({
      where: {
        routerId: router.id,
        OR: [
          ...(names.length ? [{ username: { in: names } }] : []),
          ...(macs.length ? [{ macAddress: { in: macs } }] : []),
        ],
      },
      select: { id: true, username: true, macAddress: true },
    });

    const byName = new Map(matched.map((c) => [c.username, c]));
    const byMac = new Map(matched.filter((c) => c.macAddress).map((c) => [c.macAddress as string, c]));

    const now = new Date();
    for (const u of users) {
      const customer = byName.get(u.username) ?? (u.macAddress ? byMac.get(u.macAddress) : undefined);
      if (!customer) {
        unmatched += 1;
        continue;
      }

      // Open a session row, or update the one already open for this customer.
      const open = await prisma.onlineSession.findFirst({
        where: { customerId: customer.id, logoutTime: null },
        orderBy: { loginTime: "desc" },
        select: { id: true, downloadBytes: true, uploadBytes: true },
      });

      if (open) {
        // Counters accumulate on the router, so store the absolute value and
        // let the UI show the session total.
        await prisma.onlineSession.update({
          where: { id: open.id },
          data: {
            ipAddress: u.ipAddress,
            macAddress: u.macAddress,
            // The router's counter is cumulative for the session; keep the
            // larger of the two so a counter reset does not make usage drop.
            downloadBytes: BigInt(Math.max(Number(open.downloadBytes), u.downloadBytes)),
            uploadBytes: BigInt(Math.max(Number(open.uploadBytes), u.uploadBytes)),
          },
        });
      } else {
        await prisma.onlineSession.create({
          data: {
            customerId: customer.id,
            username: u.username,
            ipAddress: u.ipAddress,
            macAddress: u.macAddress,
            routerId: router.id,
            loginTime: u.loginTime,
            downloadBytes: BigInt(u.downloadBytes),
            uploadBytes: BigInt(u.uploadBytes),
          },
        });
      }

      const updated = await prisma.customer.updateMany({
        where: { id: customer.id, onlineStatus: { not: "Online" } },
        data: { onlineStatus: "Online", lastOnlineAt: now, loginTime: u.loginTime },
      });
      markedOnline += updated.count;
    }

    // Close sessions and mark customers offline for everyone this router used
    // to serve but is not serving now.
    const seenIds = matched
      .filter((c) => users.some((u) => u.username === c.username || u.macAddress === c.macAddress))
      .map((c) => c.id);

    const stale = await prisma.customer.findMany({
      where: { routerId: router.id, onlineStatus: "Online", ...(seenIds.length ? { id: { notIn: seenIds } } : {}) },
      select: { id: true },
    });

    if (stale.length) {
      await prisma.$transaction([
        prisma.onlineSession.updateMany({
          where: { customerId: { in: stale.map((c) => c.id) }, logoutTime: null },
          data: { logoutTime: now },
        }),
        prisma.customer.updateMany({
          where: { id: { in: stale.map((c) => c.id) } },
          data: { onlineStatus: "Offline" },
        }),
      ]);
      markedOffline += stale.length;
    }

    const health = await adapter.health();
    await prisma.router.update({
      where: { id: router.id },
      data: {
        status: health.status,
        cpu: health.cpu,
        ram: health.ram,
        uptimeSec: health.uptimeSec,
        activeUsers: users.length,
        lastSyncAt: now,
      },
    });

    summary.push({ name: router.name, ok: true, live: users.length });
  }

  await prismaLog(prisma, {
    action: "Sync",
    entity: "Router",
    entityId: undefined,
    summary: `Network sync: ${markedOnline} online, ${markedOffline} offline, ${unmatched} unmatched`,
  });

  return { ok: summary.every((r) => r.ok), routers: summary, markedOnline, markedOffline, unmatched };
}

/**
 * Records a disconnect in the session history without needing a router. Used
 * when an operator cuts a customer off from the dashboard and the router is
 * configured elsewhere.
 */
export async function recordManualDisconnect(customerId: string) {
  const now = new Date();
  return prisma.$transaction([
    prisma.onlineSession.updateMany({
      where: { customerId, logoutTime: null },
      data: { logoutTime: now },
    }),
    prisma.customer.update({
      where: { id: customerId },
      data: { onlineStatus: "Offline" },
    }),
  ]);
}
