import type { Metadata } from "next";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { listResellers } from "@/lib/services/resellers";
import {
  ResellerTable,
  NewResellerButton,
} from "@/components/resellers/reseller-views";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Handshake, PhoneCall, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resellers" };

export default async function ResellersPage() {
  const [{ rows, metrics }, areas] = await Promise.all([
    listResellers(),
    prisma.area.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Resellers"
        description="People who collect cash in a zone on your behalf. Commission is derived from the payments they are attributed to, never stored separately."
        breadcrumb={[{ label: "Resellers" }]}
        actions={<NewResellerButton areas={areas} />}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Resellers" value={formatNumber(metrics.total)} icon={Handshake} tone="brand" />
          <StatCard label="Active" value={formatNumber(metrics.active)} icon={PhoneCall} tone="success" />
          <StatCard
            label="Collected (all time)"
            value={metrics.collected > 0 ? formatCurrency(metrics.collected) : "—"}
            icon={Users}
            tone="info"
          />
        </StatCardGrid>

        <Card>
          <CardHeader
            title="Resellers"
            description="Track and report only — there is no reseller ledger and no reseller login."
          />
          <CardBody className="p-0">
            <ResellerTable rows={rows} areas={areas} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}