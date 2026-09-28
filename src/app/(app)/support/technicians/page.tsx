import type { Metadata } from "next";
import { listTechnicians } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { TechniciansTable, type TechnicianRow } from "@/components/support/support-views";
import { formatNumber } from "@/lib/utils";
import { Briefcase, CheckCircle2, Ticket as TicketIcon, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Technicians" };

export default async function TechniciansPage() {
  const { rows, metrics } = await listTechnicians();

  return (
    <>
      <PageHeader
        title="Technicians"
        description="Who is free, who is loaded, and how many tickets each has closed."
        breadcrumb={[{ label: "Support", href: "/support" }, { label: "Technicians" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Technicians" value={formatNumber(metrics.total)} icon={Users} tone="brand" />
          <StatCard label="Available" value={formatNumber(metrics.available)} icon={CheckCircle2} tone="success" />
          <StatCard label="Busy" value={formatNumber(metrics.busy)} icon={Briefcase} tone="warning" />
          <StatCard label="Open Tickets" value={formatNumber(metrics.openTickets)} icon={TicketIcon} tone="danger" />
        </StatCardGrid>

        <TechniciansTable rows={rows as TechnicianRow[]} hasFilters={false} />
      </PageContainer>
    </>
  );
}
