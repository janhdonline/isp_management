"use client";

import * as React from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { DataTableShell, ExportCsvButton, TableToolbar, useTableQuery, type Column } from "@/components/ui/data-table";
import { DateRangeFilter } from "@/components/ui/date-filter";
import { EmptyState } from "@/components/ui/states";
import { BarChartView, DonutChart, ChartLegend, TrendChart } from "@/components/ui/charts";
import { formatCurrency, formatDate, formatNumber, formatUptime, formatBytes } from "@/lib/utils";
import {
  ArrowRight, Banknote, CalendarClock, CheckCircle2, FileSpreadsheet,
  Gauge, Percent, Printer, TrendingUp, Users, Wallet, Zap,
} from "lucide-react";

const PALETTE = ["#3163ff", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6", "#a855f7", "#eab308", "#64748b"];

/* ------------------------------------------------------------------ */
/* Report shell                                                        */
/* ------------------------------------------------------------------ */

export function ReportShell({
  tab,
  children,
}: {
  tab: string;
  children: React.ReactNode;
}) {
  const items = [
    { value: "customers", label: "Customers", href: "/reports?tab=customers" },
    { value: "billing", label: "Billing", href: "/reports?tab=billing" },
    { value: "collection", label: "Collection", href: "/reports?tab=collection" },
    { value: "due", label: "Due", href: "/reports?tab=due" },
    { value: "expense", label: "Expense", href: "/reports?tab=expense" },
    { value: "pnl", label: "Profit & Loss", href: "/reports?tab=pnl" },
    { value: "network", label: "Network", href: "/reports?tab=network" },
    { value: "attendance", label: "Attendance", href: "/reports?tab=attendance" },
    { value: "corporate", label: "Corporate", href: "/reports?tab=corporate" },
    { value: "corporate-collection", label: "Corp. Receivables", href: "/reports?tab=corporate-collection" },
    { value: "btrc", label: "BTRC", href: "/reports?tab=btrc" },
  ];

  return (
    <div className="space-y-4">
      {/* Every report shares /reports and differs only by ?tab, so the active
          item has to be told explicitly rather than derived from the path. */}
      <Tabs items={items} value={tab} />
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <DateRangeFilter fromLabel="Report from" toLabel="Report to" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)]"
          >
            <Printer className="size-4" /> Print
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/* ================================================================== */
/* Customer report                                                     */
/* ================================================================== */

type CustomerData = {
  total: number;
  newInRange: number;
  disconnects: number;
  byStatus: { label: string; value: number }[];
  byPackage: { label: string; value: number }[];
  byArea: { label: string; value: number; bill: number; due: number }[];
};

export function CustomerReport({ data }: { data: CustomerData }) {
  const columns: Column<CustomerData["byArea"][number]>[] = [
    { key: "area", header: "Area", cell: (r) => <span className="font-medium">{r.label}</span>, exportValue: (r) => r.label },
    { key: "customers", header: "Customers", align: "right", cell: (r) => <span className="tnum text-xs">{r.value}</span>, exportValue: (r) => r.value },
    { key: "bill", header: "Monthly Bill", align: "right", cell: (r) => <span className="tnum text-xs">{formatCurrency(r.bill)}</span>, exportValue: (r) => r.bill },
    { key: "due", header: "Due", align: "right", cell: (r) => <span className="tnum text-xs text-red-600 dark:text-red-400">{formatCurrency(r.due)}</span>, exportValue: (r) => r.due },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Customers" value={formatNumber(data.total)} icon={Users} tone="brand" />
        <StatCard label="New in Range" value={formatNumber(data.newInRange)} icon={TrendingUp} tone="success" />
        <StatCard label="Disconnected in Range" value={formatNumber(data.disconnects)} icon={ArrowRight} tone="danger" />
        <StatCard label="Net Change" value={data.newInRange - data.disconnects} icon={Gauge} tone={data.newInRange >= data.disconnects ? "success" : "danger"} />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By Status" description="Connection status of the whole base">
          <DonutChart
            data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))}
            centerValue={formatNumber(data.total)}
            centerLabel="customers"
          />
          <ChartLegend data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))} />
        </Panel>
        <Panel title="By Package" description="Which tier customers are on">
          {data.byPackage.length ? (
            <BarChartView data={data.byPackage} series={[{ key: "value", label: "Customers" }]} stacked={false} horizontal height={Math.max(220, data.byPackage.length * 30)} />
          ) : (
            <EmptyState title="No package data" />
          )}
        </Panel>
      </div>

      <DataTableShell
        columns={columns}
        rows={data.byArea}
        rowKey={(r) => r.label}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search area..." actions={<ExportCsvButton rows={data.byArea} columns={columns} filename="customer-report" label="Export" />} />}
        empty={<EmptyState title="No area data" />}
      />
    </div>
  );
}

/* ================================================================== */
/* Billing report                                                      */
/* ================================================================== */

type BillingData = {
  total: number;
  cancelled: number;
  billed: number;
  collected: number;
  outstanding: number;
  discount: number;
  vat: number;
  byStatus: { label: string; value: number }[];
};

export function BillingReport({ data }: { data: BillingData }) {
  const rate = data.billed > 0 ? Math.round((data.collected / data.billed) * 100) : 0;
  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Invoices Raised" value={formatNumber(data.total)} icon={FileSpreadsheet} tone="brand" />
        <StatCard label="Total Billed" value={formatCurrency(data.billed)} icon={Wallet} tone="info" />
        <StatCard label="Collected" value={formatCurrency(data.collected)} icon={CheckCircle2} tone="success" hint={`${rate}% of billed`} />
        <StatCard label="Outstanding" value={formatCurrency(data.outstanding)} icon={CalendarClock} tone="danger" />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By status" description="How invoices ended up">
          <DonutChart data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))} />
          <ChartLegend data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))} />
        </Panel>
        <Panel title="Adjustments" description="Discount and tax within the period">
          <dl className="space-y-3 text-sm">
            <Line label="Gross billed" value={formatCurrency(data.billed)} />
            <Line label="Discount given" value={`- ${formatCurrency(data.discount)}`} />
            <Line label="Tax / VAT" value={formatCurrency(data.vat)} />
            <Line label="Net payable" value={formatCurrency(data.billed)} bold />
            <Line label="Cancelled invoices" value={formatNumber(data.cancelled)} />
          </dl>
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Collection report                                                   */
/* ================================================================== */

type CollectionData = {
  total: number;
  count: number;
  byMethod: { label: string; value: number; count: number }[];
  byAccount: { label: string; value: number }[];
  byDay: { label: string; value: number }[];
  rows: {
    id: string;
    paymentDate: Date;
    amount: number;
    method: string;
    transactionId: string | null;
    account: { name: string; type: string };
    collectedBy: { name: string } | null;
    customer: { name: string; username: string };
  }[];
};

export function CollectionReport({ data }: { data: CollectionData }) {
  const columns: Column<CollectionData["rows"][number]>[] = [
    { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.paymentDate)}</span>, exportValue: (r) => formatDate(r.paymentDate) },
    { key: "customer", header: "Customer", cell: (r) => <span className="truncate text-xs">{r.customer.name}</span>, exportValue: (r) => r.customer.name },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "method", header: "Method", cell: (r) => <Badge>{r.method}</Badge>, exportValue: (r) => r.method },
    { key: "txn", header: "Transaction", hideBelow: "lg", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.transactionId ?? "—"}</span>, exportValue: (r) => r.transactionId ?? "" },
    { key: "account", header: "Account", hideBelow: "sm", cell: (r) => <span className="text-xs text-fg-muted">{r.account.name}</span>, exportValue: (r) => r.account.name },
    { key: "by", header: "Collector", align: "right", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.collectedBy?.name ?? "System"}</span>, exportValue: (r) => r.collectedBy?.name ?? "System" },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Collected" value={formatCurrency(data.total)} icon={Banknote} tone="success" />
        <StatCard label="Transactions" value={formatNumber(data.count)} icon={FileSpreadsheet} tone="brand" />
        <StatCard
          label="Average Payment"
          value={formatCurrency(data.count ? data.total / data.count : 0)}
          icon={Gauge}
          tone="neutral"
        />
        <StatCard label="Payment Methods" value={formatNumber(data.byMethod.length)} icon={Zap} tone="info" />
      </StatCardGrid>

      <Panel title="Daily collection" description="Money received per day in the period">
        {data.byDay.some((d) => d.value > 0) ? (
          <TrendChart data={data.byDay} series={[{ key: "value", label: "Collected", color: "#10b981", type: "area" }]} money height={240} />
        ) : (
          <EmptyState title="No collection in this period" />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By method" description="Cash, mobile banking, bank...">
          {data.byMethod.length ? (
            <>
              <DonutChart data={data.byMethod.map((m, i) => ({ ...m, color: PALETTE[i % PALETTE.length] }))} centerValue={formatCurrency(data.total)} centerLabel="collected" />
              <ChartLegend data={data.byMethod.map((m, i) => ({ ...m, color: PALETTE[i % PALETTE.length] }))} />
            </>
          ) : (
            <EmptyState title="No data" />
          )}
        </Panel>
        <Panel title="By account" description="Which wallet received the money">
          {data.byAccount.length ? (
            <BarChartView data={data.byAccount} series={[{ key: "value", label: "Collected" }]} stacked={false} horizontal money height={Math.max(220, data.byAccount.length * 32)} />
          ) : (
            <EmptyState title="No data" />
          )}
        </Panel>
      </div>

      <DataTableShell
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search customer, transaction..." actions={<ExportCsvButton rows={data.rows} columns={columns} filename="collection-report" label="Export" />} />}
        empty={<EmptyState title="No payments in this period" />}
      />
    </div>
  );
}

/* ================================================================== */
/* Due report                                                          */
/* ================================================================== */

type DueData = {
  rows: {
    id: string;
    customerId: string;
    customer: string;
    username: string;
    phone: string;
    area: string;
    package: string;
    total: number;
    paid: number;
    balance: number;
    dueDate: Date;
    daysOverdue: number;
  }[];
  total: number;
  count: number;
  aging: { label: string; value: number }[];
  byArea: { label: string; value: number }[];
  byPackage: { label: string; value: number }[];
  byCustomer: { label: string; value: number }[];
};

export function DueReport({ data }: { data: DueData }) {
  const columns: Column<DueData["rows"][number]>[] = [
    { key: "customer", header: "Customer", cell: (r) => <span className="truncate text-sm font-medium">{r.customer}</span>, exportValue: (r) => r.customer },
    { key: "phone", header: "Phone", hideBelow: "sm", cell: (r) => <span className="tnum text-xs">{r.phone}</span>, exportValue: (r) => r.phone },
    { key: "package", header: "Package", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.package}</span>, exportValue: (r) => r.package },
    { key: "area", header: "Area", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.area}</span>, exportValue: (r) => r.area },
    { key: "due", header: "Due date", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.dueDate)}</span>, exportValue: (r) => formatDate(r.dueDate) },
    { key: "balance", header: "Balance", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-red-600 dark:text-red-400">{formatCurrency(r.balance)}</span>, exportValue: (r) => r.balance },
    { key: "age", header: "Overdue", align: "right", cell: (r) => <Badge tone={r.daysOverdue > 30 ? "danger" : r.daysOverdue > 7 ? "warning" : "neutral"}>{r.daysOverdue}d</Badge>, exportValue: (r) => r.daysOverdue },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Outstanding" value={formatCurrency(data.total)} icon={Wallet} tone="danger" />
        <StatCard label="Open Invoices" value={formatNumber(data.count)} icon={FileSpreadsheet} tone="warning" />
        <StatCard label="Not Due Yet" value={formatCurrency(data.aging[0]?.value ?? 0)} icon={CalendarClock} tone="info" />
        <StatCard label="30+ Days" value={formatCurrency(data.aging[3]?.value ?? 0)} icon={Percent} tone="danger" />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Aging" description="How overdue the money is">
          <DonutChart data={data.aging.map((a, i) => ({ ...a, color: ["#10b981", "#f59e0b", "#f97316", "#ef4444"][i] }))} centerValue={formatCurrency(data.total)} centerLabel="due" />
          <ChartLegend data={data.aging.map((a, i) => ({ ...a, color: ["#10b981", "#f59e0b", "#f97316", "#ef4444"][i] }))} />
        </Panel>
        <Panel title="By area">
          <BarChartView data={data.byArea} series={[{ key: "value", label: "Due" }]} stacked={false} horizontal money height={Math.max(220, data.byArea.length * 28)} />
        </Panel>
        <Panel title="By package">
          <BarChartView data={data.byPackage} series={[{ key: "value", label: "Due" }]} stacked={false} horizontal money height={Math.max(220, data.byPackage.length * 28)} />
        </Panel>
      </div>

      <DataTableShell
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search customer, phone..." actions={<ExportCsvButton rows={data.rows} columns={columns} filename="due-report" label="Export" />} />}
        empty={<EmptyState icon={<CheckCircle2 />} title="Nothing outstanding" description="Every invoice in the system is settled." />}
      />
    </div>
  );
}

/* ================================================================== */
/* Expense report                                                      */
/* ================================================================== */

type ExpenseData = {
  total: number;
  count: number;
  byCategory: { label: string; value: number; count: number }[];
  byAccount: { label: string; value: number }[];
  byDay: { label: string; value: number }[];
};

export function ExpenseReport({ data }: { data: ExpenseData }) {
  const columns: Column<ExpenseData["byCategory"][number]>[] = [
    { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.label}</span>, exportValue: (r) => r.label },
    { key: "count", header: "Entries", align: "right", cell: (r) => <span className="tnum text-xs">{r.count}</span>, exportValue: (r) => r.count },
    { key: "value", header: "Amount", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.value)}</span>, exportValue: (r) => r.value },
    {
      key: "share",
      header: "Share",
      align: "right",
      hideBelow: "sm",
      cell: (r) => <span className="tnum text-xs text-fg-muted">{data.total ? Math.round((r.value / data.total) * 100) : 0}%</span>,
      exportValue: (r) => (data.total ? (r.value / data.total) * 100 : 0),
    },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Expense" value={formatCurrency(data.total)} icon={Wallet} tone="danger" />
        <StatCard label="Entries" value={formatNumber(data.count)} icon={FileSpreadsheet} tone="brand" />
        <StatCard label="Largest Category" value={data.byCategory[0]?.label ?? "—"} icon={TrendingUp} tone="warning" hint={formatCurrency(data.byCategory[0]?.value ?? 0)} />
        <StatCard label="Average Entry" value={formatCurrency(data.count ? data.total / data.count : 0)} icon={Gauge} tone="neutral" />
      </StatCardGrid>

      <Panel title="Daily spend" description="Expenses per day in the period">
        {data.byDay.some((d) => d.value > 0) ? (
          <TrendChart data={data.byDay} series={[{ key: "value", label: "Expense", color: "#f43f5e", type: "area" }]} money height={240} />
        ) : (
          <EmptyState title="No expenses in this period" />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By category">
          {data.byCategory.length ? (
            <>
              <DonutChart data={data.byCategory.map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }))} centerValue={formatCurrency(data.total)} centerLabel="expense" />
              <ChartLegend data={data.byCategory.map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }))} />
            </>
          ) : (
            <EmptyState title="No expenses" />
          )}
        </Panel>
        <Panel title="By account" description="Which wallet paid">
          {data.byAccount.length ? (
            <BarChartView data={data.byAccount} series={[{ key: "value", label: "Expense" }]} stacked={false} horizontal money height={Math.max(220, data.byAccount.length * 32)} />
          ) : (
            <EmptyState title="No data" />
          )}
        </Panel>
      </div>

      <DataTableShell
        columns={columns}
        rows={data.byCategory}
        rowKey={(r) => r.label}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search category..." actions={<ExportCsvButton rows={data.byCategory} columns={columns} filename="expense-report" label="Export" />} />}
        empty={<EmptyState title="No expenses" />}
      />
    </div>
  );
}

/* ================================================================== */
/* Profit & loss                                                       */
/* ================================================================== */

type PnlData = {
  income: number;
  cost: number;
  profit: number;
  margin: number;
  transactionCount: number;
  expenseCount: number;
  monthly: { label: string; Income: number; Expense: number; Profit: number }[];
};

export function ProfitAndLoss({ data }: { data: PnlData }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Total Revenue</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(data.income)}
            </p>
            <p className="mt-1 text-xs text-fg-muted">{formatNumber(data.transactionCount)} payments</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Total Expense</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(data.cost)}
            </p>
            <p className="mt-1 text-xs text-fg-muted">{formatNumber(data.expenseCount)} expenses</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Net Profit</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                data.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(data.profit)}
            </p>
            <p className="mt-1 text-xs text-fg-muted">Margin {data.margin.toFixed(1)}%</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="space-y-1.5 py-6">
          <div className="mx-auto max-w-sm space-y-3 text-center">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Total Revenue</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(data.income)}</p>
            <p className="text-fg-subtle">−</p>
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Total Expense</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(data.cost)}</p>
            <p className="text-fg-subtle">=</p>
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Net Profit</p>
            <p
              className={`text-3xl font-bold tabular-nums ${
                data.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(data.profit)}
            </p>
          </div>
        </CardBody>
      </Card>

      <Panel title="Monthly income vs expense" description="Where the margin is won and lost">
        {data.monthly.length ? (
          <BarChartView
            data={data.monthly}
            series={[
              { key: "Income", label: "Income", color: "#10b981" },
              { key: "Expense", label: "Expense", color: "#f43f5e" },
            ]}
            money
            height={260}
          />
        ) : (
          <EmptyState title="No data in this period" />
        )}
      </Panel>
    </div>
  );
}

/* ================================================================== */
/* Network report                                                      */
/* ================================================================== */

type NetworkData = {
  routers: {
    id: string;
    name: string;
    model: string | null;
    ipAddress: string;
    status: string;
    cpu: number | null;
    ram: number | null;
    uptimeSec: number | null;
    activeUsers: number;
    lastSyncAt: Date | null;
  }[];
  olts: { id: string; name: string; vendor: string | null; status: string; ponPorts: number; online: number; offline: number; lowSignal: number }[];
  onus: { label: string; value: number }[];
  rxBuckets: { label: string; value: number }[];
  online: number;
  sessions: number;
  download: number;
  upload: number;
  byPackage: { label: string; value: number }[];
};

export function NetworkReport({ data }: { data: NetworkData }) {
  const routerColumns: Column<NetworkData["routers"][number]>[] = [
    { key: "name", header: "Router", cell: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: "model", header: "Model", hideBelow: "sm", cell: (r) => <span className="text-xs text-fg-muted">{r.model ?? "—"}</span>, exportValue: (r) => r.model ?? "" },
    { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs">{r.ipAddress}</span>, exportValue: (r) => r.ipAddress },
    { key: "users", header: "Sessions", align: "right", cell: (r) => <span className="tnum text-xs">{r.activeUsers}</span>, exportValue: (r) => r.activeUsers },
    { key: "cpu", header: "CPU", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs">{r.cpu == null ? "—" : `${r.cpu.toFixed(1)}%`}</span>, exportValue: (r) => r.cpu ?? 0 },
    { key: "ram", header: "RAM", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs">{r.ram == null ? "—" : `${r.ram.toFixed(1)}%`}</span>, exportValue: (r) => r.ram ?? 0 },
    { key: "uptime", header: "Uptime", align: "right", hideBelow: "xl", cell: (r) => <span className="tnum text-xs">{formatUptime(r.uptimeSec)}</span>, exportValue: (r) => formatUptime(r.uptimeSec) },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  const oltColumns: Column<NetworkData["olts"][number]>[] = [
    { key: "name", header: "OLT", cell: (o) => <span className="font-medium">{o.name}</span>, exportValue: (o) => o.name },
    { key: "vendor", header: "Vendor", hideBelow: "sm", cell: (o) => <span className="text-xs text-fg-muted">{o.vendor ?? "—"}</span>, exportValue: (o) => o.vendor ?? "" },
    { key: "pon", header: "PON Ports", align: "right", cell: (o) => <span className="tnum text-xs">{o.ponPorts}</span>, exportValue: (o) => o.ponPorts },
    { key: "online", header: "Online ONU", align: "right", cell: (o) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{o.online}</span>, exportValue: (o) => o.online },
    { key: "offline", header: "Offline", align: "right", hideBelow: "md", cell: (o) => <span className="tnum text-xs text-red-600 dark:text-red-400">{o.offline}</span>, exportValue: (o) => o.offline },
    { key: "low", header: "Low Signal", align: "right", hideBelow: "lg", cell: (o) => <span className="tnum text-xs text-amber-600 dark:text-amber-400">{o.lowSignal}</span>, exportValue: (o) => o.lowSignal },
    { key: "status", header: "Status", align: "right", cell: (o) => <StatusBadge status={o.status} />, exportValue: (o) => o.status },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Online Customers" value={formatNumber(data.online)} icon={Users} tone="success" />
        <StatCard label="Routers" value={formatNumber(data.routers.length)} icon={Gauge} tone="brand" />
        <StatCard label="OLTs" value={formatNumber(data.olts.length)} icon={Zap} tone="info" />
        <StatCard label="Total Traffic" value={formatBytes(data.download + data.upload)} icon={TrendingUp} tone="warning" hint={`${formatNumber(data.sessions)} sessions`} />
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="ONU status" description="Registration state across the fleet">
          <DonutChart data={data.onus.map((o, i) => ({ ...o, color: ["#10b981", "#f43f5e", "#f59e0b"][i % 3] }))} />
          <ChartLegend data={data.onus.map((o, i) => ({ ...o, color: ["#10b981", "#f43f5e", "#f59e0b"][i % 3] }))} />
        </Panel>
        <Panel title="Optical signal quality" description="RX power distribution — below -28 dBm needs attention">
          <BarChartView data={data.rxBuckets} series={[{ key: "value", label: "ONUs" }]} stacked={false} horizontal height={Math.max(200, data.rxBuckets.length * 34)} />
        </Panel>
      </div>

      <Panel title="Online users by package" description="Where the live sessions are">
        {data.byPackage.length ? (
          <BarChartView data={data.byPackage} series={[{ key: "value", label: "Online" }]} stacked={false} horizontal height={Math.max(200, data.byPackage.length * 30)} />
        ) : (
          <EmptyState title="Nobody is online" />
        )}
      </Panel>

      <DataTableShell
        columns={routerColumns}
        rows={data.routers}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search router..." actions={<ExportCsvButton rows={data.routers} columns={routerColumns} filename="router-report" label="Export" />} />}
        empty={<EmptyState title="No routers configured" />}
      />

      <DataTableShell
        columns={oltColumns}
        rows={data.olts}
        rowKey={(o) => o.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search OLT..." actions={<ExportCsvButton rows={data.olts} columns={oltColumns} filename="olt-report" label="Export" />} />}
        empty={<EmptyState title="No OLTs configured" />}
      />
    </div>
  );
}

/* ================================================================== */
/* Attendance report                                                   */
/* ================================================================== */

type AttendanceReportData = {
  total: number;
  byStatus: { label: string; value: number }[];
  byEmployee: { label: string; value: number }[];
  byDay: { label: string; value: number }[];
};

export function AttendanceReport({ data }: { data: AttendanceReportData }) {
  const rate = data.total ? Math.round(((data.byStatus.find((s) => s.label === "Present")?.value ?? 0) / data.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Records" value={formatNumber(data.total)} icon={CalendarClock} tone="brand" />
        <StatCard label="Present" value={formatNumber(data.byStatus.find((s) => s.label === "Present")?.value ?? 0)} icon={CheckCircle2} tone="success" />
        <StatCard label="Absent" value={formatNumber(data.byStatus.find((s) => s.label === "Absent")?.value ?? 0)} icon={Users} tone="danger" />
        <StatCard label="Attendance Rate" value={`${rate}%`} icon={Percent} tone={rate >= 85 ? "success" : "warning"} />
      </StatCardGrid>

      <Panel title="Attendance over time" description="Present + late per day">
        {data.byDay.length ? (
          <TrendChart data={data.byDay} series={[{ key: "value", label: "Present", color: "#10b981", type: "area" }]} height={240} />
        ) : (
          <EmptyState title="No attendance in this period" />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By status">
          <DonutChart data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))} />
          <ChartLegend data={data.byStatus.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))} />
        </Panel>
        <Panel title="By employee" description="Most records in the period">
          <BarChartView data={data.byEmployee} series={[{ key: "value", label: "Records" }]} stacked={false} horizontal height={Math.max(220, data.byEmployee.length * 30)} />
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== */
/* BTRC subscriber report                                              */
/* ================================================================== */

type BtrcData = {
  month: string | null;
  label: string;
  rows: {
    packageId: string | null;
    areaId: string | null;
    package: string;
    area: string;
    active: number;
    suspended: number;
    disconnected: number;
    total: number;
    newConnections: number;
    churn: number;
  }[];
  totals: {
    active: number;
    suspended: number;
    disconnected: number;
    total: number;
    newConnections: number;
    churn: number;
    netChange: number;
  };
};

/** Month picker bound to `?month=YYYY-MM`, which is what the export reads too. */
export function BtrcMonthFilter({ month }: { month: string }) {
  const { setParams } = useTableQuery();
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs text-fg-subtle">Month</span>
      <input
        type="month"
        aria-label="Report month"
        value={month}
        onChange={(e) => setParams({ month: e.target.value || null })}
        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}

export function BtrcReport({ data }: { data: BtrcData }) {
  const { setParams, searchParams } = useTableQuery();
  // The export is a real download from the permission-checked endpoint rather
  // than a client-side blob, so the file a user saves is byte-identical to the
  // one the server builds and it inherits the same permission check.
  const exportHref = `/api/reports/btrc?month=${encodeURIComponent(data.month ?? "")}`;
  const monthParam = searchParams.get("month");

  const columns: Column<BtrcData["rows"][number]>[] = [
    { key: "package", header: "Package", cell: (r) => <span className="font-medium">{r.package}</span>, exportValue: (r) => r.package },
    { key: "area", header: "Area", cell: (r) => <span className="text-xs text-fg-muted">{r.area}</span>, exportValue: (r) => r.area },
    { key: "active", header: "Active", align: "right", cell: (r) => <span className="tnum text-xs">{r.active}</span>, exportValue: (r) => r.active },
    { key: "suspended", header: "Suspended", align: "right", cell: (r) => <span className="tnum text-xs">{r.suspended}</span>, exportValue: (r) => r.suspended },
    { key: "disconnected", header: "Disconnected", align: "right", cell: (r) => <span className="tnum text-xs text-fg-muted">{r.disconnected}</span>, exportValue: (r) => r.disconnected },
    { key: "total", header: "Total", align: "right", cell: (r) => <span className="tnum text-xs font-semibold">{r.total}</span>, exportValue: (r) => r.total },
    { key: "new", header: "New", align: "right", hideBelow: "sm", cell: (r) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{r.newConnections}</span>, exportValue: (r) => r.newConnections },
    { key: "churn", header: "Churn", align: "right", hideBelow: "sm", cell: (r) => <span className="tnum text-xs text-red-600 dark:text-red-400">{r.churn}</span>, exportValue: (r) => r.churn },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <BtrcMonthFilter month={monthParam ?? data.month ?? ""} />
        <a
          href={exportHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)]"
        >
          <FileSpreadsheet className="size-4" /> Export CSV
        </a>
      </div>

      <StatCardGrid>
        <StatCard label="Total Subscribers" value={formatNumber(data.totals.total)} icon={Users} tone="brand" />
        <StatCard label="Active" value={formatNumber(data.totals.active)} icon={CheckCircle2} tone="success" />
        <StatCard label="Suspended" value={formatNumber(data.totals.suspended)} icon={CalendarClock} tone="warning" />
        <StatCard label="Disconnected" value={formatNumber(data.totals.disconnected)} icon={ArrowRight} tone="neutral" />
        <StatCard label="New Connections" value={formatNumber(data.totals.newConnections)} icon={TrendingUp} tone="info" hint={data.label || "no month selected"} />
        <StatCard
          label="Churn"
          value={formatNumber(data.totals.churn)}
          icon={Percent}
          tone="danger"
          hint={`Net ${data.totals.netChange >= 0 ? "+" : ""}${data.totals.netChange}`}
        />
      </StatCardGrid>

      <DataTableShell
        columns={columns}
        rows={data.rows}
        rowKey={(r) => `${r.packageId ?? "none"}:${r.areaId ?? "none"}`}
        compact
        toolbar={
          <TableToolbar
            searchPlaceholder="Search package, area..."
            actions={
              <button
                onClick={() => setParams({ month: null })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)]"
              >
                Clear month
              </button>
            }
          />
        }
        empty={<EmptyState title="No subscriber data" description="Pick a month to build the return." />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Corporate clients (ISP.md §33)                                       */
/* ------------------------------------------------------------------ */

export type CorporateData = {
  rows: {
    id: string;
    customerCode: string;
    name: string;
    username: string;
    customerType: string;
    companyName: string | null;
    contactPerson: string | null;
    contactPhone: string | null;
    tradeLicenseNo: string | null;
    cirMbps: number | null;
    mirMbps: number | null;
    headroomMbps: number | null;
    slaHours: number | null;
    billingLabel: string | null;
    ipAddress: string | null;
    ipType: string | null;
    connectionStatus: string;
    previousDue: number;
    monthlyBill: number;
    package: { name: string; downloadSpeed: number; uploadSpeed: number } | null;
    area: { name: string } | null;
    router: { name: string } | null;
  }[];
  metrics: {
    clients: number;
    totalReceivables: number;
    totalMonthly: number;
    missingCompany: number;
    withCir: number;
    /** Always null until Phase U exists; the column says so rather than guessing. */
    slaCompliance: number | null;
    slaComplianceNote: string;
  };
};

/**
 * Every corporate and dedicated client, with what they were sold and what they owe.
 *
 * The SLA column reads "pending Phase U" rather than a percentage. There is no
 * resolution data to compute one from, and a compliance figure derived from
 * whatever happens to be available would be a number in front of an operator that
 * means nothing — worse than the admission that it is not measured yet.
 */
export function CorporateReport({ data }: { data: CorporateData }) {
  const columns: Column<CorporateData["rows"][number]>[] = [
    {
      key: "company",
      header: "Company",
      cell: (r) => (
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{r.companyName ?? "—"}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{r.name}</span>
        </span>
      ),
      exportValue: (r) => r.companyName ?? r.name,
    },
    { key: "type", header: "Type", cell: (r) => <Badge>{r.customerType}</Badge>, exportValue: (r) => r.customerType },
    {
      key: "cir",
      header: "CIR / MIR",
      align: "right",
      cell: (r) => (
        <span className="tnum whitespace-nowrap text-xs">
          {r.cirMbps ?? "—"} / {r.mirMbps ?? "—"}
          {r.headroomMbps != null ? (
            <span className="ml-1 text-[11px] text-fg-subtle">(+{r.headroomMbps})</span>
          ) : null}
        </span>
      ),
      exportValue: (r) => `${r.cirMbps ?? ""} / ${r.mirMbps ?? ""}`,
    },
    {
      key: "ip",
      header: "IP",
      hideBelow: "md",
      cell: (r) => (
        <span className="font-mono text-[11px] text-fg-muted">{r.ipAddress ?? `${r.ipType ?? "—"}`}</span>
      ),
      exportValue: (r) => r.ipAddress ?? r.ipType ?? "",
    },
    { key: "sla", header: "SLA", align: "right", cell: (r) => <span className="tnum text-xs">{r.slaHours ? `${r.slaHours}h` : "—"}</span>, exportValue: (r) => (r.slaHours ? `${r.slaHours}h` : "") },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.connectionStatus} />,
      exportValue: (r) => r.connectionStatus,
    },
    {
      key: "due",
      header: "Receivables",
      align: "right",
      cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.previousDue)}</span>,
      exportValue: (r) => r.previousDue,
    },
    {
      key: "slaCompliance",
      header: "SLA compliance",
      align: "right",
      hideBelow: "lg",
      // Said plainly rather than showing a percentage that means nothing.
      cell: () => <span className="text-[11px] text-fg-subtle">pending Phase U</span>,
      exportValue: () => "pending Phase U",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Corporate clients" value={formatNumber(data.metrics.clients)} tone="brand" />
        <StatCard label="Receivables" value={formatCurrency(data.metrics.totalReceivables)} tone="warning" />
        <StatCard label="Monthly contract value" value={formatCurrency(data.metrics.totalMonthly)} tone="info" />
        <StatCard
          label="With a CIR"
          value={formatNumber(data.metrics.withCir)}
          tone="neutral"
          hint={data.metrics.missingCompany > 0 ? `${data.metrics.missingCompany} missing a company name` : undefined}
        />
      </div>

      <DataTableShell
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search company, contact, code..." actions={<ExportCsvButton columns={columns} rows={data.rows} filename="corporate-clients" />} />}
        empty={
          <EmptyState
            title="No corporate clients"
            description="A customer with a type of Corporate or Dedicated appears here with their CIR, MIR and SLA."
          />
        }
      />
    </div>
  );
}

export type CorporateCollectionData = {
  rows: {
    id: string;
    customerCode: string;
    name: string;
    companyName: string | null;
    customerType: string;
    cirMbps: number | null;
    mirMbps: number | null;
    previousDue: number;
    collected: number;
    billingStatus: string;
  }[];
  metrics: {
    clients: number;
    totalReceivables: number;
    totalCollected: number;
    debtors: number;
  };
};

/**
 * Receivables by corporate client.
 *
 * Separate from the customer list because the questions differ: one is "who are
 * our corporate clients and what are they sold?", the other is "who owes us
 * money?". A corporate debtor is a collections conversation, not a support one.
 */
export function CorporateCollectionReport({ data }: { data: CorporateCollectionData }) {
  const columns: Column<CorporateCollectionData["rows"][number]>[] = [
    {
      key: "company",
      header: "Company",
      cell: (r) => (
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{r.companyName ?? "—"}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{r.name}</span>
        </span>
      ),
      exportValue: (r) => r.companyName ?? r.name,
    },
    { key: "code", header: "Code", hideBelow: "md", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.customerCode}</span>, exportValue: (r) => r.customerCode },
    {
      key: "cir",
      header: "CIR / MIR",
      align: "right",
      cell: (r) => <span className="tnum whitespace-nowrap text-xs">{r.cirMbps ?? "—"} / {r.mirMbps ?? "—"}</span>,
      exportValue: (r) => `${r.cirMbps ?? ""} / ${r.mirMbps ?? ""}`,
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.billingStatus} />, exportValue: (r) => r.billingStatus },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      cell: (r) => <span className="tnum text-xs">{formatCurrency(r.collected)}</span>,
      exportValue: (r) => r.collected,
    },
    {
      key: "due",
      header: "Receivables",
      align: "right",
      cell: (r) => <span className="tnum text-xs font-semibold">{formatCurrency(r.previousDue)}</span>,
      exportValue: (r) => r.previousDue,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Corporate clients" value={formatNumber(data.metrics.clients)} tone="brand" />
        <StatCard label="Receivables" value={formatCurrency(data.metrics.totalReceivables)} tone="warning" />
        <StatCard label="Collected in range" value={formatCurrency(data.metrics.totalCollected)} tone="success" />
        <StatCard label="In arrears" value={formatNumber(data.metrics.debtors)} tone={data.metrics.debtors ? "danger" : "neutral"} />
      </div>

      <DataTableShell
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search company, code..." actions={<ExportCsvButton columns={columns} rows={data.rows} filename="corporate-receivables" />} />}
        empty={<EmptyState title="Nothing owed" description="No corporate client has a balance on the account." />}
      />
    </div>
  );
}
