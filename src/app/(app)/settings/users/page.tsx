import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Pagination } from "@/components/ui/data-table";
import { UsersTable, RolesTable, ActivityLogTable } from "@/components/settings/users-views";
import { parseListParams, startOfDayParam } from "@/lib/query";
import { DateRangeFilter } from "@/components/ui/date-filter";
import { formatNumber } from "@/lib/utils";
import { Users, Shield, KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "users";
  const p = parseListParams(sp);

  const [users, roles, logCount, permCount] = await Promise.all([
    prisma.user.findMany({
      include: { role: { select: { id: true, name: true, isSystem: true } }, _count: { select: { activityLogs: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.role.findMany({
      include: { _count: { select: { users: true, permissions: true } }, permissions: { select: { permission: { select: { key: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.activityLog.count(),
    prisma.permission.count(),
  ]);

  const base = `/settings/users`;
  const tabItems = [
    { value: "users", label: "User List", href: `${base}?tab=users`, count: users.length },
    { value: "roles", label: "Roles", href: `${base}?tab=roles`, count: roles.length },
    { value: "permissions", label: "Permissions", href: `${base}?tab=permissions` },
    { value: "logs", label: "Activity Logs", href: `${base}?tab=logs`, count: logCount },
  ];

  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Staff accounts, permission matrix and the full audit trail."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Users & Roles" }]}
      >
        <Tabs items={tabItems} />
      </PageHeader>

      <PageContainer>
        {tab === "users" ? (
          <div className="space-y-4">
            <StatCardGrid>
              <StatCard label="Total Users" value={formatNumber(users.length)} icon={Users} tone="brand" />
              <StatCard label="Active" value={formatNumber(users.filter((u) => u.status === "Active").length)} icon={Users} tone="success" />
              <StatCard label="Roles" value={formatNumber(roles.length)} icon={Shield} tone="info" />
              <StatCard label="Permissions Defined" value={formatNumber(permCount)} icon={KeyRound} tone="neutral" />
            </StatCardGrid>
            <UsersTable
              rows={users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                status: u.status,
                lastLoginAt: u.lastLoginAt,
                createdAt: u.createdAt,
                role: u.role,
                _count: u._count,
              }))}
            />
          </div>
        ) : null}

        {tab === "roles" ? (
          <RolesTable
            rows={roles.map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description,
              isSystem: r.isSystem,
              _count: r._count,
              permissions: r.permissions,
            }))}
          />
        ) : null}

        {tab === "permissions" ? <PermissionsMatrix roles={roles} /> : null}

        {tab === "logs" ? <ActivityLogs params={p} /> : null}
      </PageContainer>
    </>
  );
}

function PermissionsMatrix({ roles }: { roles: { id: string; name: string; permissions: { permission: { key: string } }[] }[] }) {
  const matrix = roles.map((r) => ({
    id: r.id,
    name: r.name,
    keys: new Set(r.permissions.map((p) => p.permission.key)),
  }));

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="mb-4 text-sm text-fg-muted">
        A filled dot means the role holds that permission. Permissions are enforced in both the server
        actions and the REST API.
      </p>
      <div className="space-y-6">
        {matrix.map((role) => (
          <div key={role.id}>
            <h3 className="mb-2 text-sm font-semibold">{role.name}</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from(role.keys).sort().map((k) => (
                <span key={k} className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function ActivityLogs({ params }: { params: ReturnType<typeof parseListParams> }) {
  const from = startOfDayParam(params.from);
  const to = startOfDayParam(params.to, true);
  const page = Math.max(1, params.page ?? 1);
  const perPage = params.perPage ?? 25;
  const where = {
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { actor: { select: { name: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return (
    <ActivityLogTable
      rows={rows.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        summary: l.summary,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt,
        actor: l.actor,
      }))}
      pagination={
        <Pagination page={page} perPage={perPage} total={total} totalPages={Math.max(1, Math.ceil(total / perPage))} />
      }
      filters={<DateRangeFilter />}
    />
  );
}
