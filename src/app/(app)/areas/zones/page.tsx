import type { Metadata } from "next";
import { listZones } from "@/lib/services/areas";
import { ZonesTable } from "@/components/areas/areas-tables";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { formatNumber } from "@/lib/utils";
import { Layers, MapPin, Users, Wifi } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Zones" };

export default async function ZonesPage() {
  const { rows } = await listZones();

  return (
    <>
      <PageHeader
        title="Zones"
        description="Higher level grouping of areas used for network planning and reporting."
        breadcrumb={[{ label: "Areas", href: "/areas" }, { label: "Zones" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Zones" value={formatNumber(rows.length)} icon={Layers} tone="brand" />
          <StatCard label="Areas" value={formatNumber(rows.reduce((s, r) => s + r.areaCount, 0))} icon={MapPin} tone="info" />
          <StatCard label="Customers" value={formatNumber(rows.reduce((s, r) => s + r.customerCount, 0))} icon={Users} tone="neutral" />
          <StatCard label="Online" value={formatNumber(rows.reduce((s, r) => s + r.onlineCount, 0))} icon={Wifi} tone="success" />
        </StatCardGrid>

        <ZonesTable
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            areaCount: r.areaCount,
            customerCount: r.customerCount,
            activeCount: r.activeCount,
            onlineCount: r.onlineCount,
          }))}
        />
      </PageContainer>
    </>
  );
}
