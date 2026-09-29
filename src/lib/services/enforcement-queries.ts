import { prisma } from "@/lib/prisma";
import { listRouters } from "@/lib/services/network";
import { pendingEnforcementCount } from "@/lib/services/network-enforcement";

/**
 * The router enforcement queue.
 *
 * This page exists because of one uncomfortable possibility: the database says a
 * customer is Suspended while the router still has them online. That state is
 * possible whenever a router is unreachable, and an ISP that cannot see it will
 * keep serving customers it thinks it has cut off. So the drift is made visible
 * rather than left inside a retry loop.
 */
export type EnforcementRow = {
  id: string;
  username: string;
  customerName: string | null;
  customerId: string | null;
  connectionStatus: string | null;
  action: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  routerName: string | null;
};

export async function listEnforcement(
  filter: "Pending" | "Done" | "Failed" | "All" = "Pending"
): Promise<{ rows: EnforcementRow[]; metrics: Record<string, number> }> {
  const where = filter === "All" ? {} : { status: filter };

  const [rows, byStatus] = await Promise.all([
    prisma.networkAction.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, connectionStatus: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.networkAction.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const routers = await listRouters();
  const routerName = new Map(routers.map((r) => [r.id, r.name]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      username: r.username,
      customerName: r.customer?.name ?? null,
      customerId: r.customer?.id ?? null,
      connectionStatus: r.customer?.connectionStatus ?? null,
      action: r.action,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      routerName: r.routerId ? (routerName.get(r.routerId) ?? null) : null,
    })),
    metrics: {
      Pending: byStatus.find((b) => b.status === "Pending")?._count._all ?? 0,
      Done: byStatus.find((b) => b.status === "Done")?._count._all ?? 0,
      Failed: byStatus.find((b) => b.status === "Failed")?._count._all ?? 0,
    },
  };
}

/** A one-line summary for the network page header. */
export async function enforcementSummary() {
  const pending = await pendingEnforcementCount();
  return { pending };
}
