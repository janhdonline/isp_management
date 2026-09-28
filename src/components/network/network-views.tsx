"use client";

import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { DataTableShell, TableToolbar, ExportCsvButton, FilterSelect, Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { BarChartView, DonutChart, ChartLegend } from "@/components/ui/charts";
import * as React from "react";
import { useToast } from "@/components/providers";
import { ConfirmDialog } from "@/components/ui/modal";
import { formatBytes, formatDateTime, relativeTime } from "@/lib/utils";
import { Unplug, Wifi, WifiOff, TrendingUp, Gauge, Users } from "lucide-react";

export type OnlineRow = {
  id: string;
  username: string;
  name: string;
  ipAddress: string | null;
  macAddress: string | null;
  downloadBytes: number;
  uploadBytes: number;
  loginTime: Date | null;
  package: { name: string; downloadSpeed: number } | null;
  area: { name: string } | null;
  router: { name: string } | null;
};

/* ================================================================== */
/* Online users                                                        */
/* ================================================================== */

export function OnlineUsersTable({
  rows,
  areas,
  packages,
  pagination,
}: {
  rows: OnlineRow[];
  areas: { id: string; name: string }[];
  packages: { id: string; name: string }[];
  pagination?: React.ReactNode;
}) {
  const { success, error } = useToast();

  const columns: Column<OnlineRow>[] = [
    { key: "username", header: "Username", cell: (r) => <span className="font-mono text-xs font-medium">{r.username}</span>, exportValue: (r) => r.username },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/customers/${r.id}`} className="block truncate font-medium hover:text-brand-600">
            {r.name}
          </Link>
          <span className="block truncate text-[11px] text-fg-subtle">{r.area?.name ?? "—"}</span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "ip", header: "IP", hideBelow: "sm", cell: (r) => <span className="font-mono text-xs">{r.ipAddress ?? "—"}</span>, exportValue: (r) => r.ipAddress ?? "" },
    { key: "mac", header: "MAC", hideBelow: "xl", cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.macAddress ?? "—"}</span>, exportValue: (r) => r.macAddress ?? "" },
    { key: "package", header: "Package", hideBelow: "lg", cell: (r) => <span className="text-xs">{r.package?.name ?? "—"}</span>, exportValue: (r) => r.package?.name ?? "" },
    { key: "down", header: "Download", align: "right", cell: (r) => <span className="tnum text-xs">{formatBytes(r.downloadBytes)}</span>, exportValue: (r) => r.downloadBytes },
    { key: "up", header: "Upload", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs">{formatBytes(r.uploadBytes)}</span>, exportValue: (r) => r.uploadBytes },
    { key: "router", header: "Router", hideBelow: "xl", cell: (r) => <span className="text-xs text-fg-muted">{r.router?.name ?? "—"}</span>, exportValue: (r) => r.router?.name ?? "" },
    { key: "login", header: "Login Time", align: "right", cell: (r) => <span className="whitespace-nowrap text-xs text-fg-muted">{relativeTime(r.loginTime)}</span>, exportValue: (r) => (r.loginTime ? formatDateTime(r.loginTime) : "") },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (r) => (
        <DisconnectButton
          id={r.id}
          username={r.username}
          onDone={(msg, errMsg) => {
            if (errMsg) error(errMsg);
            else success(msg);
          }}
        />
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search username, customer, IP, MAC..."
          filters={
            <>
              <FilterWrapper param="areaId" placeholder="All areas" options={areas} />
              <FilterWrapper param="packageId" placeholder="All packages" options={packages} width="w-40" />
            </>
          }
          actions={<ExportCsvButton rows={rows} columns={columns} filename="network-online" />}
        />
      }
      pagination={pagination}
      empty={<EmptyState icon={<WifiOff />} title="Nobody is online" description="Live sessions appear as soon as customers connect." />}
    />
  );
}

function FilterWrapper({
  param,
  placeholder,
  options,
  width,
}: {
  param: string;
  placeholder: string;
  options: { id: string; name: string }[];
  width?: string;
}) {
  return (
    <FilterSelect
      param={param}
      placeholder={placeholder}
      options={options.map((o) => ({ value: o.id, label: o.name }))}
      width={width}
    />
  );
}

function DisconnectButton({
  id,
  username,
  onDone,
}: {
  id: string;
  username: string;
  onDone: (msg: string, errMsg?: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs font-medium transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
      >
        <Unplug className="size-3" /> Disconnect
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        loading={busy}
        title={`Disconnect ${username}?`}
        description="The PPPoE session is terminated immediately. Billing and history are unaffected."
        onConfirm={async () => {
          setBusy(true);
          const { disconnectUserAction } = await import("@/app/(app)/network/actions");
          const r = await disconnectUserAction(id);
          setBusy(false);
          setOpen(false);
          if (r.formError) onDone("", r.formError);
          else onDone(r.success ?? "Disconnected");
        }}
      />
    </>
  );
}

/* ================================================================== */
/* Bandwidth                                                           */
/* ================================================================== */

export type BandwidthData = {
  hourly: { label: string; download: number; upload: number }[];
  byPackage: { label: string; down: number; up: number; users: number }[];
  topUsers: { id: string; name: string; username: string; package: string; total: number }[];
  metrics: { totalDownload: number; totalUpload: number; active: number; peak: number; average: number };
};

export function BandwidthView({ data }: { data: BandwidthData }) {
  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Download" value={formatBytes(data.metrics.totalDownload)} icon={TrendingUp} tone="brand" />
        <StatCard label="Total Upload" value={formatBytes(data.metrics.totalUpload)} icon={TrendingUp} tone="info" />
        <StatCard label="Peak Traffic" value={formatBytes(data.metrics.peak)} icon={Gauge} tone="warning" />
        <StatCard label="Average Traffic" value={formatBytes(data.metrics.average)} icon={Wifi} tone="neutral" />
      </StatCardGrid>

      <Card>
        <CardHeader title="Hourly Bandwidth" description="Session volume bucketed by login hour" icon={<Gauge />} />
        <CardBody>
          {data.hourly.some((h) => h.download > 0 || h.upload > 0) ? (
            <BarChartView
              data={data.hourly}
              series={[
                { key: "download", label: "Download", color: "#3163ff" },
                { key: "upload", label: "Upload", color: "#10b981" },
              ]}
              xKey="label"
              height={260}
            />
          ) : (
            <EmptyState title="No traffic recorded" description="Bandwidth appears once sessions carry data." />
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Traffic by Package" description="Which plans consume the most" icon={<TrendingUp />} />
          <CardBody>
            {data.byPackage.length ? (
              <>
                <DonutChart data={data.byPackage.map((p, i) => ({ label: p.label, value: p.down + p.up, color: PALETTE[i % PALETTE.length] }))} />
                <ChartLegend data={data.byPackage.map((p, i) => ({ label: p.label, value: p.down + p.up, color: PALETTE[i % PALETTE.length] }))} />
              </>
            ) : (
              <EmptyState title="No package traffic" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top Users" description="Heaviest consumers right now" icon={<Users />} />
          <CardBody className="p-0">
            {data.topUsers.length ? (
              <ol className="divide-y divide-[var(--border)]">
                {data.topUsers.map((u, i) => (
                  <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="tnum w-5 text-xs font-semibold text-fg-subtle">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/customers/${u.id}`} className="block truncate font-medium hover:text-brand-600">
                        {u.name}
                      </Link>
                      <span className="block truncate font-mono text-[11px] text-fg-subtle">{u.username} · {u.package}</span>
                    </div>
                    <span className="tnum shrink-0 text-xs font-semibold">{formatBytes(u.total)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No active consumers" />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const PALETTE = ["#3163ff", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6", "#a855f7"];
