import type { Metadata } from "next";
import { getDashboardStats, getDashboardCharts, type RangeKey } from "@/lib/services/dashboard";
import { listExpiring } from "@/lib/services/customers";
import { DashboardView, type DashStats } from "./dashboard-view";
import { DeviceAlertBanner } from "@/components/network/device-alert-banner";
import { listAlerts } from "@/lib/services/device-alerts";
import { listRogueOnus, openRogueCount } from "@/lib/services/olt-sync";

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

  const [stats, charts, expiring, openAlerts, rogues, rogueCount] = await Promise.all([
    getDashboardStats(),
    getDashboardCharts(range, from, to),
    listExpiring({ window: "month", perPage: 8 }),
    // Only the banner, so the dashboard does not carry the whole alert history.
    listAlerts({ status: "Open", take: 6 }),
    // Phase N. Serials the OLT is serving that nobody is billing for. A handful, so
    // the dashboard carries a list a person can act on rather than a count that
    // could be in the hundreds.
    listRogueOnus({ take: 5 }),
    openRogueCount(),
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

  return (
    <>
      <DeviceAlertBanner count={openAlerts.openCount} alerts={openAlerts.rows.map((a) => ({
        id: a.id,
        deviceType: a.deviceType,
        deviceName: a.deviceName,
        kind: a.kind,
        openedAt: a.openedAt.toISOString(),
        notifiedAt: a.notifiedAt?.toISOString() ?? null,
        notifyError: a.notifyError,
      }))} />
      <DashboardView
        stats={view}
        charts={charts}
        range={range}
        from={from}
        to={to}
        rogues={rogues.map((r) => ({
          id: r.id,
          serialNo: r.serialNo,
          ponIndex: r.ponIndex,
          rxPower: r.rxPower,
          oltName: r.olt.name,
          lastSeenAt: r.lastSeenAt.toISOString(),
          notified: Boolean(r.notifiedAt),
        }))}
        rogueCount={rogueCount}
      />
    </>
  );
}
