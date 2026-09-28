"use client";

import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { BarChartView, DonutChart, ChartLegend } from "@/components/ui/charts";
import { DataTableShell, ExportCsvButton, TableToolbar, Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Package, TrendingUp, Users, Wallet } from "lucide-react";

export type ReportRow = {
  id: string;
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  monthlyPrice: number;
  totalCustomers: number;
  activeSubscribers: number;
  expiredSubscribers: number;
  unpaidSubscribers: number;
  revenue: number;
};

export function PackageReportView({ rows, mrr }: { rows: ReportRow[]; mrr: number }) {
  const byCustomers = [...rows]
    .filter((r) => r.totalCustomers > 0)
    .sort((a, b) => b.totalCustomers - a.totalCustomers)
    .map((r, i) => ({ label: r.name, value: r.totalCustomers, color: PALETTE[i % PALETTE.length] }));

  const byRevenue = rows
    .filter((r) => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .map((r) => ({ label: r.name, Download: 0, Revenue: r.revenue }));

  const columns: Column<ReportRow>[] = [
    {
      key: "name",
      header: "Package",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="text-[11px] text-fg-subtle">
            {r.downloadSpeed}/{r.uploadSpeed} Mbps
          </p>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "price", header: "Price", align: "right", cell: (r) => <span className="tnum text-xs">{formatCurrency(r.monthlyPrice)}</span>, exportValue: (r) => r.monthlyPrice },
    { key: "total", header: "Customers", align: "right", cell: (r) => <span className="tnum text-xs font-medium">{formatNumber(r.totalCustomers)}</span>, exportValue: (r) => r.totalCustomers },
    { key: "active", header: "Active", align: "right", cell: (r) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{r.activeSubscribers}</span>, exportValue: (r) => r.activeSubscribers },
    { key: "expired", header: "Expired", align: "right", cell: (r) => <span className="tnum text-xs text-red-600 dark:text-red-400">{r.expiredSubscribers}</span>, exportValue: (r) => r.expiredSubscribers },
    { key: "unpaid", header: "Unpaid", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs text-amber-600 dark:text-amber-400">{r.unpaidSubscribers}</span>, exportValue: (r) => r.unpaidSubscribers },
    { key: "revenue", header: "Monthly Revenue", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.revenue)}</span>, exportValue: (r) => r.revenue },
  ];

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalSubs = rows.reduce((s, r) => s + r.totalCustomers, 0);

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Monthly Recurring Revenue" value={formatCurrency(mrr)} icon={Wallet} tone="success" />
        <StatCard label="Package Revenue" value={formatCurrency(totalRevenue)} icon={TrendingUp} tone="brand" />
        <StatCard label="Total Subscribers" value={formatNumber(totalSubs)} icon={Users} tone="info" />
        <StatCard label="Active Packages" value={formatNumber(rows.length)} icon={Package} tone="neutral" />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customer Distribution" description="Subscriber count by package" icon={<Users />} />
          <CardBody>
            {byCustomers.length === 0 ? (
              <EmptyState title="No subscribers yet" />
            ) : (
              <>
                <DonutChart data={byCustomers.slice(0, 8)} centerValue={formatNumber(totalSubs)} centerLabel="customers" />
                <ChartLegend data={byCustomers.slice(0, 8)} />
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Revenue by Package" description="Potential monthly revenue per tier" icon={<TrendingUp />} />
          <CardBody>
            {byRevenue.length === 0 ? (
              <EmptyState title="No revenue data" />
            ) : (
              <BarChartView
                data={byRevenue}
                series={[{ key: "Revenue", label: "Revenue", color: "#3163ff" }]}
                stacked={false}
                horizontal
                money
                height={Math.max(220, byRevenue.length * 30)}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        compact
        toolbar={
          <TableToolbar
            searchPlaceholder="Search packages..."
            actions={<ExportCsvButton rows={rows} columns={columns} filename="package-report" label="Export report" />}
          />
        }
        pagination={null}
        empty={<EmptyState title="No packages to report" description="Create packages to see subscription and revenue reports." />}
      />
    </div>
  );
}

const PALETTE = ["#3163ff", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6", "#a855f7", "#eab308", "#64748b"];
