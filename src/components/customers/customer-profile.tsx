"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge, StatusTriple } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { BarChartView } from "@/components/ui/charts";
import { Avatar } from "@/components/layout/avatar";
import {
  formatCurrency, formatDate, formatDateTime, formatBytes, formatNumber,
  formatUptime, daysUntil, relativeTime,
} from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Pkg = { id: string; name: string; downloadSpeed: number; uploadSpeed: number; monthlyPrice: number } | null;

type Customer = {
  id: string;
  customerCode: string;
  name: string;
  fatherName: string | null;
  motherName: string | null;
  phone: string;
  altPhone: string | null;
  email: string | null;
  nid: string | null;
  dateOfBirth: string | Date | null;
  gender: string | null;
  address: string | null;
  customerType: string;
  username: string;
  connectionType: string;
  ipType: string;
  ipAddress: string | null;
  macAddress: string | null;
  ponPort: string | null;
  connectionDate: Date;
  billingDate: Date | null;
  expiryDate: Date | null;
  monthlyBill: number;
  installationFee: number;
  advancePayment: number;
  previousDue: number;
  discount: number;
  vat: number;
  totalPayable: number;
  connectionStatus: string;
  billingStatus: string;
  onlineStatus: string;
  suspendReason: string | null;
  suspendedAt: Date | null;
  disconnectReason: string | null;
  disconnectedAt: Date | null;
  lastOnlineAt: Date | null;
  loginTime: Date | null;
  downloadBytes: number;
  uploadBytes: number;
  note: string | null;
  createdAt: Date;
  area: { id: string; name: string; zone: { name: string } | null } | null;
  package: Pkg;
  router: { id: string; name: string; ipAddress: string; model: string | null } | null;
  olt: { id: string; name: string; vendor: string | null } | null;
  onu: { id: string; serialNo: string; status: string; rxPower: number | null } | null;
  invoices: {
    id: string; invoiceNumber: string; issueDate: Date; dueDate: Date;
    amount: number; discount: number; vat: number; total: number; paid: number; status: string;
    payments: { id: string; amount: number; method: string; paymentDate: Date }[];
  }[];
  payments: {
    id: string; paymentId: string; amount: number; method: string; transactionId: string | null;
    paymentDate: Date; note: string | null;
    account: { name: string; type: string };
    collectedBy: { name: string } | null;
    invoice: { id: string; invoiceNumber: string; total: number; dueDate: Date } | null;
    receipt: { id: string; receiptNumber: string; issuedAt: Date } | null;
  }[];
  tickets: {
    id: string; ticketNumber: string; subject: string; problem: string; status: string;
    priority: string; createdAt: Date; technician: { name: string } | null;
  }[];
  sessionLogs: {
    id: string; loginTime: Date; logoutTime: Date | null; downloadBytes: number;
    uploadBytes: number; ipAddress: string | null; macAddress: string | null; username: string;
  }[];
  packageLogs: {
    id: string; reason: string | null; createdAt: Date;
    fromPkg: { name: string } | null; toPkg: { name: string } | null;
  }[];
  notifications: {
    id: string; channel: string; body: string; status: string; createdAt: Date;
    recipient: string;
  }[];
};

type ActivityRow = { id: string; action: string; summary: string; createdAt: Date; actor: string };

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function CustomerProfileHeader({ customer }: { customer: Customer }) {
  const d = daysUntil(customer.expiryDate);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} size="xl" />
        <div>
          <p className="text-base font-semibold">{customer.name}</p>
          <p className="font-mono text-xs text-fg-muted">{customer.customerCode}</p>
        </div>
      </div>

      <Metric label="Status" value={<StatusTriple connection={customer.connectionStatus} online={customer.onlineStatus} billing={customer.billingStatus} />} />
      <Metric label="Package" value={customer.package ? <Link href={`/packages/${customer.package.id}`} className="font-medium hover:text-brand-600">{customer.package.name}</Link> : <span className="text-fg-subtle">Not assigned</span>} />
      <Metric label="Monthly Bill" value={<span className="tnum">{formatCurrency(customer.monthlyBill)}</span>} />
      <Metric
        label="Due"
        value={<span className={`tnum font-semibold ${customer.previousDue > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{formatCurrency(customer.previousDue)}</span>}
      />
      <Metric
        label="Expiry"
        value={
          <span className="whitespace-nowrap">
            {formatDate(customer.expiryDate)}
            {d !== null ? (
              <span className={`ml-1.5 text-xs ${d < 0 ? "text-red-600" : d <= 3 ? "text-amber-600" : "text-fg-subtle"}`}>
                ({d < 0 ? `${Math.abs(d)}d ago` : `${d}d`})
              </span>
            ) : null}
          </span>
        }
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function CustomerProfileTabs({
  tab,
  customer,
  activity,
  activityHref,
  metrics,
}: {
  tab: string;
  customer: Customer;
  activity: ActivityRow[];
  activityHref: string;
  metrics: {
    outstandingInvoices: number;
    outstandingAmount: number;
    nextBilling: string | null;
    totalPaid: number;
    invoiceCount: number;
    ticketCount: number;
  };
}) {
  const href = (t: string) => `/customers/${customer.id}?tab=${t}`;

  const items = [
    { value: "overview", label: "Overview", href: href("overview") },
    { value: "billing", label: "Billing", href: href("billing"), count: metrics.invoiceCount },
    { value: "payments", label: "Payments", href: href("payments"), count: customer.payments.length },
    { value: "connection", label: "Connection", href: href("connection") },
    { value: "complaints", label: "Complaints", href: href("complaints"), count: customer.tickets.length },
    { value: "usage", label: "Usage", href: href("usage"), count: customer.sessionLogs.length },
    { value: "history", label: "History", href: href("history") },
  ];

  return (
    <div className="space-y-4">
      <Tabs items={items} />

      {tab === "overview" ? <OverviewTab customer={customer} metrics={metrics} /> : null}
      {tab === "billing" ? <BillingTab customer={customer} metrics={metrics} /> : null}
      {tab === "payments" ? <PaymentsTab customer={customer} /> : null}
      {tab === "connection" ? <ConnectionTab customer={customer} /> : null}
      {tab === "complaints" ? <ComplaintsTab customer={customer} /> : null}
      {tab === "usage" ? <UsageTab customer={customer} /> : null}
      {tab === "history" ? <HistoryTab customer={customer} activity={activity} activityHref={activityHref} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewTab({ customer, metrics }: { customer: Customer; metrics: { outstandingInvoices: number; outstandingAmount: number; nextBilling: string | null; totalPaid: number; invoiceCount: number; ticketCount: number } }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <InfoCard title="Personal information" rows={[
          ["Full name", customer.name],
          ["Father / Husband", customer.fatherName ?? "—"],
          ["Mother", customer.motherName ?? "—"],
          ["Mobile", customer.phone],
          ["Alternative mobile", customer.altPhone ?? "—"],
          ["Email", customer.email ?? "—"],
          ["NID", customer.nid ?? "—"],
          ["Date of birth", formatDate(customer.dateOfBirth)],
          ["Gender", customer.gender ?? "—"],
          ["Customer type", customer.customerType],
          ["Area", customer.area ? `${customer.area.name}${customer.area.zone ? ` (${customer.area.zone.name})` : ""}` : "—"],
          ["Address", customer.address ?? "—"],
          ["Registered", formatDate(customer.createdAt)],
        ]} />

        <InfoCard title="Connection summary" rows={[
          ["Username", customer.username],
          ["Connection type", customer.connectionType],
          ["IP type", customer.ipType],
          ["IP address", customer.ipAddress ?? "—"],
          ["MAC address", customer.macAddress ?? "—"],
          ["Router", customer.router ? `${customer.router.name} (${customer.router.ipAddress})` : "—"],
          ["OLT", customer.olt ? `${customer.olt.name}${customer.olt.vendor ? ` · ${customer.olt.vendor}` : ""}` : "—"],
          ["ONU", customer.onu ? customer.onu.serialNo : "—"],
          ["PON port", customer.ponPort ?? "—"],
          ["Connection date", formatDate(customer.connectionDate)],
          ["Expiry date", formatDate(customer.expiryDate)],
        ]} />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Billing summary" />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Monthly bill" value={formatCurrency(customer.monthlyBill)} />
            <Row label="Discount" value={`- ${formatCurrency(customer.discount)}`} />
            <Row label="VAT" value={formatCurrency(customer.vat)} />
            <Row label="Installation fee" value={formatCurrency(customer.installationFee)} />
            <Row label="Advance payment" value={formatCurrency(customer.advancePayment)} />
            <div className="border-t border-[var(--border)] pt-2.5">
              <Row label="Outstanding due" value={<span className={customer.previousDue > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{formatCurrency(customer.previousDue)}</span>} bold />
            </div>
            <div className="border-t border-[var(--border)] pt-2.5">
              <Row label="Total paid (lifetime)" value={formatCurrency(metrics.totalPaid)} bold />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Quick facts" />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Invoices" value={formatNumber(metrics.invoiceCount)} />
            <Row label="Outstanding invoices" value={formatNumber(metrics.outstandingInvoices)} />
            <Row label="Tickets raised" value={formatNumber(metrics.ticketCount)} />
            <Row label="Online" value={<StatusBadge status={customer.onlineStatus} />} />
            <Row label="Last online" value={relativeTime(customer.lastOnlineAt)} />
            <Row label="Next billing date" value={metrics.nextBilling ? formatDate(metrics.nextBilling) : "—"} />
            <Row label="Traffic (this month)" value={formatBytes(customer.downloadBytes + customer.uploadBytes)} />
          </CardBody>
        </Card>

        {customer.suspendReason ? (
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardBody>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Suspension</p>
              <p className="mt-1 text-sm">{customer.suspendReason}</p>
              <p className="mt-1 text-xs text-fg-muted">Since {formatDate(customer.suspendedAt)}</p>
            </CardBody>
          </Card>
        ) : null}
        {customer.disconnectReason ? (
          <Card className="border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
            <CardBody>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Disconnected</p>
              <p className="mt-1 text-sm">{customer.disconnectReason}</p>
              <p className="mt-1 text-xs text-fg-muted">Since {formatDate(customer.disconnectedAt)}</p>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className={`text-right ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
              <dd className="mt-0.5 truncate text-sm" title={typeof v === "string" ? v : undefined}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

function BillingTab({ customer, metrics }: { customer: Customer; metrics: { outstandingInvoices: number; outstandingAmount: number; nextBilling: string | null } }) {
  const columns: Column<Customer["invoices"][number]>[] = [
    { key: "invoiceNumber", header: "Invoice", cell: (i) => <Link href={`/billing/invoices/${i.id}`} className="font-mono text-xs font-medium hover:text-brand-600">{i.invoiceNumber}</Link>, exportValue: (i) => i.invoiceNumber },
    { key: "issue", header: "Issued", hideBelow: "sm", cell: (i) => <span className="text-xs">{formatDate(i.issueDate)}</span>, exportValue: (i) => formatDate(i.issueDate) },
    { key: "due", header: "Due date", hideBelow: "md", cell: (i) => <span className="text-xs">{formatDate(i.dueDate)}</span>, exportValue: (i) => formatDate(i.dueDate) },
    { key: "total", header: "Total", align: "right", cell: (i) => <span className="tnum text-xs">{formatCurrency(i.total)}</span>, exportValue: (i) => i.total },
    { key: "paid", header: "Paid", align: "right", cell: (i) => <span className="tnum text-xs">{formatCurrency(i.paid)}</span>, exportValue: (i) => i.paid },
    { key: "balance", header: "Balance", align: "right", cell: (i) => <span className={`tnum text-xs font-medium ${i.total - i.paid > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{formatCurrency(i.total - i.paid)}</span>, exportValue: (i) => i.total - i.paid },
    { key: "status", header: "Status", align: "right", cell: (i) => <StatusBadge status={i.status} />, exportValue: (i) => i.status },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Outstanding Invoices" value={formatNumber(metrics.outstandingInvoices)} tone="warning" />
        <StatCard label="Outstanding Amount" value={formatCurrency(metrics.outstandingAmount)} tone="danger" />
        <StatCard label="Next Billing Date" value={metrics.nextBilling ? formatDate(metrics.nextBilling) : "—"} tone="brand" />
      </div>

      <DataTableShell
        columns={columns}
        rows={customer.invoices}
        rowKey={(i) => i.id}
        compact
        empty={<EmptyState title="No invoices yet" description="Create an invoice from the quick actions above." />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

function PaymentsTab({ customer }: { customer: Customer }) {
  const columns: Column<Customer["payments"][number]>[] = [
    { key: "paymentId", header: "Payment", cell: (p) => <span className="font-mono text-xs font-medium">{p.paymentId}</span>, exportValue: (p) => p.paymentId },
    { key: "invoice", header: "Invoice", hideBelow: "sm", cell: (p) => p.invoice ? <Link href={`/billing/invoices/${p.invoice.id}`} className="font-mono text-xs hover:text-brand-600">{p.invoice.invoiceNumber}</Link> : <span className="text-xs text-fg-subtle">—</span>, exportValue: (p) => p.invoice?.invoiceNumber ?? "" },
    { key: "amount", header: "Amount", align: "right", cell: (p) => <span className="tnum text-xs font-semibold">{formatCurrency(p.amount)}</span>, exportValue: (p) => p.amount },
    { key: "method", header: "Method", cell: (p) => <Badge>{p.method}</Badge>, exportValue: (p) => p.method },
    { key: "txn", header: "Transaction", hideBelow: "lg", cell: (p) => <span className="font-mono text-[11px] text-fg-muted">{p.transactionId ?? "—"}</span>, exportValue: (p) => p.transactionId ?? "" },
    { key: "account", header: "Account", hideBelow: "xl", cell: (p) => <span className="text-xs text-fg-muted">{p.account.name}</span>, exportValue: (p) => p.account.name },
    { key: "date", header: "Date", align: "right", cell: (p) => <span className="whitespace-nowrap text-xs">{formatDate(p.paymentDate)}</span>, exportValue: (p) => formatDate(p.paymentDate) },
    { key: "receipt", header: "Receipt", align: "right", cell: (p) => p.receipt ? <span className="font-mono text-[11px] text-fg-muted">{p.receipt.receiptNumber}</span> : "—", exportValue: (p) => p.receipt?.receiptNumber ?? "" },
    { key: "by", header: "Collected by", hideBelow: "xl", cell: (p) => <span className="text-xs text-fg-muted">{p.collectedBy?.name ?? "System"}</span>, exportValue: (p) => p.collectedBy?.name ?? "" },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={customer.payments}
      rowKey={(p) => p.id}
      compact
      toolbar={
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm font-medium">Payment history</p>
          <p className="tnum text-sm text-fg-muted">
            Total paid: <strong className="text-[var(--fg)]">{formatCurrency(customer.payments.reduce((s, p) => s + p.amount, 0))}</strong>
          </p>
        </div>
      }
      empty={<EmptyState title="No payments recorded" description="Payments collected for this customer will appear here." />}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

function ConnectionTab({ customer }: { customer: Customer }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Access credentials" />
        <CardBody>
          <InfoCard
            title=""
            rows={[
              ["PPPoE username", <span className="font-mono" key="u">{customer.username}</span>],
              ["Password", <span className="font-mono text-fg-muted" key="p">stored securely (hidden)</span>],
              ["Connection type", customer.connectionType],
              ["IP allocation", customer.ipType],
              ["Assigned IP", <span className="font-mono" key="ip">{customer.ipAddress ?? "dynamic"}</span>],
              ["MAC address", <span className="font-mono" key="mac">{customer.macAddress ?? "—"}</span>],
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Network path" />
        <CardBody>
          <InfoCard
            title=""
            rows={[
              ["Router", customer.router ? `${customer.router.name} · ${customer.router.model ?? "—"} · ${customer.router.ipAddress}` : "—"],
              ["OLT", customer.olt ? `${customer.olt.name} · ${customer.olt.vendor ?? "—"}` : "—"],
              ["ONU serial", customer.onu?.serialNo ?? "—"],
              ["ONU status", customer.onu ? <StatusBadge status={customer.onu.status} key="os" /> : "—"],
              ["RX power", customer.onu?.rxPower != null ? `${customer.onu.rxPower} dBm` : "—"],
              ["PON port", customer.ponPort ?? "—"],
              ["Area / zone", customer.area ? `${customer.area.name}${customer.area.zone ? ` / ${customer.area.zone.name}` : ""}` : "—"],
            ]}
          />
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Current session" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="State" value={<StatusBadge status={customer.onlineStatus} />} tone={customer.onlineStatus === "Online" ? "success" : "neutral"} />
            <StatCard label="Login time" value={formatDateTime(customer.loginTime)} tone="brand" />
            <StatCard label="Download" value={formatBytes(customer.downloadBytes)} tone="info" />
            <StatCard label="Upload" value={formatBytes(customer.uploadBytes)} tone="warning" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Complaints                                                          */
/* ------------------------------------------------------------------ */

function ComplaintsTab({ customer }: { customer: Customer }) {
  const columns: Column<Customer["tickets"][number]>[] = [
    { key: "ticketNumber", header: "Ticket", cell: (t) => <Link href={`/support/tickets/${t.id}`} className="font-mono text-xs font-medium hover:text-brand-600">{t.ticketNumber}</Link>, exportValue: (t) => t.ticketNumber },
    { key: "subject", header: "Subject", cell: (t) => <span className="text-sm">{t.subject}</span>, exportValue: (t) => t.subject },
    { key: "problem", header: "Category", hideBelow: "sm", cell: (t) => <Badge>{t.problem}</Badge>, exportValue: (t) => t.problem },
    { key: "priority", header: "Priority", cell: (t) => <StatusBadge status={t.priority} />, exportValue: (t) => t.priority },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} />, exportValue: (t) => t.status },
    { key: "technician", header: "Technician", hideBelow: "md", cell: (t) => <span className="text-xs text-fg-muted">{t.technician?.name ?? "Unassigned"}</span>, exportValue: (t) => t.technician?.name ?? "" },
    { key: "created", header: "Created", align: "right", cell: (t) => <span className="whitespace-nowrap text-xs">{formatDate(t.createdAt)}</span>, exportValue: (t) => formatDate(t.createdAt) },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={customer.tickets}
      rowKey={(t) => t.id}
      compact
      empty={<EmptyState title="No complaints" description="Support tickets raised by this customer will appear here." />}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */

function UsageTab({ customer }: { customer: Customer }) {
  const sessions = customer.sessionLogs;
  const totalDown = sessions.reduce((s, x) => s + x.downloadBytes, 0);
  const totalUp = sessions.reduce((s, x) => s + x.uploadBytes, 0);

  const columns: Column<Customer["sessionLogs"][number]>[] = [
    { key: "login", header: "Login", cell: (s) => <span className="whitespace-nowrap text-xs">{formatDateTime(s.loginTime)}</span>, exportValue: (s) => formatDateTime(s.loginTime) },
    { key: "logout", header: "Logout", hideBelow: "sm", cell: (s) => <span className="whitespace-nowrap text-xs text-fg-muted">{s.logoutTime ? formatDateTime(s.logoutTime) : "Active"}</span>, exportValue: (s) => (s.logoutTime ? formatDateTime(s.logoutTime) : "Active") },
    { key: "ip", header: "IP", hideBelow: "md", cell: (s) => <span className="font-mono text-[11px]">{s.ipAddress ?? "—"}</span>, exportValue: (s) => s.ipAddress ?? "" },
    { key: "down", header: "Download", align: "right", cell: (s) => <span className="tnum text-xs">{formatBytes(s.downloadBytes)}</span>, exportValue: (s) => s.downloadBytes },
    { key: "up", header: "Upload", align: "right", cell: (s) => <span className="tnum text-xs">{formatBytes(s.uploadBytes)}</span>, exportValue: (s) => s.uploadBytes },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (s) => <span className="tnum text-xs font-medium">{formatBytes(s.downloadBytes + s.uploadBytes)}</span>,
      exportValue: (s) => s.downloadBytes + s.uploadBytes,
    },
    {
      key: "uptime",
      header: "Duration",
      align: "right",
      hideBelow: "lg",
      cell: (s) => <span className="text-xs text-fg-muted">{s.logoutTime ? formatUptime(Math.round((s.logoutTime.getTime() - s.loginTime.getTime()) / 1000)) : "Live"}</span>,
      exportValue: (s) => (s.logoutTime ? formatDateTime(s.logoutTime) : "Live"),
    },
  ];

  const byDay = new Map<string, { down: number; up: number }>();
  for (const s of sessions) {
    const key = s.loginTime.toISOString().slice(0, 10);
    const row = byDay.get(key) ?? { down: 0, up: 0 };
    row.down += s.downloadBytes;
    row.up += s.uploadBytes;
    byDay.set(key, row);
  }
  const chartData = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({ label, Download: v.down, Upload: v.up }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Sessions" value={formatNumber(sessions.length)} tone="brand" />
        <StatCard label="Total Download" value={formatBytes(totalDown)} tone="info" />
        <StatCard label="Total Upload" value={formatBytes(totalUp)} tone="warning" />
        <StatCard label="Package Limit" value={customer.package ? `${customer.package.downloadSpeed} Mbps` : "—"} tone="neutral" />
      </div>

      {chartData.length > 0 ? (
        <Card>
          <CardHeader title="Traffic by day" description="Recorded session volume for this customer" />
          <CardBody>
            <BarChartView
              data={chartData}
              series={[
                { key: "Download", label: "Download", color: "#3163ff" },
                { key: "Upload", label: "Upload", color: "#10b981" },
              ]}
              height={240}
            />
          </CardBody>
        </Card>
      ) : null}

      <DataTableShell
        columns={columns}
        rows={sessions}
        rowKey={(s) => s.id}
        compact
        empty={<EmptyState title="No session history" description="Online sessions will be recorded here as the customer connects." />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function HistoryTab({ customer, activity, activityHref }: { customer: Customer; activity: ActivityRow[]; activityHref: string }) {
  const [merged] = useState(() =>
    [
      ...activity.map((a) => ({ id: a.id, when: a.createdAt, kind: "System", text: a.summary, actor: a.actor })),
      ...customer.packageLogs.map((p) => ({
        id: p.id,
        when: p.createdAt,
        kind: "Package",
        text: `${p.fromPkg?.name ?? "No package"} → ${p.toPkg?.name ?? "No package"}${p.reason ? ` (${p.reason})` : ""}`,
        actor: "System",
      })),
      ...customer.notifications.map((n) => ({
        id: n.id,
        when: n.createdAt,
        kind: n.channel,
        text: n.body,
        actor: n.recipient,
      })),
    ].sort((a, b) => b.when.getTime() - a.when.getTime())
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Combined history" description="Package changes, notifications and audited system actions" />
        <CardBody className="p-0">
          {merged.length === 0 ? (
            <EmptyState title="No history yet" description="Actions on this customer will be listed here." />
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {merged.map((h) => (
                <li key={h.id} className="flex items-start gap-3 px-4 py-3">
                  <Badge tone={h.kind === "Package" ? "brand" : h.kind === "System" ? "info" : "neutral"}>{h.kind}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{h.text}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {formatDateTime(h.when)} · {h.actor}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Audit log"
          description="Server-side record of every operation on this customer"
          action={
            <Link href={activityHref} className="text-xs font-medium text-brand-600 hover:underline">
              View all
            </Link>
          }
        />
        <CardBody className="p-0">
          {activity.length === 0 ? (
            <EmptyState title="No audit entries" />
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {activity.slice(0, 12).map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Badge>{a.action}</Badge>
                  <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {formatDateTime(a.createdAt)} · {a.actor}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
