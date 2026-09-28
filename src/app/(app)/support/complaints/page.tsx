import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query";
import { listComplaints, complaintMetrics } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { BarChartView, DonutChart, ChartLegend } from "@/components/ui/charts";
import { TicketsTable, type TicketRow } from "@/components/support/support-views";
import { formatNumber } from "@/lib/utils";
import { CircleDot, MessageSquare, Percent, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Complaints" };

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, technicians] = await Promise.all([
    listComplaints(p),
    complaintMetrics(),
    prisma.employee.findMany({ where: { role: { contains: "Technician" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const chart = metrics.categories.map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }));
  const unresolved = metrics.total ? Math.round((metrics.open / metrics.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Complaints"
        description="Complaints grouped by problem category so you can see what actually breaks."
        breadcrumb={[{ label: "Support", href: "/support" }, { label: "Complaints" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Complaints" value={formatNumber(metrics.total)} icon={MessageSquare} tone="brand" />
          <StatCard label="Unresolved" value={formatNumber(metrics.open)} icon={CircleDot} tone="warning" />
          <StatCard label="Unresolved Rate" value={`${unresolved}%`} icon={Percent} tone={unresolved > 40 ? "danger" : "success"} />
          <StatCard label="Top Category" value={chart[0]?.label ?? "—"} icon={TriangleAlert} tone="neutral" hint={String(chart[0]?.value ?? 0)} />
        </StatCardGrid>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="By Category" description="Where the problems are" />
            <CardBody>
              {chart.length ? (
                <>
                  <DonutChart data={chart} centerValue={formatNumber(metrics.total)} centerLabel="complaints" />
                  <ChartLegend data={chart} />
                </>
              ) : (
                <p className="py-10 text-center text-sm text-fg-muted">No complaints recorded.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Category comparison" />
            <CardBody>
              {chart.length ? (
                <BarChartView data={chart} series={[{ key: "value", label: "Complaints" }]} stacked={false} horizontal height={Math.max(220, chart.length * 32)} />
              ) : (
                <p className="py-10 text-center text-sm text-fg-muted">Nothing to chart yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <TicketsTable
          rows={result.rows as unknown as TicketRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
          technicians={technicians}
          showStatusColumn={false}
          searchPlaceholder="Search complaint, subject, customer..."
        />
      </PageContainer>
    </>
  );
}

const PALETTE = ["#3163ff", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6", "#a855f7", "#eab308", "#64748b"];
