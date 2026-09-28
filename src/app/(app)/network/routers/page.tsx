import type { Metadata } from "next";
import { listRouters } from "@/lib/services/network";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { RoutersTable } from "@/components/network/network-tables";
import { formatNumber } from "@/lib/utils";
import { Router as RouterIcon, Server, Users, Wifi } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Routers" };

export default async function RoutersPage() {
  const routers = await listRouters();

  return (
    <>
      <PageHeader
        title="Routers"
        description="Edge and core routers with health metrics reported by the MikroTik adapter."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Routers" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Routers" value={formatNumber(routers.length)} icon={RouterIcon} tone="brand" />
          <StatCard label="Online" value={formatNumber(routers.filter((r) => r.status === "Online").length)} icon={Wifi} tone="success" />
          <StatCard label="Customers Served" value={formatNumber(routers.reduce((s, r) => s + r.customers, 0))} icon={Users} tone="info" />
          <StatCard label="Active Sessions" value={formatNumber(routers.reduce((s, r) => s + r.onlineUsers, 0))} icon={Server} tone="warning" />
        </StatCardGrid>

        <RoutersTable rows={routers} />
      </PageContainer>
    </>
  );
}
