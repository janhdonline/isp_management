import type { Metadata } from "next";
import { parseListParams } from "@/lib/query";
import { listEmployees, employeeMetrics } from "@/lib/services/support";
import { getAreasSimple } from "@/lib/services/areas";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { EmployeesTable, type EmployeeRow } from "@/components/support/support-views";
import { formatNumber } from "@/lib/utils";
import { Briefcase, CalendarClock, UserCheck, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, areas] = await Promise.all([
    listEmployees(p),
    employeeMetrics(),
    getAreasSimple(),
  ]);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Your support, field and office staff — with attendance, leave and payroll."
        breadcrumb={[{ label: "Employees", href: "/employees" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Employees" value={formatNumber(metrics.total)} icon={Users} tone="brand" />
          <StatCard label="Active" value={formatNumber(metrics.active)} icon={UserCheck} tone="success" />
          <StatCard label="On Leave" value={formatNumber(metrics.onLeave)} icon={CalendarClock} tone="warning" />
          <StatCard label="Technicians" value={formatNumber(metrics.technicians)} icon={Briefcase} tone="info" />
        </StatCardGrid>

        <EmployeesTable
          rows={result.rows as unknown as EmployeeRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
        />
      </PageContainer>
    </>
  );
}
