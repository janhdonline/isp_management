import type { Metadata } from "next";
import { getDashboardStats, getDashboardCharts, type RangeKey } from "@/lib/services/dashboard";
import { listExpiring } from "@/lib/services/customers";
import { DashboardView, type DashStats } from "./dashboard-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = (sp.range as RangeKey) ?? "week";
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;

  const [stats, charts, expiring] = await Promise.all([
    getDashboardStats(),
    getDashboardCharts(range, from, to),
    listExpiring({ window: "month", perPage: 8 }),
  ]);

  // BigInt is not serialisable across the server/client boundary.
  const view: DashStats = {
    ...stats,
    onlineUsers: stats.onlineUsers.map((u) => ({
      ...u,
      downloadBytes: Number(u.downloadBytes),
      uploadBytes: Number(u.uploadBytes),
    })),
    expiring: expiring.rows.map((r) => ({
      id: r.id,
      name: r.name,
      customerCode: r.customerCode,
      username: r.username,
      expiryDate: r.expiryDate,
      previousDue: r.previousDue,
      connectionStatus: r.connectionStatus,
      package: r.package ? { name: r.package.name } : null,
    })),
  };

  return <DashboardView stats={view} charts={charts} range={range} from={from} to={to} />;
}
