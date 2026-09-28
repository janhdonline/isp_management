import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query";
import { listLeaves } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { LeaveTable, type LeaveRow } from "@/components/support/support-views";
import { LeaveForm } from "@/components/support/forms";
import { formatNumber } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [result, employees] = await Promise.all([
    listLeaves(parseListParams(await searchParams)),
    prisma.employee.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const m = result.metrics ?? {};

  return (
    <>
      <PageHeader
        title="Leave"
        description="Requests waiting for a decision, and the ones already settled."
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "Leave" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Pending" value={formatNumber(m.Pending ?? 0)} icon={Clock} tone="warning" />
          <StatCard label="Approved" value={formatNumber(m.Approved ?? 0)} icon={CheckCircle2} tone="success" />
          <StatCard label="Rejected" value={formatNumber(m.Rejected ?? 0)} icon={XCircle} tone="danger" />
          <StatCard label="Total" value={formatNumber(result.total)} icon={Clock} tone="neutral" />
        </StatCardGrid>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Leave requests" description="Approve or reject from the row actions" />
            <CardBody className="p-0">
              <LeaveTable
                rows={result.rows as unknown as LeaveRow[]}
                total={result.total}
                page={result.page}
                perPage={result.perPage}
                totalPages={result.totalPages}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="New request" description="Employees can also raise these themselves" />
            <CardBody>
              <LeaveForm employees={employees} />
            </CardBody>
          </Card>
        </div>
      </PageContainer>
    </>
  );
}
