import type { Metadata } from "next";
import { listOnus, onuMetrics } from "@/lib/services/network";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Pagination } from "@/components/ui/data-table";
import { OnusTable } from "@/components/network/network-tables";
import { can } from "@/lib/auth";
import { formatNumber } from "@/lib/utils";
import { Signal, Wifi, WifiOff, Zap } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ONU" };

export default async function OnuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, olts, areas, canControl] = await Promise.all([
    listOnus(p),
    onuMetrics(),
    prisma.olt.findMany({ orderBy: { name: "asc" } }),
    prisma.area.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
    // Resolved on the server so a reader is never shown a button that would only
    // fail. The service layer checks again; this is presentation, not enforcement.
    can("network.edit"),
  ]);

  return (
    <>
      <PageHeader
        title="ONU"
        description="Optical network units with signal levels, registration state and their assigned customer."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "ONU" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total ONUs" value={formatNumber(metrics.total)} icon={Zap} tone="brand" />
          <StatCard label="Online" value={formatNumber(metrics.online)} icon={Wifi} tone="success" />
          <StatCard label="Offline" value={formatNumber(metrics.offline)} icon={WifiOff} tone="danger" />
          <StatCard label="Low Signal" value={formatNumber(metrics.low)} icon={Signal} tone="warning" hint="RX power below -28 dBm" />
        </StatCardGrid>

        <OnusTable
          canControl={canControl}
            rows={result.rows.map((o) => ({
              id: o.id,
              serialNo: o.serialNo,
              name: o.name,
              vendor: o.vendor,
              ponIndex: o.ponIndex,
              rxPower: o.rxPower,
              txPower: o.txPower,
              status: o.status,
              lastSeenAt: o.lastSeenAt,
              olt: o.olt,
              area: o.area,
              customer: o.customers[0] ?? null,
            }))}
            olts={olts.map((o) => ({ id: o.id, name: o.name }))}
            areas={areas.map((a) => ({ id: a.id, name: a.name }))}
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
