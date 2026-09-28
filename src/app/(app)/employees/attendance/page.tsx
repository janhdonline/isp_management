import type { Metadata } from "next";
import { parseListParams } from "@/lib/query";
import { attendanceReport } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { DonutChart, ChartLegend } from "@/components/ui/charts";
import { DateRangeFilter } from "@/components/ui/date-filter";
import { AttendanceTable } from "@/components/support/support-views";
import { formatDate, formatNumber } from "@/lib/utils";
import { CalendarCheck, CalendarX, Clock, UserCheck } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const report = await attendanceReport(parseListParams(await searchParams));
  const m = report.metrics;

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`Register for ${formatDate(report.date)}. Mark a status inline — changes save immediately.`}
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "Attendance" }]}
      >
        <DateRangeFilter fromLabel="Attendance date" toLabel="" />
      </PageHeader>

      <PageContainer>
        <StatCardGrid>
          <StatCard label="Present" value={formatNumber(m.present)} icon={UserCheck} tone="success" />
          <StatCard label="Absent" value={formatNumber(m.absent)} icon={CalendarX} tone="danger" />
          <StatCard label="Late" value={formatNumber(m.late)} icon={Clock} tone="warning" />
          <StatCard label="On Leave" value={formatNumber(m.onLeave)} icon={CalendarCheck} tone="neutral" />
        </StatCardGrid>

        <Card>
          <CardHeader title="Day summary" description="How the register splits" />
          <CardBody>
            {m.total ? (
              <>
                <DonutChart data={report.byStatus} centerValue={formatNumber(m.total)} centerLabel="staff" />
                <ChartLegend data={report.byStatus} />
              </>
            ) : (
              <p className="py-6 text-center text-sm text-fg-muted">Nothing recorded for this date.</p>
            )}
          </CardBody>
        </Card>

        <AttendanceTable rows={report.rows} date={report.date} onMarked={() => {}} />
      </PageContainer>
    </>
  );
}
