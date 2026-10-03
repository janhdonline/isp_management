"use client";

import Link from "next/link";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/ui/date-range";
import { BarChartView, DonutChart, ChartLegend, TrendChart } from "@/components/ui/charts";
import { DataTableShell, TableToolbar, ExportCsvButton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatNumber, formatDate, relativeTime, daysUntil } from "@/lib/utils";
import {
  Activity, AlertTriangle, ArrowRight, Banknote, CalendarClock, CircleDollarSign,
  FilePlus2, Package, RefreshCcw, TrendingUp, Ticket, UserPlus, Users, Wallet,
  Wifi, WifiOff, PauseCircle, ShieldAlert,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/providers";

export type DashStats = {
  cards: Record<string, number>;
  invoice: Record<string, unknown>;
  payment: { today: number; todayCount: number; month: number; monthCount: number };
  finance: { revenue: number; expense: number; profit: number; margin: number };
  alerts: { expiringToday: number; expiringWeek: number };
  recentPayments: {
    id: string; paymentId: string; amount: number; method: string; paymentDate: Date;
    customer: { id: string; name: string; customerCode: string };
    account: { name: string; type: string };
    invoice: { invoiceNumber: string } | null;
  }[];
  onlineUsers: {
    id: string; username: string; name: string; ipAddress: string | null;
    loginTime: Date | null; downloadBytes: number; uploadBytes: number;
    package: { name: string; downloadSpeed: number } | null;
  }[];
  expiring: {
    id: string; name: string; customerCode: string; username: string;
    expiryDate: Date | null; previousDue: number; connectionStatus: string;
    package: { name: string } | null;
  }[];
};

export type DashCharts = {
  collection: { label: string; value: number }[];
  growth: { label: string; New: number; Disconnected: number; Reconnected: number }[];
  statusChart: { label: string; value: number; color?: string }[];
  packageChart: { label: string; value: number; color?: string }[];
};

const QUICK_ACTIONS = [
  { label: "New Customer", href: "/customers/new", icon: UserPlus },
  { label: "Collect Payment", href: "/billing/payments/new", icon: Banknote },
  { label: "Create Invoice", href: "/billing/invoices/new", icon: FilePlus2 },
  { label: "Add Package", href: "/packages/new", icon: Package },
  { label: "New Ticket", href: "/support/tickets", icon: Ticket },
  { label: "Add Expense", href: "/expenses/new", icon: Wallet },
];

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-pine-700 dark:text-fg-muted">{children}</h2>;
}

/** A serial the OLT is serving that nobody is billing for (Phase N). */
export type RogueEntry = {
  id: string;
  serialNo: string;
  ponIndex: string | null;
  rxPower: number | null;
  oltName: string;
  lastSeenAt: string;
  notified: boolean;
};

export function DashboardView({
  stats,
  charts,
  range,
  from,
  to,
  rogues = [],
  rogueCount = 0,
}: {
  stats: DashStats;
  charts: DashCharts;
  range: string;
  from?: string;
  to?: string;
  rogues?: RogueEntry[];
  rogueCount?: number;
}) {
  const c = stats.cards;
  const [rangeValue, setRangeValue] = useState(range);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { success } = useToast();

  const onRange = (v: string) => {
    setRangeValue(v);
    startTransition(() =>
      router.push(
        v === "custom"
          ? `/dashboard?range=custom${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`
          : `/dashboard?range=${v}`
      )
    );
  };

  const paymentColumns: Column<DashStats["recentPayments"][number]>[] = [
    {
      key: "invoice",
      header: "Invoice",
      cell: (r) =>
        r.invoice ? (
          <Link href={`/billing/invoices/${r.invoice.invoiceNumber}`} className="font-mono text-xs hover:text-gold-700">
            {r.invoice.invoiceNumber}
          </Link>
        ) : (
          <span className="font-mono text-xs text-fg-subtle">Unlinked</span>
        ),
      exportValue: (r) => r.invoice?.invoiceNumber ?? "",
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <Link href={`/customers/${r.customer.id}`} className="font-medium hover:text-gold-700">
          {r.customer.name}
        </Link>
      ),
      exportValue: (r) => r.customer.name,
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="tnum font-medium">{formatCurrency(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: "method", header: "Method", cell: (r) => <Badge>{r.method}</Badge>, exportValue: (r) => r.method },
    { key: "account", header: "Account", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.account.name}</span>, exportValue: (r) => r.account.name },
    { key: "date", header: "Date", align: "right", cell: (r) => <span className="text-xs text-fg-muted">{formatDate(r.paymentDate)}</span>, exportValue: (r) => formatDate(r.paymentDate) },
  ];

  const onlineColumns: Column<DashStats["onlineUsers"][number]>[] = [
    { key: "username", header: "Username", cell: (r) => <span className="font-mono text-xs font-medium">{r.username}</span>, exportValue: (r) => r.username },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <Link href={`/customers/${r.id}`} className="hover:text-gold-700">
          {r.name}
        </Link>
      ),
      exportValue: (r) => r.name,
    },
    { key: "ip", header: "IP", hideBelow: "sm", cell: (r) => <span className="font-mono text-xs text-fg-muted">{r.ipAddress ?? "—"}</span>, exportValue: (r) => r.ipAddress ?? "" },
    { key: "package", header: "Package", hideBelow: "md", cell: (r) => <span className="text-xs">{r.package?.name ?? "—"}</span>, exportValue: (r) => r.package?.name ?? "" },
    { key: "download", header: "Download", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs">{formatNumber(r.downloadBytes)}</span>, exportValue: (r) => r.downloadBytes },
    { key: "upload", header: "Upload", align: "right", hideBelow: "xl", cell: (r) => <span className="tnum text-xs">{formatNumber(r.uploadBytes)}</span>, exportValue: (r) => r.uploadBytes },
    { key: "uptime", header: "Uptime", align: "right", cell: (r) => <span className="text-xs text-fg-muted">{relativeTime(r.loginTime)}</span>, exportValue: (r) => relativeTime(r.loginTime) },
  ];

  const expiringColumns: Column<DashStats["expiring"][number]>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/customers/${r.id}`} className="block truncate font-medium hover:text-gold-700">
            {r.name}
          </Link>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.username}</span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "package", header: "Package", hideBelow: "md", cell: (r) => <span className="text-xs">{r.package?.name ?? "—"}</span>, exportValue: (r) => r.package?.name ?? "" },
    { key: "expiry", header: "Expiry", cell: (r) => <span className="text-xs">{formatDate(r.expiryDate)}</span>, exportValue: (r) => formatDate(r.expiryDate) },
    {
      key: "days",
      header: "Remaining",
      align: "right",
      cell: (r) => {
        const d = daysUntil(r.expiryDate);
        return d === null ? "—" : <Badge tone={d <= 1 ? "danger" : d <= 3 ? "warning" : "neutral"}>{d}d</Badge>;
      },
      exportValue: (r) => daysUntil(r.expiryDate) ?? "",
    },
    { key: "due", header: "Due", align: "right", cell: (r) => <span className={`tnum text-xs font-medium ${r.previousDue > 0 ? "text-red-600 dark:text-red-400" : "text-fg-muted"}`}>{formatCurrency(r.previousDue)}</span>, exportValue: (r) => r.previousDue },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (r) => (
        <Link href={`/billing/payments/new?customerId=${r.id}`} className="text-xs font-medium text-gold-700 font-medium hover:underline">
          Renew
        </Link>
      ),
    },
  ];

  const hasCollection = charts.collection.some((p) => p.value > 0);
  const hasGrowth = charts.growth.some((p) => p.New || p.Disconnected || p.Reconnected);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Live view of customers, collection, network and alerts.</p>
        </div>
        <button
          onClick={() => {
            startTransition(() => router.refresh());
            success("Dashboard refreshed", "Reloaded the latest figures.");
          }}
          disabled={isPending}
          className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium shadow-sm transition-all hover:shadow disabled:opacity-60"
        >
          <RefreshCcw className={isPending ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </button>
      </div>

      {/* quick actions */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gold-400 hover:shadow-md dark:hover:border-gold-500"
          >
            <a.icon className="size-4 shrink-0 text-gold-700" />
            <span className="truncate">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* customers */}
      <section className="space-y-2 animate-rise" style={{ animationDelay: "0ms" }}>
        <GroupLabel>Customers</GroupLabel>
        <StatCardGrid>
          <StatCard label="Total Customers" value={formatNumber(c.totalCustomers)} icon={Users} tone="gold" href="/customers" hint="All records" />
          <StatCard label="Active Customers" value={formatNumber(c.activeCustomers)} icon={CircleDollarSign} tone="success" href="/customers/status/active" hint="Connection active" />
          <StatCard label="Online Now" value={formatNumber(c.onlineNow)} icon={Wifi} tone="info" href="/customers/online" hint="Live sessions" />
          <StatCard label="Offline" value={formatNumber(c.offline)} icon={WifiOff} tone="neutral" href="/customers/offline" hint="Not connected" />
        </StatCardGrid>
      </section>

      {/* finance */}
      <section className="space-y-2 animate-rise" style={{ animationDelay: "60ms" }}>
        <GroupLabel>Finance</GroupLabel>
        <StatCardGrid>
          <StatCard label="Today's Collection" value={formatCurrency(c.todayCollection)} icon={Banknote} tone="success" href="/billing/payments" hint={`${stats.payment.todayCount} transactions`} />
          <StatCard label="Monthly Collection" value={formatCurrency(c.monthlyCollection)} icon={TrendingUp} tone="gold" hint={`${stats.payment.monthCount} transactions`} />
          <StatCard label="Total Due" value={formatCurrency(c.totalDue)} icon={AlertTriangle} tone="danger" href="/customers/due" hint="Across all customers" />
          <StatCard label="Monthly Expense" value={formatCurrency(c.monthlyExpense)} icon={Wallet} tone="warning" href="/expenses" hint={`Net ${formatCurrency(stats.finance.profit)}`} />
        </StatCardGrid>
      </section>

      {/* alerts */}
      <section className="space-y-2 animate-rise" style={{ animationDelay: "120ms" }}>
        <GroupLabel>Alerts</GroupLabel>
        <StatCardGrid>
          <StatCard label="Expiring Today" value={formatNumber(stats.alerts.expiringToday)} icon={CalendarClock} tone="warning" href="/customers/expiring" hint={`${stats.alerts.expiringWeek} within 7 days`} />
          <StatCard label="Expired" value={formatNumber(c.expired)} icon={AlertTriangle} tone="danger" href="/customers/status/expired" hint="Past expiry date" />
          <StatCard label="Suspended" value={formatNumber(c.suspended)} icon={PauseCircle} tone="warning" href="/customers/status/suspended" hint="Awaiting payment" />
          <StatCard label="Open Tickets" value={formatNumber(c.openTickets)} icon={Ticket} tone="info" href="/support/tickets" hint="Open, pending, in progress" />
          <StatCard
            label="Unregistered ONUs"
            value={formatNumber(rogueCount)}
            icon={ShieldAlert}
            tone={rogueCount > 0 ? "danger" : "success"}
            href="/network/olt"
            hint={
              rogueCount > 0
                ? "Seen on an OLT, in no customer record"
                : "Every ONU on every cabinet is ours"
            }
          />
        </StatCardGrid>
      </section>

      {rogues.length > 0 ? (
        <section className="space-y-2 animate-rise" style={{ animationDelay: "160ms" }}>
          <GroupLabel>Unregistered ONUs</GroupLabel>
          <ul className="space-y-1">
            {rogues.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs">{r.serialNo}</span>
                <span className="text-fg-muted">{r.oltName}</span>
                {r.ponIndex ? (
                  <span className="text-xs text-fg-subtle">PON {r.ponIndex}</span>
                ) : null}
                {r.rxPower != null ? (
                  <span className="tnum text-xs text-fg-subtle">rx {r.rxPower.toFixed(1)} dBm</span>
                ) : null}
                <span className="ml-auto text-xs text-fg-subtle">
                  {r.notified ? "alert sent" : "not alerted"} · last seen{" "}
                  {new Date(r.lastSeenAt).toISOString().replace("T", " ").slice(0, 16)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">
            These are connected and carrying traffic, but they are in nobody&apos;s account.
            Link one to a customer and the next sync adopts it; nobody does and the OLT
            is the one place the ISP learns about it.
          </p>
        </section>
      ) : null}

      {/* charts */}
      <section className="space-y-2 animate-rise" style={{ animationDelay: "180ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GroupLabel>Analytics</GroupLabel>
          <DateRangePicker className="no-print" defaultPreset={range} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Collection Overview"
              description="Money received in the selected period"
              icon={<TrendingUp />}
              action={
                <div className="flex gap-1">
                  {[
                    ["today", "Today"],
                    ["week", "Week"],
                    ["month", "Month"],
                    ["year", "Year"],
                  ].map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => onRange(v)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                        rangeValue === v && v !== "custom"
                          ? "bg-gold-500 text-pine-950 shadow-sm"
                          : "text-fg-muted hover:text-[var(--fg)]"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody className="pb-2">
              {hasCollection ? (
                <TrendChart data={charts.collection} series={[{ key: "value", label: "Collected", color: "#c9973b", type: "area" }]} money />
              ) : (
                <EmptyState title="No collection in this period" description="Payments recorded in the selected range will appear here." />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer Status" description="Connection status distribution" icon={<Activity />} />
            <CardBody>
              <DonutChart
                data={charts.statusChart}
                centerValue={formatNumber(charts.statusChart.reduce((s, x) => s + x.value, 0))}
                centerLabel="customers"
              />
              <ChartLegend data={charts.statusChart} />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Customer Growth" description="New vs disconnected vs reconnected (last 30 days)" icon={<TrendingUp />} />
            <CardBody>
              {hasGrowth ? (
                <TrendChart
                  data={charts.growth}
                  series={[
                    { key: "New", label: "New", color: "#3b665f" },
                    { key: "Disconnected", label: "Disconnected", color: "#f43f5e" },
                    { key: "Reconnected", label: "Reconnected", color: "#c9973b" },
                  ]}
                  height={240}
                />
              ) : (
                <EmptyState title="No movement yet" description="Customer additions and removals will show up here." />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Package Distribution" description="Customers by package" icon={<Package />} action={<Link href="/packages" className="text-xs font-medium text-gold-700 font-medium hover:underline">Manage</Link>} />
            <CardBody>
              {charts.packageChart.length === 0 ? (
                <EmptyState title="No packages assigned" description="Assign packages to customers to see the distribution." />
              ) : (
                <BarChartView
                  data={charts.packageChart}
                  series={[{ key: "value", label: "Customers" }]}
                  stacked={false}
                  horizontal
                  height={Math.max(200, charts.packageChart.length * 30)}
                />
              )}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* tables */}
      <section className="space-y-2 animate-rise" style={{ animationDelay: "240ms" }}>
        <GroupLabel>Attention needed</GroupLabel>
        <DataTableShell
          columns={expiringColumns}
          rows={stats.expiring}
          rowKey={(r) => r.id}
          compact
          toolbar={
            <TableToolbar
              searchPlaceholder="Search expiring customers..."
              actions={
                <>
                  <ExportCsvButton rows={stats.expiring} columns={expiringColumns} filename="expiring" label="Export" />
                  <Link href="/customers/expiring" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-gold-700 hover:bg-gold-100 dark:text-gold-400 dark:hover:bg-gold-500/10">
                    View all <ArrowRight className="size-3.5" />
                  </Link>
                </>
              }
            />
          }
          empty={<EmptyState icon={<CalendarClock />} title="Nobody is expiring" description="Customers whose subscription ends within 3 days will show up here." />}
        />
      </section>

      <section className="space-y-2 animate-rise" style={{ animationDelay: "300ms" }}>
        <GroupLabel>Live data</GroupLabel>

        <DataTableShell
          columns={onlineColumns}
          rows={stats.onlineUsers}
          rowKey={(r) => r.id}
          compact
          toolbar={
            <TableToolbar
              searchPlaceholder="Search online users..."
              actions={
                <Link href="/customers/online" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-gold-700 hover:bg-gold-100 dark:text-gold-400 dark:hover:bg-gold-500/10">
                  View all <ArrowRight className="size-3.5" />
                </Link>
              }
              right={<Badge tone="success"><span className="size-1.5 rounded-full bg-current" />{stats.onlineUsers.length} live</Badge>}
            />
          }
          empty={<EmptyState icon={<WifiOff />} title="No users online" description="Live PPPoE sessions will appear here in real time." />}
        />

        <DataTableShell
          columns={paymentColumns}
          rows={stats.recentPayments}
          rowKey={(r) => r.id}
          compact
          toolbar={
            <TableToolbar
              searchPlaceholder="Search payments..."
              actions={
                <>
                  <ExportCsvButton rows={stats.recentPayments} columns={paymentColumns} filename="recent-payments" />
                  <Link href="/billing/payments" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-gold-700 hover:bg-gold-100 dark:text-gold-400 dark:hover:bg-gold-500/10">
                    View all <ArrowRight className="size-3.5" />
                  </Link>
                </>
              }
            />
          }
          empty={<EmptyState icon={<Banknote />} title="No payments yet" description="Collected payments will be listed here." />}
        />
      </section>
    </div>
  );
}
