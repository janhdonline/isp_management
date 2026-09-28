import type { Metadata } from "next";
import { listOlts, onuMetrics } from "@/lib/services/network";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { OltsTable } from "@/components/network/network-tables";
import { formatNumber } from "@/lib/utils";
import { Radio, Server, Wifi, WifiOff } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "OLT" };

export default async function OltPage() {
  const [olts, metrics] = await Promise.all([listOlts(), onuMetrics()]);

  return (
    <>
      <PageHeader
        title="OLT"
        description="Optical line terminals with PON port capacity and ONU registration status."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "OLT" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total OLT" value={formatNumber(olts.length)} icon={Server} tone="brand" />
          <StatCard label="PON Ports" value={formatNumber(metrics.ponPorts)} icon={Radio} tone="info" />
          <StatCard label="ONUs Online" value={formatNumber(metrics.online)} icon={Wifi} tone="success" />
          <StatCard label="ONUs Offline" value={formatNumber(metrics.offline)} icon={WifiOff} tone="danger" hint={`${metrics.low} low signal`} />
        </StatCardGrid>

        <OltsTable rows={olts} />
      </PageContainer>
    </>
  );
}
