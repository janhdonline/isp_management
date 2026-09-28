"use client";

import Link from "next/link";
import { DataTableShell, TableToolbar, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";

export type RouterSummary = {
  id: string;
  name: string;
  ipAddress: string;
  model: string | null;
  location: string | null;
  status: string;
  onlineUsers: number;
};

export type OltSummary = {
  id: string;
  name: string;
  vendor: string | null;
  ponPorts: number;
  onlineOnu: number;
  offlineOnu: number;
  status: string;
};

export function RouterSummaryTable({ rows }: { rows: RouterSummary[] }) {
  const columns: Column<RouterSummary>[] = [
    {
      key: "name",
      header: "Router",
      cell: (r) => (
        <Link href={`/network/routers/${r.id}`} className="font-medium hover:text-brand-600">
          {r.name}
        </Link>
      ),
      exportValue: (r) => r.name,
    },
    { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs">{r.ipAddress}</span>, exportValue: (r) => r.ipAddress },
    { key: "model", header: "Model", hideBelow: "lg", cell: (r) => <span className="text-xs text-fg-muted">{r.model ?? "—"}</span>, exportValue: (r) => r.model ?? "" },
    { key: "location", header: "Location", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.location ?? "—"}</span>, exportValue: (r) => r.location ?? "" },
    { key: "online", header: "Online", align: "right", cell: (r) => <span className="tnum text-xs font-semibold text-emerald-600 dark:text-emerald-400">{r.onlineUsers}</span>, exportValue: (r) => r.onlineUsers },
    { key: "status", header: "Status", align: "right", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      compact
      className="border-0"
      toolbar={<TableToolbar searchPlaceholder="Search routers..." />}
      empty={<EmptyState title="No routers yet" />}
    />
  );
}

export function OltSummaryTable({ rows }: { rows: OltSummary[] }) {
  const columns: Column<OltSummary>[] = [
    { key: "name", header: "OLT", cell: (o) => <span className="font-medium">{o.name}</span>, exportValue: (o) => o.name },
    { key: "vendor", header: "Vendor", hideBelow: "sm", cell: (o) => <span className="text-xs text-fg-muted">{o.vendor ?? "—"}</span>, exportValue: (o) => o.vendor ?? "" },
    { key: "pon", header: "PON", align: "right", cell: (o) => <span className="tnum text-xs">{o.ponPorts}</span>, exportValue: (o) => o.ponPorts },
    { key: "online", header: "Online ONU", align: "right", cell: (o) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{o.onlineOnu}</span>, exportValue: (o) => o.onlineOnu },
    { key: "offline", header: "Offline ONU", align: "right", cell: (o) => <span className="tnum text-xs text-red-600 dark:text-red-400">{o.offlineOnu}</span>, exportValue: (o) => o.offlineOnu },
    { key: "status", header: "Status", align: "right", cell: (o) => <StatusBadge status={o.status} />, exportValue: (o) => o.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(o) => o.id}
      compact
      className="border-0"
      toolbar={<TableToolbar searchPlaceholder="Search OLTs..." />}
      empty={<EmptyState title="No OLTs yet" />}
    />
  );
}
