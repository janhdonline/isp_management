import type { Metadata } from "next";
import { listEnforcement } from "@/lib/services/enforcement-queries";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { EnforcementTable, EnforcementBanner } from "@/components/network/enforcement-table";
import { formatNumber } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Router Enforcement" };

export default async function EnforcementPage() {
  const { rows, metrics } = await listEnforcement("All");

  return (
    <>
      <PageHeader
        title="Router Enforcement"
        description="Every suspend and reconnect sent to the network, and the ones the router has not accepted yet."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Enforcement" }]}
      />
      <PageContainer className="space-y-4">
        <EnforcementBanner pending={metrics.Pending} />

        <StatCardGrid>
          <StatCard
            label="Waiting"
            value={formatNumber(metrics.Pending)}
            icon={Clock}
            tone={metrics.Pending > 0 ? "warning" : "neutral"}
          />
          <StatCard label="Delivered" value={formatNumber(metrics.Done)} icon={CheckCircle2} tone="success" />
          <StatCard label="Given up" value={formatNumber(metrics.Failed)} icon={XCircle} tone="danger" />
        </StatCardGrid>

        <EnforcementTable rows={rows} />
      </PageContainer>
    </>
  );
}
