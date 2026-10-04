"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DataTableShell, TableToolbar, ExportCsvButton, FilterSelect, Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { DropdownMenu, MenuItem } from "@/components/ui/dropdown";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/providers";
import { StatCard } from "@/components/ui/stat-card";
import { formatBytes, formatDateTime, formatNumber, formatUptime, relativeTime } from "@/lib/utils";
import { DEVICE_STATUSES } from "@/lib/enums";
import { OnuControlActions } from "@/components/network/onu-control-actions";
import {
  CircleCheck,
  MoreHorizontal,
  RefreshCcw,
  Router as RouterIcon,
  Server,
  Terminal,
  Unplug,
  Users,
  Zap,
} from "lucide-react";

/* ================================================================== */
/* Routers                                                             */
/* ================================================================== */

export type RouterRow = {
  id: string;
  name: string;
  model: string | null;
  ipAddress: string;
  location: string | null;
  apiPort: number;
  status: string;
  cpu: number | null;
  ram: number | null;
  uptimeSec: number | null;
  lastSyncAt: Date | null;
  area: { name: string } | null;
  customers: number;
  onlineUsers: number;
};

export function RoutersTable({ rows }: { rows: RouterRow[] }) {
  const columns: Column<RouterRow>[] = [
    {
      key: "name",
      header: "Router",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.model ?? "—"}</span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "ip", header: "IP Address", cell: (r) => <span className="font-mono text-xs">{r.ipAddress}</span>, exportValue: (r) => r.ipAddress },
    { key: "port", header: "API Port", align: "right", hideBelow: "xl", cell: (r) => <span className="tnum text-xs text-fg-muted">{r.apiPort}</span>, exportValue: (r) => r.apiPort },
    { key: "location", header: "Location", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.location ?? "—"}</span>, exportValue: (r) => r.location ?? "" },
    { key: "area", header: "Area", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.area?.name ?? "—"}</span>, exportValue: (r) => r.area?.name ?? "" },
    { key: "customers", header: "Customers", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs">{formatNumber(r.customers)}</span>, exportValue: (r) => r.customers },
    { key: "online", header: "Online", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-emerald-600 dark:text-emerald-400">{r.onlineUsers}</span>, exportValue: (r) => r.onlineUsers },
    { key: "cpu", header: "CPU", align: "right", hideBelow: "md", cell: (r) => <Meter value={r.cpu} />, exportValue: (r) => r.cpu ?? 0 },
    { key: "ram", header: "RAM", align: "right", hideBelow: "lg", cell: (r) => <Meter value={r.ram} />, exportValue: (r) => r.ram ?? 0 },
    { key: "uptime", header: "Uptime", align: "right", hideBelow: "xl", cell: (r) => <span className="tnum text-xs text-fg-muted">{formatUptime(r.uptimeSec)}</span>, exportValue: (r) => formatUptime(r.uptimeSec) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <RouterActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search router, IP, location..."
          filters={<FilterSelect param="status" placeholder="All statuses" options={DEVICE_STATUSES.map((s) => ({ value: s, label: s }))} />}
          actions={<ExportCsvButton rows={rows} columns={columns} filename="routers" />}
        />
      }
      empty={<EmptyState icon={<RouterIcon />} title="No routers configured" description="Add routers to monitor PPPoE sessions and push configuration." />}
    />
  );
}

function Meter({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-xs text-fg-subtle">—</span>;
  const v = Number(value);
  const tone = v > 85 ? "bg-red-500" : v > 65 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <span className="tnum text-[11px] text-fg-muted">{v.toFixed(0)}%</span>
    </span>
  );
}

function RouterActions({ row }: { row: RouterRow }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const items: (MenuItem | "separator")[] = [
    {
      label: "Test connection",
      icon: <Terminal />,
      onSelect: async () => {
        setBusy(true);
        const { testRouterAction } = await import("@/app/(app)/network/actions");
        const r = await testRouterAction(row.id);
        setBusy(false);
        if (r.formError) error(r.formError);
        else {
          success(r.success ?? "Connection OK");
          startTransition(() => router.refresh());
        }
      },
      disabled: busy,
    },
    { label: "View", onSelect: () => router.push(`/network/routers/${row.id}`) },
    "separator",
    { label: "Online users", icon: <Users />, onSelect: () => router.push(`/customers/online?routerId=${row.id}`) },
  ];

  return <DropdownMenu items={items} trigger={<MoreHorizontal className="size-4" />} />;
}

/* ================================================================== */
/* OLT                                                                 */
/* ================================================================== */

export type OltRow = {
  id: string;
  name: string;
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  location: string | null;
  ponPorts: number;
  status: string;
  lastSyncAt: Date | null;
  area: { name: string } | null;
  totalOnu: number;
  onlineOnu: number;
  offlineOnu: number;
  lowSignalOnu: number;
};

export function OltsTable({ rows }: { rows: OltRow[] }) {
  const columns: Column<OltRow>[] = [
    {
      key: "name",
      header: "OLT",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{r.vendor ?? "—"} {r.model ?? ""}</span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "ip", header: "IP", hideBelow: "sm", cell: (r) => <span className="font-mono text-xs">{r.ipAddress ?? "—"}</span>, exportValue: (r) => r.ipAddress ?? "" },
    { key: "location", header: "Location", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.location ?? "—"}</span>, exportValue: (r) => r.location ?? "" },
    {
      key: "pon",
      header: "PON Ports",
      align: "right",
      cell: (r) => (
        <Link href={`/network/olt/${r.id}`} className="tnum text-xs hover:text-brand-600">
          {r.ponPorts}
        </Link>
      ),
      exportValue: (r) => r.ponPorts,
    },
    { key: "online", header: "Online ONU", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-emerald-600 dark:text-emerald-400">{r.onlineOnu}</span>, exportValue: (r) => r.onlineOnu },
    { key: "offline", header: "Offline ONU", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs text-red-600 dark:text-red-400">{r.offlineOnu}</span>, exportValue: (r) => r.offlineOnu },
    { key: "low", header: "Low Signal", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs text-amber-600 dark:text-amber-400">{r.lowSignalOnu}</span>, exportValue: (r) => r.lowSignalOnu },
    { key: "area", header: "Area", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.area?.name ?? "—"}</span>, exportValue: (r) => r.area?.name ?? "" },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <OltsActions row={r} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={<TableToolbar searchPlaceholder="Search OLT, vendor, IP..." actions={<ExportCsvButton rows={rows} columns={columns} filename="olts" />} />}
      empty={<EmptyState icon={<Server />} title="No OLTs registered" description="Add your OLTs to track PON ports and ONU registration." />}
    />
  );
}

function OltsActions({ row }: { row: OltRow }) {
  const router = useRouter();
  return (
    <DropdownMenu
      items={[
        { label: "View ONUs", onSelect: () => router.push(`/network/onu?oltId=${row.id}`) },
        { label: "Status detail", onSelect: () => router.push(`/network/olt?tab=${row.id}`) },
      ]}
      trigger={<MoreHorizontal className="size-4" />}
    />
  );
}

/* ================================================================== */
/* ONU                                                                 */
/* ================================================================== */

export type OnuRow = {
  id: string;
  serialNo: string;
  name: string | null;
  vendor: string | null;
  ponIndex: string | null;
  rxPower: number | null;
  txPower: number | null;
  status: string;
  lastSeenAt: Date | null;
  olt: { id: string; name: string } | null;
  area: { name: string } | null;
  customer: { id: string; name: string; username: string } | null;
};

/**
 * `canControl` comes from the server, not from a client-side role guess.
 *
 * A reader sees no buttons at all rather than disabled ones — a disabled button
 * invites the question, and the answer is already on the page. The service layer
 * checks `network.edit` again regardless, so this is presentation and not the
 * enforcement.
 */
export function OnusTable({
  rows,
  olts,
  areas,
  pagination,
  canControl = false,
}: {
  rows: OnuRow[];
  olts: { id: string; name: string }[];
  areas: { id: string; name: string }[];
  pagination?: React.ReactNode;
  canControl?: boolean;
}) {
  const columns: Column<OnuRow>[] = [
    {
      key: "serial",
      header: "ONU",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-mono text-xs font-medium">{r.serialNo}</span>
          {r.name ? <span className="block truncate text-[11px] text-fg-subtle">{r.name}</span> : null}
        </div>
      ),
      exportValue: (r) => r.serialNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) =>
        r.customer ? (
          <Link href={`/customers/${r.customer.id}`} className="truncate text-sm hover:text-brand-600">
            {r.customer.name}
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">Unassigned</span>
        ),
      exportValue: (r) => r.customer?.name ?? "",
    },
    { key: "olt", header: "OLT", hideBelow: "sm", cell: (r) => <span className="text-xs text-fg-muted">{r.olt?.name ?? "—"}</span>, exportValue: (r) => r.olt?.name ?? "" },
    { key: "pon", header: "PON", hideBelow: "xl", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.ponIndex ?? "—"}</span>, exportValue: (r) => r.ponIndex ?? "" },
    {
      key: "rx",
      header: "RX Power",
      align: "right",
      cell: (r) => (
        <span className={`tnum text-xs ${r.rxPower === null ? "" : r.rxPower < -28 ? "text-red-600 dark:text-red-400" : r.rxPower < -25 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {r.rxPower === null ? "—" : `${r.rxPower} dBm`}
        </span>
      ),
      exportValue: (r) => r.rxPower ?? "",
    },
    { key: "tx", header: "TX Power", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs text-fg-muted">{r.txPower === null ? "—" : `${r.txPower} dBm`}</span>, exportValue: (r) => r.txPower ?? "" },
    { key: "area", header: "Area", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.area?.name ?? "—"}</span>, exportValue: (r) => r.area?.name ?? "" },
    { key: "seen", header: "Last Seen", align: "right", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap text-xs text-fg-muted">{relativeTime(r.lastSeenAt)}</span>, exportValue: (r) => (r.lastSeenAt ? formatDateTime(r.lastSeenAt) : "") },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "control",
      header: "Control",
      hideBelow: "xl",
      cell: (r) => <OnuControlActions serialNo={r.serialNo} canControl={canControl} />,
      // Deliberately empty: the Excel export is a report about the network, and a
      // column of buttons that do nothing in a spreadsheet is worse than no column.
      exportValue: () => "",
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search serial, customer..."
          filters={
            <>
              <FilterSelect param="status" placeholder="All statuses" options={DEVICE_STATUSES.map((s) => ({ value: s, label: s }))} />
              <FilterSelect param="oltId" placeholder="All OLTs" options={olts.map((o) => ({ value: o.id, label: o.name }))} />
              <FilterSelect param="areaId" placeholder="All areas" options={areas.map((a) => ({ value: a.id, label: a.name }))} width="w-32" />
            </>
          }
          actions={<ExportCsvButton rows={rows} columns={columns} filename="onus" />}
        />
      }
      pagination={pagination}
      empty={<EmptyState icon={<Zap />} title="No ONUs registered" description="ONUs are collected from the OLT during a sync." />}
    />
  );
}

/* ================================================================== */
/* Router detail                                                       */
/* ================================================================== */

export function RouterDetailView({
  router,
  health,
  users,
  adapterName,
}: {
  router: { id: string; name: string; model: string | null; ipAddress: string; location: string | null; area: { name: string } | null };
  health: { status: string; cpu?: number; ram?: number; uptimeSec?: number; activeUsers?: number; error?: string };
  users: { username: string; ipAddress: string | null; macAddress: string | null; downloadBytes: number; uploadBytes: number; uptimeSec: number; loginTime: Date }[];
  adapterName: string;
}) {
  const columns: Column<(typeof users)[number]>[] = [
    { key: "username", header: "Username", cell: (u) => <span className="font-mono text-xs font-medium">{u.username}</span>, exportValue: (u) => u.username },
    { key: "ip", header: "IP", cell: (u) => <span className="font-mono text-xs">{u.ipAddress ?? "—"}</span>, exportValue: (u) => u.ipAddress ?? "" },
    { key: "mac", header: "MAC", hideBelow: "sm", cell: (u) => <span className="font-mono text-[11px] text-fg-muted">{u.macAddress ?? "—"}</span>, exportValue: (u) => u.macAddress ?? "" },
    { key: "down", header: "Download", align: "right", cell: (u) => <span className="tnum text-xs">{formatBytes(u.downloadBytes)}</span>, exportValue: (u) => u.downloadBytes },
    { key: "up", header: "Upload", align: "right", cell: (u) => <span className="tnum text-xs">{formatBytes(u.uploadBytes)}</span>, exportValue: (u) => u.uploadBytes },
    { key: "login", header: "Login", align: "right", hideBelow: "md", cell: (u) => <span className="whitespace-nowrap text-xs text-fg-muted">{relativeTime(u.loginTime)}</span>, exportValue: (u) => formatDateTime(u.loginTime) },
    { key: "uptime", header: "Uptime", align: "right", cell: (u) => <span className="tnum text-xs">{formatUptime(u.uptimeSec)}</span>, exportValue: (u) => formatUptime(u.uptimeSec) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value={<StatusBadge status={health.status} />} tone={health.status === "Online" ? "success" : "danger"} icon={CircleCheck} />
        <StatCard label="CPU Load" value={health.cpu === undefined ? "—" : `${health.cpu.toFixed(1)}%`} tone="brand" icon={Zap} />
        <StatCard label="Memory Used" value={health.ram === undefined ? "—" : `${health.ram.toFixed(1)}%`} tone="warning" icon={Server} />
        <StatCard label="Uptime" value={formatUptime(health.uptimeSec)} tone="neutral" icon={RefreshCcw} />
      </div>

      {health.error ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardBody>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Adapter notice</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{health.error}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Device" description={`Reported by ${adapterName}`} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Name", router.name],
              ["Model", router.model ?? "—"],
              ["IP address", router.ipAddress],
              ["Location", router.location ?? "—"],
              ["Area", router.area?.name ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
                <dd className="mt-0.5 text-sm">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Active PPPoE Sessions" description={`${users.length} live session(s) on this router`} icon={<Users />} />
        <CardBody className="p-0">
          <DataTableShell
            columns={columns}
            rows={users}
            rowKey={(u) => u.username}
            compact
            className="border-0"
            toolbar={<TableToolbar searchPlaceholder="Search session..." />}
            empty={<EmptyState icon={<Unplug />} title="No active sessions" description="Sessions reported by the router appear here." />}
          />
        </CardBody>
      </Card>
    </div>
  );
}
