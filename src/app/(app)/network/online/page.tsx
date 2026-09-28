import type { Metadata } from "next";
import { listOnline } from "@/lib/services/network";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Pagination } from "@/components/ui/data-table";
import { OnlineUsersTable, OnlineRow } from "@/components/network/network-views";
import { formatBytes, formatNumber } from "@/lib/utils";
import { TrendingUp, Users, Gauge } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Online Users" };

export default async function NetworkOnlinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, areas, packages] = await Promise.all([
    listOnline(p),
    prisma.area.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
    prisma.package.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
  ]);

  const down = result.rows.reduce((s, r) => s + Number(r.downloadBytes ?? 0), 0);
  const up = result.rows.reduce((s, r) => s + Number(r.uploadBytes ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Online Users"
        description="Every live PPPoE session with traffic counters and the router serving it."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Online Users" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Online Users" value={formatNumber(result.total)} icon={Users} tone="success" />
          <StatCard label="Download Traffic" value={formatBytes(down)} icon={TrendingUp} tone="brand" />
          <StatCard label="Upload Traffic" value={formatBytes(up)} icon={TrendingUp} tone="info" />
          <StatCard label="Avg per User" value={formatBytes(result.total ? (down + up) / result.total : 0)} icon={Gauge} tone="neutral" />
        </StatCardGrid>

        <OnlineUsersTable
          rows={result.rows as unknown as OnlineRow[]}
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
          packages={packages.map((p) => ({ id: p.id, name: p.name }))}
          pagination={
            <Pagination
              page={result.page}
              perPage={result.perPage}
              total={result.total}
              totalPages={result.totalPages}
            />
          }
        />
      </PageContainer>
    </>
  );
}
