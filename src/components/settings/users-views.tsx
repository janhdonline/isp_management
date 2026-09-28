"use client";

import { useState } from "react";
import { DataTableShell, TableToolbar, ExportCsvButton, Column } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, NoSearchResults } from "@/components/ui/states";
import { useSearchParams } from "next/navigation";
import { formatDateTime } from "@/lib/utils";
import { PERMISSION_RESOURCES, PERMISSION_ACTIONS } from "@/lib/enums";
import { Shield, Users, Clock } from "lucide-react";

/* ================================================================== */
/* Users                                                              */
/* ================================================================== */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  role: { id: string; name: string; isSystem: boolean } | null;
  _count: { activityLogs: number };
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "User",
      cell: (u) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{u.name}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{u.email}</span>
        </div>
      ),
      exportValue: (u) => u.name,
    },
    { key: "phone", header: "Phone", hideBelow: "sm", cell: (u) => <span className="tnum text-xs">{u.phone ?? "—"}</span>, exportValue: (u) => u.phone ?? "" },
    { key: "role", header: "Role", cell: (u) => <Badge tone={u.role?.name === "Administrator" ? "brand" : "neutral"}>{u.role?.name ?? "No role"}</Badge>, exportValue: (u) => u.role?.name ?? "" },
    { key: "lastLogin", header: "Last Login", align: "right", hideBelow: "md", cell: (u) => <span className="whitespace-nowrap text-xs text-fg-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</span>, exportValue: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never") },
    { key: "logs", header: "Actions Logged", align: "right", hideBelow: "xl", cell: (u) => <span className="tnum text-xs text-fg-muted">{u._count.activityLogs}</span>, exportValue: (u) => u._count.activityLogs },
    { key: "status", header: "Status", align: "right", cell: (u) => <StatusBadge status={u.status} />, exportValue: (u) => u.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(u) => u.id}
      compact
      toolbar={<TableToolbar searchPlaceholder="Search user, email..." actions={<ExportCsvButton rows={rows} columns={columns} filename="users" />} />}
      empty={<EmptyState icon={<Users />} title="No users" description="Create staff accounts to give your team access." />}
    />
  );
}

/* ================================================================== */
/* Roles                                                              */
/* ================================================================== */

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  _count: { users: number; permissions: number };
  permissions: { permission: { key: string } }[];
};

export function RolesTable({ rows }: { rows: RoleRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const columns: Column<RoleRow>[] = [
    {
      key: "name",
      header: "Role",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          {r.description ? <span className="block truncate text-[11px] text-fg-subtle">{r.description}</span> : null}
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "users", header: "Users", align: "right", cell: (r) => <span className="tnum text-xs">{r._count.users}</span>, exportValue: (r) => r._count.users },
    { key: "perms", header: "Permissions", align: "right", cell: (r) => <span className="tnum text-xs">{r._count.permissions}</span>, exportValue: (r) => r._count.permissions },
    { key: "system", header: "Type", cell: (r) => <Badge tone={r.isSystem ? "brand" : "neutral"}>{r.isSystem ? "System" : "Custom"}</Badge>, exportValue: (r) => (r.isSystem ? "System" : "Custom") },
    {
      key: "expand",
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={() => setExpanded((prev) => (prev === r.id ? null : r.id))}
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          {expanded === r.id ? "Hide" : "View permissions"}
        </button>
      ),
    },
  ];

  const detail = expanded ? rows.find((r) => r.id === expanded) : null;

  return (
    <div className="space-y-3">
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        compact
        toolbar={<TableToolbar searchPlaceholder="Search roles..." actions={<ExportCsvButton rows={rows} columns={columns} filename="roles" />} />}
        empty={<EmptyState icon={<Shield />} title="No roles" />}
      />
      {detail ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold">Permissions for {detail.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-fg-subtle">
                  <th className="py-2">Resource</th>
                  {PERMISSION_ACTIONS.map((a) => (
                    <th key={a} className="px-2 py-2 text-center">
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_RESOURCES.map((resource) => {
                  const keys = new Set(detail.permissions.map((p) => p.permission.key));
                  return (
                    <tr key={resource} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 font-medium">{resource}</td>
                      {PERMISSION_ACTIONS.map((action) => {
                        const on = keys.has(`${resource.toLowerCase()}.${action.toLowerCase()}`);
                        return (
                          <td key={action} className="px-2 py-1.5 text-center">
                            {on ? (
                              <span className="inline-block size-2 rounded-full bg-emerald-500" title="Allowed" />
                            ) : (
                              <span className="inline-block size-2 rounded-full bg-[var(--border-strong)]" title="Not allowed" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Activity log                                                       */
/* ================================================================== */

export type LogRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  ipAddress: string | null;
  createdAt: Date;
  actor: { name: string } | null;
};

export function ActivityLogTable({
  rows,
  pagination,
  filters,
}: {
  rows: LogRow[];
  pagination?: React.ReactNode;
  filters?: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const hasFilters = Array.from(searchParams.keys()).some((k) => !["page", "perPage"].includes(k));

  const columns: Column<LogRow>[] = [
    { key: "action", header: "Action", cell: (l) => <Badge>{l.action}</Badge>, exportValue: (l) => l.action },
    { key: "entity", header: "Entity", hideBelow: "sm", cell: (l) => <span className="text-xs text-fg-muted">{l.entity}</span>, exportValue: (l) => l.entity },
    { key: "summary", header: "Summary", cell: (l) => <span className="truncate text-sm">{l.summary}</span>, exportValue: (l) => l.summary },
    { key: "actor", header: "User", hideBelow: "md", cell: (l) => <span className="text-xs">{l.actor?.name ?? "System"}</span>, exportValue: (l) => l.actor?.name ?? "System" },
    { key: "ip", header: "IP", hideBelow: "xl", cell: (l) => <span className="font-mono text-[11px] text-fg-muted">{l.ipAddress ?? "—"}</span>, exportValue: (l) => l.ipAddress ?? "" },
    { key: "date", header: "Date", align: "right", cell: (l) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(l.createdAt)}</span>, exportValue: (l) => formatDateTime(l.createdAt) },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(l) => l.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search summary, action, user..."
          filters={filters}
          actions={<ExportCsvButton rows={rows} columns={columns} filename="activity-log" />}
        />
      }
      pagination={pagination}
      empty={hasFilters ? <NoSearchResults /> : <EmptyState icon={<Clock />} title="No activity yet" description="Every audited operation will be recorded here." />}
    />
  );
}
