import type { Metadata } from "next";
import { listAreas } from "@/lib/services/areas";
import { prisma } from "@/lib/prisma";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { AreasTable } from "@/components/areas/areas-tables";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MapPin, Users, Wifi, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Areas" };

export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [result, zones] = await Promise.all([
    listAreas({ q: one("q"), status: one("status") }),
    prisma.zone.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Areas"
        description="Geographic units used for billing, coverage and device placement."
        breadcrumb={[{ label: "Areas", href: "/areas" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Areas" value={formatNumber(result.metrics.total)} icon={MapPin} tone="brand" />
          <StatCard label="Customers" value={formatNumber(result.metrics.customers)} icon={Users} tone="info" />
          <StatCard label="Online" value={formatNumber(result.metrics.online)} icon={Wifi} tone="success" />
          <StatCard label="Outstanding Due" value={formatCurrency(result.metrics.due)} icon={Wallet} tone="danger" />
        </StatCardGrid>

        <AreasTable
          rows={result.rows.map((r) => ({
            id: r.id,
            name: r.name,
            code: r.code,
            status: r.status,
            zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null,
            customers: r.customers,
            active: r.active,
            online: r.online,
            due: r.due,
          }))}
          zones={zones.map((z) => ({ id: z.id, name: z.name }))}
        />
      </PageContainer>
    </>
  );
}
