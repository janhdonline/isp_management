import type { Metadata } from "next";
import Link from "next/link";
import { listOnline, listRouters, listOlts, onuMetrics, bandwidthReport } from "@/lib/services/network";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { OnlineUsersTable, type OnlineRow } from "@/components/network/network-views";
import { RouterSummaryTable, OltSummaryTable } from "@/components/network/network-summaries";
import { formatBytes, formatNumber } from "@/lib/utils";
import { Router as RouterIcon, Server, Wifi, Zap, Users, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Network" };

export default async function NetworkPage() {
  const [online, routers, olts, onus, bandwidth, areas, packages] = await Promise.all([
    listOnline({ perPage: 100 }),
    listRouters(),
    listOlts(),
    onuMetrics(),
    bandwidthReport(),
    prisma.area.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
    prisma.package.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Network"
        description="Live sessions, routers, OLTs and ONU health across the whole network."
        breadcrumb={[{ label: "Network", href: "/network" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Online Users" value={formatNumber(online.total)} icon={Wifi} tone="success" href="/network/online" />
          <StatCard label="Routers" value={formatNumber(routers.length)} icon={RouterIcon} tone="brand" href="/network/routers" hint={`${routers.filter((r) => r.status === "Online").length} online`} />
          <StatCard label="OLTs" value={formatNumber(olts.length)} icon={Server} tone="info" href="/network/olt" hint={`${onus.ponPorts} PON ports`} />
          <StatCard label="ONUs Online" value={formatNumber(onus.online)} icon={Zap} tone="warning" href="/network/onu" hint={`${onus.low} low signal`} />
        </StatCardGrid>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Live Sessions"
              description="Customers currently connected"
              icon={<Users />}
              action={
                <Link href="/network/online" className="text-xs font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              }
            />
            <CardBody className="p-0">
              <OnlineUsersTable
                rows={online.rows.slice(0, 10) as unknown as OnlineRow[]}
                areas={areas.map((a) => ({ id: a.id, name: a.name }))}
                packages={packages.map((p) => ({ id: p.id, name: p.name }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Routers"
              description="Edge and core devices"
              icon={<RouterIcon />}
              action={
                <Link href="/network/routers" className="text-xs font-medium text-brand-600 hover:underline">
                  Manage
                </Link>
              }
            />
            <CardBody className="p-0">
              <RouterSummaryTable
                rows={routers.map((r) => ({
                  id: r.id,
                  name: r.name,
                  ipAddress: r.ipAddress,
                  model: r.model,
                  location: r.location,
                  status: r.status,
                  onlineUsers: r.onlineUsers,
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="OLTs"
              description="Fibre aggregation devices"
              icon={<Server />}
              action={
                <Link href="/network/olt" className="text-xs font-medium text-brand-600 hover:underline">
                  Manage
                </Link>
              }
            />
            <CardBody className="p-0">
              <OltSummaryTable
                rows={olts.map((o) => ({
                  id: o.id,
                  name: o.name,
                  vendor: o.vendor,
                  ponPorts: o.ponPorts,
                  onlineOnu: o.onlineOnu,
                  offlineOnu: o.offlineOnu,
                  status: o.status,
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Bandwidth Snapshot"
              description="Current session volume"
              icon={<TrendingUp />}
              action={
                <Link href="/network/bandwidth" className="text-xs font-medium text-brand-600 hover:underline">
                  Details
                </Link>
              }
            />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                {[
                  ["Total download", formatBytes(bandwidth.metrics.totalDownload)],
                  ["Total upload", formatBytes(bandwidth.metrics.totalUpload)],
                  ["Peak", formatBytes(bandwidth.metrics.peak)],
                  ["Average", formatBytes(bandwidth.metrics.average)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      </PageContainer>
    </>
  );
}
