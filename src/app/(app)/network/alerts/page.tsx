import type { Metadata } from "next";
import Link from "next/link";
import { parseListParams } from "@/lib/query";
import { listAlerts } from "@/lib/services/device-alerts";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { AlertCount } from "@/components/network/device-alert-banner";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { BellRing, CheckCircle2, Radio } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Device Alerts" };

/**
 * Every outage and recovery the monitor has seen.
 *
 * One row per incident, not one per poll — a router that was down for six hours
 * is one row here and one page sent, and the `opened`/`resolved` pair is the whole
 * story of it.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseListParams(await searchParams);
  const status = typeof params.status === "string" && params.status ? params.status : undefined;
  // `ListParams` has no deviceType, so it is read off the raw search params.
  const rawDeviceType = (await searchParams).deviceType;
  const deviceType = typeof rawDeviceType === "string" ? rawDeviceType : undefined;

  const result = await listAlerts({ status, deviceType, take: 200 });
  const rows = result.rows;

  const open = rows.filter((r) => r.status === "Open").length;
  const down = rows.filter((r) => r.status === "Open" && r.kind === "Down").length;
  const lowSignal = rows.filter((r) => r.status === "Open" && r.kind === "LowSignal").length;
  const unnotified = rows.filter((r) => r.status === "Open" && r.notifyError).length;

  return (
    <>
      <PageHeader
        title="Device Alerts"
        description="Routers and OLTs that went unreachable, and ONUs that lost signal. One alert per incident, not one per check."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Alerts" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Open" value={String(result.openCount)} icon={BellRing} tone={result.openCount ? "danger" : "neutral"} />
          <StatCard label="Unreachable" value={String(down)} icon={Radio} tone={down ? "danger" : "neutral"} />
          <StatCard label="Low signal" value={String(lowSignal)} icon={Radio} tone={lowSignal ? "warning" : "neutral"} />
          <StatCard label="Nobody notified" value={String(unnotified)} icon={CheckCircle2} tone={unnotified ? "warning" : "neutral"} hint="the page could not be sent" />
        </StatCardGrid>

        <nav className="flex flex-wrap gap-2 text-xs">
          <FilterLink label="All" href="/network/alerts" active={!status && !deviceType} />
          <FilterLink label="Open" href="/network/alerts?status=Open" active={status === "Open"} />
          <FilterLink label="Resolved" href="/network/alerts?status=Resolved" active={status === "Resolved"} />
          <span className="mx-1 text-fg-subtle">·</span>
          <FilterLink label="Routers" href="/network/alerts?deviceType=Router" active={deviceType === "Router"} />
          <FilterLink label="OLTs" href="/network/alerts?deviceType=OLT" active={deviceType === "OLT"} />
          <FilterLink label="ONUs" href="/network/alerts?deviceType=ONU" active={deviceType === "ONU"} />
        </nav>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Alert</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Resolved</th>
                <th className="px-3 py-2">Notified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <span className="text-xs text-fg-subtle">{a.deviceType}</span>
                    <p className="text-sm font-medium">{a.deviceName}</p>
                    {a.detail ? (
                      <p className="mt-0.5 max-w-sm text-[11px] text-fg-muted">{a.detail}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{a.kind}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                    {formatDateTime(a.openedAt)}
                    <p className="text-[11px]">{relativeTime(a.openedAt)}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                    {a.resolvedAt ? formatDateTime(a.resolvedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.notifiedAt ? (
                      <span className="text-fg-muted">{a.notifyChannel}</span>
                    ) : a.notifyError ? (
                      // Said plainly: the device is down and nobody was told, which
                      // is a different situation from a device down and paged.
                      <span className="text-amber-600 dark:text-amber-400" title={a.notifyError}>
                        failed — {a.notifyError}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-fg-muted">
                    Nothing here. When a router stops answering, it will be on this page —
                    and on the dashboard.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {open > 0 ? (
          <p className="text-xs text-fg-muted">
            <AlertCount count={open} /> open of {rows.length} shown.
          </p>
        ) : null}
      </PageContainer>
    </>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md border border-brand-500 bg-brand-50 px-2.5 py-1 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
          : "rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-fg-subtle hover:bg-[var(--surface-3)]"
      }
    >
      {label}
    </Link>
  );
}