"use client";

import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTableShell, TableToolbar, Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { formatNumber } from "@/lib/utils";
import { MapPin, Radio, RouterIcon, Server, Users } from "lucide-react";

export type CoverageArea = {
  id: string;
  name: string;
  zone: string;
  status: string;
  customers: number;
  routers: { id: string; name: string; location: string | null; status: string }[];
  olts: { id: string; name: string; location: string | null; status: string; ponPorts: number }[];
  onus: number;
};

export function CoverageView({ areas }: { areas: CoverageArea[] }) {
  const totalRouters = areas.reduce((s, a) => s + a.routers.length, 0);
  const totalOlts = areas.reduce((s, a) => s + a.olts.length, 0);
  const totalOnus = areas.reduce((s, a) => s + a.onus, 0);
  const totalCustomers = areas.reduce((s, a) => s + a.customers, 0);

  const columns: Column<CoverageArea>[] = [
    {
      key: "name",
      header: "Area",
      cell: (a) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{a.name}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{a.zone}</span>
        </div>
      ),
      exportValue: (a) => a.name,
    },
    { key: "customers", header: "Customers", align: "right", cell: (a) => <span className="tnum text-xs font-medium">{formatNumber(a.customers)}</span>, exportValue: (a) => a.customers },
    { key: "routers", header: "Routers", align: "right", cell: (a) => <span className="tnum text-xs">{a.routers.length}</span>, exportValue: (a) => a.routers.length },
    { key: "olts", header: "OLTs", align: "right", cell: (a) => <span className="tnum text-xs">{a.olts.length}</span>, exportValue: (a) => a.olts.length },
    { key: "onus", header: "ONUs", align: "right", cell: (a) => <span className="tnum text-xs">{a.onus}</span>, exportValue: (a) => a.onus },
    {
      key: "devices",
      header: "Device health",
      hideBelow: "lg",
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.routers.map((r) => (
            <Badge key={r.id} tone={r.status === "Online" ? "success" : "neutral"}>
              {r.name}
            </Badge>
          ))}
          {a.olts.map((o) => (
            <Badge key={o.id} tone={o.status === "Online" ? "success" : "neutral"}>
              {o.name}
            </Badge>
          ))}
          {a.routers.length + a.olts.length === 0 ? <span className="text-xs text-fg-subtle">—</span> : null}
        </div>
      ),
      exportValue: (a) => [...a.routers.map((r) => `${r.name}:${r.status}`), ...a.olts.map((o) => `${o.name}:${o.status}`)].join("; "),
    },
    { key: "status", header: "Status", align: "right", cell: (a) => <StatusBadge status={a.status} />, exportValue: (a) => a.status },
  ];

  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Covered Areas" value={formatNumber(areas.length)} icon={MapPin} tone="brand" />
        <StatCard label="Customers Covered" value={formatNumber(totalCustomers)} icon={Users} tone="info" />
        <StatCard label="Routers Placed" value={formatNumber(totalRouters)} icon={RouterIcon} tone="success" />
        <StatCard label="OLTs / ONUs" value={`${totalOlts} / ${totalOnus}`} icon={Server} tone="neutral" />
      </StatCardGrid>

      <Card>
        <CardHeader
          title="Coverage by area"
          description="Where your network sits and how many customers each area serves"
          icon={<Radio />}
        />
        <CardBody className="p-0">
          <DataTableShell
            columns={columns}
            rows={areas}
            rowKey={(a) => a.id}
            compact
            className="border-0"
            toolbar={<TableToolbar searchPlaceholder="Search area..." />}
            empty={<EmptyState title="No coverage data" description="Assign routers, OLTs and customers to areas to map coverage." />}
          />
        </CardBody>
      </Card>
    </div>
  );
}
