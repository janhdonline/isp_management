import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listCustomers, listDue, listExpiring, customerStatusMetrics } from "@/lib/services/customers";
import { listOnline, listOffline } from "@/lib/services/network";
import { parseListParams } from "@/lib/query";
import { getAreasSimple } from "@/lib/services/areas";
import { getAllPackages } from "@/lib/services/packages";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { CustomerListPage, type CustomerView, type Row } from "@/components/customers/customer-list";
import { formatCurrency, formatNumber, formatBytes } from "@/lib/utils";
import {
  AlertTriangle, CalendarClock, CheckCircle2, PauseCircle, Users, Wallet,
  Wifi, WifiOff, Unplug,
} from "lucide-react";

export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/* ================================================================== */
/* /customers/status/[status]                                          */
/* ================================================================== */

type StatusMeta = {
  title: string;
  description: string;
  view: CustomerView;
  statuses: string[];
  expiredOnly?: boolean;
};

const STATUS_META: Record<string, StatusMeta> = {
  active: {
    title: "Active Customers",
    description: "Connections with an active service and a valid subscription.",
    view: "active",
    statuses: ["Active"],
  },
  expired: {
    title: "Expired Customers",
    description: "Past the expiry date and currently past the grace period.",
    view: "expired",
    statuses: ["Active"],
    expiredOnly: true,
  },
  suspended: {
    title: "Suspended Customers",
    description: "Service paused pending payment or a support resolution.",
    view: "suspended",
    statuses: ["Suspended"],
  },
  disconnected: {
    title: "Disconnected Customers",
    description: "Terminated connections kept for record keeping and reconnection.",
    view: "disconnected",
    statuses: ["Disconnected"],
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ status: string }>;
}): Promise<Metadata> {
  const { status } = await params;
  return { title: STATUS_META[status]?.title ?? "Customer status" };
}

export async function CustomerStatusPage({
  params,
  searchParams,
}: Params & { params: Promise<{ status: string }> }) {
  const { status } = await params;
  const meta = STATUS_META[status];
  if (!meta) notFound();

  const p = parseListParams(await searchParams);
  const [areas, packages, metrics, result] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    customerStatusMetrics(),
    listCustomers({
      ...p,
      connectionStatus: meta.statuses[0],
      expiredOnly: meta.expiredOnly,
    }),
  ]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{meta.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{meta.description}</p>
      </div>

      <StatCardGrid>
        {status === "active" ? (
          <>
            <StatCard label="Active" value={formatNumber(metrics.active)} icon={CheckCircle2} tone="success" />
            <StatCard label="Active With Due" value={formatNumber(metrics.activeWithDue)} icon={AlertTriangle} tone="danger" />
            <StatCard label="Active Without Due" value={formatNumber(metrics.activeWithoutDue)} icon={Wallet} tone="success" />
            <StatCard label="Active Online" value={formatNumber(metrics.activeOnline)} icon={Wifi} tone="info" />
          </>
        ) : null}
        {status === "expired" ? (
          <>
            <StatCard label="Expired" value={formatNumber(metrics.expired)} icon={AlertTriangle} tone="danger" />
            <StatCard label="Expiring in 3 days" value={formatNumber(metrics.expiringSoon)} icon={CalendarClock} tone="warning" />
            <StatCard label="Unpaid" value={formatNumber(metrics.activeWithDue)} icon={Wallet} tone="warning" />
            <StatCard label="Suspended" value={formatNumber(metrics.suspended)} icon={PauseCircle} tone="warning" />
          </>
        ) : null}
        {status === "suspended" ? (
          <>
            <StatCard label="Suspended" value={formatNumber(metrics.suspended)} icon={PauseCircle} tone="warning" />
            <StatCard label="Total Due" value={formatCurrency(result.metrics?.due ?? 0)} icon={Wallet} tone="danger" />
            <StatCard label="Currently Online" value={formatNumber(metrics.online)} icon={Wifi} tone="info" />
            <StatCard label="Total Customers" value={formatNumber(metrics.total)} icon={Users} tone="brand" />
          </>
        ) : null}
        {status === "disconnected" ? (
          <>
            <StatCard label="Disconnected" value={formatNumber(metrics.disconnected)} icon={Unplug} tone="neutral" />
            <StatCard label="Pending Activation" value={formatNumber(metrics.pending)} icon={CalendarClock} tone="warning" />
            <StatCard label="Bill Impact" value={formatCurrency(result.metrics?.monthlyBill ?? 0)} icon={Wallet} tone="danger" />
            <StatCard label="Total Customers" value={formatNumber(metrics.total)} icon={Users} tone="brand" />
          </>
        ) : null}
      </StatCardGrid>

      <CustomerListPage
        view={meta.view}
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        filterProps={{ showStatus: true, showBilling: true, showExpiry: true }}
        emptyTitle={`No ${meta.title.toLowerCase()}`}
        emptyDescription="Customers will appear here as their connection status changes."
      />
    </div>
  );
}

/* ================================================================== */
/* /customers/expiring                                                 */
/* ================================================================== */

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Next 7 days" },
  { key: "month", label: "Next 30 days" },
] as const;

export async function CustomerExpiringPage({ searchParams }: Params) {
  const sp = await searchParams;
  const p = parseListParams(sp);
  const window = (sp.window as "today" | "week" | "month") ?? "week";

  const [areas, packages, metrics, result] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    customerStatusMetrics(),
    listExpiring({ window, perPage: 100, areaId: p.areaId, packageId: p.packageId }),
  ]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Expiring Soon</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Subscriptions ending within the selected window. Renew or collect payment before service lapses.
        </p>
      </div>

      <StatCardGrid>
        <StatCard label="Expiring Today" value={formatNumber(metrics.expiringSoon)} icon={CalendarClock} tone="warning" />
        <StatCard label="Expiring This Week" value={formatNumber(metrics.expiringSoon)} icon={CalendarClock} tone="warning" />
        <StatCard label="Already Expired" value={formatNumber(metrics.expired)} icon={AlertTriangle} tone="danger" />
        <StatCard label="Suspended" value={formatNumber(metrics.suspended)} icon={PauseCircle} tone="warning" />
      </StatCardGrid>

      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/customers/expiring?window=${w.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              window === w.key
                ? "border-brand-600 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                : "border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      <CustomerListPage
        view="expiring"
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        filterProps={{ showBilling: true }}
        newHref="/customers"
        newLabel="All customers"
        emptyTitle="Nobody is expiring"
        emptyDescription="No subscription ends inside this window."
      />
    </div>
  );
}

/* ================================================================== */
/* /customers/due                                                      */
/* ================================================================== */

export async function CustomerDuePage({ searchParams }: Params) {
  const p = parseListParams(await searchParams);
  const [areas, packages, result] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    listDue(p),
  ]);

  const buckets = { "1-7": 0, "8-30": 0, "30+": 0 };
  for (const r of result.rows) {
    const d = r.daysOverdue ?? 0;
    if (d <= 0) continue;
    if (d <= 7) buckets["1-7"] += r.previousDue;
    else if (d <= 30) buckets["8-30"] += r.previousDue;
    else buckets["30+"] += r.previousDue;
  }
  const totalDue = result.rows.reduce((s, r) => s + r.previousDue, 0);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Due Customers</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Outstanding balances with an aging breakdown for follow-up and SMS reminders.
        </p>
      </div>

      <StatCardGrid>
        <StatCard label="Total Due" value={formatCurrency(totalDue)} icon={Wallet} tone="danger" hint={`${result.total} customers`} />
        <StatCard label="1-7 Days" value={formatCurrency(buckets["1-7"])} icon={CalendarClock} tone="warning" />
        <StatCard label="8-30 Days" value={formatCurrency(buckets["8-30"])} icon={CalendarClock} tone="warning" />
        <StatCard label="30+ Days" value={formatCurrency(buckets["30+"])} icon={AlertTriangle} tone="danger" />
      </StatCardGrid>

      <CustomerListPage
        view="due"
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        newHref="/billing/payments/new"
        newLabel="Collect Payment"
        emptyTitle="No outstanding dues"
        emptyDescription="Every customer is settled. Nothing to follow up."
      />
    </div>
  );
}

/* ================================================================== */
/* /customers/online                                                   */
/* ================================================================== */

export async function CustomerOnlinePage({ searchParams }: Params) {
  const p = parseListParams(await searchParams);
  const [areas, packages, result] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    listOnline(p),
  ]);

  const totalDown = result.rows.reduce((s, r) => s + Number(r.downloadBytes ?? 0), 0);
  const totalUp = result.rows.reduce((s, r) => s + Number(r.uploadBytes ?? 0), 0);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Online Users</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Live PPPoE sessions currently held on your routers.</p>
      </div>

      <StatCardGrid>
        <StatCard label="Online Users" value={formatNumber(result.total)} icon={Wifi} tone="success" />
        <StatCard label="Total Download" value={formatBytes(totalDown)} icon={Wifi} tone="info" />
        <StatCard label="Total Upload" value={formatBytes(totalUp)} icon={Wifi} tone="brand" />
        <StatCard
          label="Avg per User"
          value={formatBytes(result.total ? (totalDown + totalUp) / result.total : 0)}
          icon={Users}
          tone="neutral"
        />
      </StatCardGrid>

      <CustomerListPage
        view="online"
        rows={result.rows as unknown as Row[]}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        newHref="/customers"
        newLabel="All customers"
        emptyTitle="Nobody is online"
        emptyDescription="Live sessions appear here the moment a customer connects."
      />
    </div>
  );
}

/* ================================================================== */
/* /customers/offline                                                  */
/* ================================================================== */

export async function CustomerOfflinePage({ searchParams }: Params) {
  const p = parseListParams(await searchParams);
  const [areas, packages, result] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    listOffline(p),
  ]);

  const rows = result.rows as unknown as Row[];
  const expired = rows.filter((r) => r.expiryDate && new Date(r.expiryDate) < new Date()).length;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Offline Customers</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Active or suspended connections that are not currently connected.
        </p>
      </div>

      <StatCardGrid>
        <StatCard label="Offline" value={formatNumber(result.total)} icon={WifiOff} tone="neutral" />
        <StatCard label="With Due" value={formatNumber(rows.filter((r) => r.previousDue > 0).length)} icon={AlertTriangle} tone="danger" />
        <StatCard label="Expired" value={formatNumber(expired)} icon={CalendarClock} tone="warning" />
        <StatCard
          label="Unpaid Value"
          value={formatCurrency(rows.reduce((s, r) => s + r.previousDue, 0))}
          icon={Wallet}
          tone="warning"
        />
      </StatCardGrid>

      <CustomerListPage
        view="offline"
        rows={rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        filterProps={{ showStatus: true, showExpiry: true }}
        newHref="/customers"
        newLabel="All customers"
        emptyTitle="Everyone is online"
        emptyDescription="No offline connections in the current filter."
      />
    </div>
  );
}
