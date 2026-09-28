"use client";

import Link from "next/link";
import { DataTableShell, TableToolbar, ExportCsvButton, type Column } from "@/components/ui/data-table";
import { EmptyState, NoSearchResults } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { BarChartView, DonutChart, ChartLegend, TrendChart } from "@/components/ui/charts";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { useTableQuery } from "@/components/ui/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AlertTriangle, Banknote, CalendarClock, TrendingUp, Wallet } from "lucide-react";

export type DueRow = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  username: string;
  phone: string;
  packageName: string | null;
  areaId: string | null;
  areaName: string | null;
  total: number;
  paid: number;
  balance: number;
  issueDate: Date;
  dueDate: Date;
  daysOverdue: number;
};

export type DueSummaryData = {
  total: number;
  count: number;
  aging: { label: string; value: number }[];
  byArea: { label: string; value: number }[];
  byPackage: { label: string; value: number }[];
  trend: { label: string; Due: number; Collected: number }[];
};

export function BillingDueView({
  rows,
  summary,
}: {
  rows: DueRow[];
  summary: DueSummaryData;
}) {
  const { searchParams } = useTableQuery();
  const hasFilters = Array.from(searchParams.keys()).some((k) => !["page", "perPage"].includes(k));

  const columns: Column<DueRow>[] = [
    {
      key: "invoice",
      header: "Invoice",
      cell: (r) => (
        <Link href={`/billing/invoices/${r.id}`} className="font-mono text-xs font-medium hover:text-brand-600">
          {r.invoiceNumber}
        </Link>
      ),
      exportValue: (r) => r.invoiceNumber,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/customers/${r.customerId}`} className="block truncate font-medium hover:text-brand-600">
            {r.customerName}
          </Link>
          <span className="block truncate text-[11px] text-fg-subtle">{r.phone}</span>
        </div>
      ),
      exportValue: (r) => r.customerName,
    },
    { key: "package", header: "Package", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.packageName ?? "—"}</span>, exportValue: (r) => r.packageName ?? "" },
    { key: "area", header: "Area", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.areaName ?? "—"}</span>, exportValue: (r) => r.areaName ?? "" },
    { key: "due", header: "Due date", hideBelow: "sm", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.dueDate)}</span>, exportValue: (r) => formatDate(r.dueDate) },
    { key: "total", header: "Billed", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs">{formatCurrency(r.total)}</span>, exportValue: (r) => r.total },
    { key: "paid", header: "Paid", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs">{formatCurrency(r.paid)}</span>, exportValue: (r) => r.paid },
    { key: "balance", header: "Balance", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-red-600 dark:text-red-400">{formatCurrency(r.balance)}</span>, exportValue: (r) => r.balance },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (r) => (
        <Badge tone={r.daysOverdue > 30 ? "danger" : r.daysOverdue > 7 ? "warning" : "neutral"}>
          {r.daysOverdue > 0 ? `${r.daysOverdue}d overdue` : "Not due"}
        </Badge>
      ),
      exportValue: (r) => r.daysOverdue,
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (r) => (
        <Link href={`/billing/payments/new?customerId=${r.customerId}&invoiceId=${r.id}`} className="text-xs font-medium text-brand-600 hover:underline">
          Collect
        </Link>
      ),
    },
  ];

  const aging = summary.aging;
  const collectedRatio = summary.trend.length
    ? 100 - (summary.trend[summary.trend.length - 1].Due / Math.max(1, summary.trend[summary.trend.length - 1].Due + summary.trend[summary.trend.length - 1].Collected)) * 100
    : 0;

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Outstanding" value={formatCurrency(summary.total)} icon={Wallet} tone="danger" hint={`${summary.count} invoices`} />
        <StatCard label="1-7 Days" value={formatCurrency(aging.find((a) => a.label === "1-7 days")?.value ?? 0)} icon={CalendarClock} tone="warning" />
        <StatCard label="8-30 Days" value={formatCurrency(aging.find((a) => a.label === "8-30 days")?.value ?? 0)} icon={AlertTriangle} tone="warning" />
        <StatCard label="30+ Days" value={formatCurrency(aging.find((a) => a.label === "30+ days")?.value ?? 0)} icon={AlertTriangle} tone="danger" />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Aging" description="Balance by days overdue" icon={<CalendarClock />} />
          <CardBody>
            <DonutChart
              data={aging.map((a, i) => ({ label: a.label, value: a.value, color: ["#10b981", "#f59e0b", "#f97316", "#ef4444"][i] }))}
              centerValue={formatCurrency(summary.total)}
              centerLabel="outstanding"
            />
            <ChartLegend data={aging.map((a, i) => ({ label: a.label, value: a.value, color: ["#10b981", "#f59e0b", "#f97316", "#ef4444"][i] }))} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Area-wise Due" description="Where the money is stuck" icon={<Wallet />} />
          <CardBody>
            {summary.byArea.length ? (
              <BarChartView data={summary.byArea} series={[{ key: "value", label: "Due" }]} stacked={false} horizontal money height={Math.max(200, summary.byArea.length * 30)} />
            ) : (
              <EmptyState title="No area dues" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Package-wise Due" description="Outstanding by plan" icon={<TrendingUp />} />
          <CardBody>
            {summary.byPackage.length ? (
              <BarChartView data={summary.byPackage} series={[{ key: "value", label: "Due" }]} stacked={false} horizontal money height={Math.max(200, summary.byPackage.length * 30)} />
            ) : (
              <EmptyState title="No package dues" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Due vs Collected"
          description="Collection progress over the last 12 months"
          icon={<TrendingUp />}
          action={<Badge tone="success">{collectedRatio.toFixed(0)}% collected this month</Badge>}
        />
        <CardBody>
          {summary.trend.some((t) => t.Due > 0 || t.Collected > 0) ? (
            <TrendChart
              data={summary.trend}
              series={[
                { key: "Collected", label: "Collected", color: "#10b981" },
                { key: "Due", label: "Due", color: "#f43f5e" },
              ]}
              money
              height={240}
            />
          ) : (
            <EmptyState title="Not enough data" description="At least one month of billing history is needed." />
          )}
        </CardBody>
      </Card>

      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        compact
        toolbar={
          <TableToolbar
            searchPlaceholder="Search invoice, customer, phone..."
            actions={<ExportCsvButton rows={rows} columns={columns} filename="due-invoices" label="Export due" />}
          />
        }
        empty={
          hasFilters ? (
            <NoSearchResults />
          ) : (
            <EmptyState
              icon={<Banknote />}
              title="Nothing outstanding"
              description="Every invoice has been settled. Excellent collection rate."
            />
          )
        }
      />
    </div>
  );
}
