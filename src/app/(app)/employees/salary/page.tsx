import type { Metadata } from "next";
import { parseListParams } from "@/lib/query";
import { salaryReport } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { SalaryTable, type SalaryRow } from "@/components/support/support-views";
import { BarChartView } from "@/components/ui/charts";
import { formatCurrency } from "@/lib/utils";
import { Banknote, CheckCircle2, Clock, HandCoins } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Salary" };

export default async function SalaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const report = await salaryReport(parseListParams(await searchParams));
  const m = report.metrics;

  return (
    <>
      <PageHeader
        title="Salary"
        description={`Payroll for ${report.month}. Paying a row posts a debit on the cash account.`}
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "Salary" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Salary" value={formatCurrency(m.total)} icon={Banknote} tone="brand" hint={`${m.count} employee(s)`} />
          <StatCard label="Paid" value={formatCurrency(m.paid)} icon={CheckCircle2} tone="success" />
          <StatCard label="Pending" value={formatCurrency(m.pending)} icon={Clock} tone="warning" />
          <StatCard label="Advance" value={formatCurrency(m.advance)} icon={HandCoins} tone="neutral" />
        </StatCardGrid>

        {m.total > 0 ? (
          <Card>
            <CardHeader title="Salary composition" description="Basic, allowance and deductions for the month" />
            <CardBody>
              <BarChartView
                data={report.rows.map((r) => ({
                  label: r.employee.name,
                  Basic: r.basic,
                  Allowance: r.allowance,
                  Deduction: r.deduction,
                }))}
                series={[
                  { key: "Basic", label: "Basic", color: "#3163ff" },
                  { key: "Allowance", label: "Allowance", color: "#10b981" },
                  { key: "Deduction", label: "Deduction", color: "#f43f5e" },
                ]}
                horizontal
                money
                height={Math.max(220, report.rows.length * 32)}
              />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={`Payroll — ${report.month}`} />
          <CardBody className="p-0">
            <SalaryTable rows={report.rows as unknown as SalaryRow[]} month={report.month} onGenerate={() => {}} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
