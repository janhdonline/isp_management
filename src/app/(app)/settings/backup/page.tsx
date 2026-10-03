import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSettings, redactSecrets } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { SettingsForm, BackupNowButton, SettingField } from "@/components/settings/settings-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Pagination } from "@/components/ui/data-table";
import { formatDateTime, formatBytes, formatNumber } from "@/lib/utils";
import { BackupsTable } from "@/components/settings/backups-table";
import { Database, Clock, HardDrive } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Backup" };

const FIELDS: SettingField[] = [
  { key: "backup.schedule", label: "Backup Schedule", type: "select", options: ["Daily", "Weekly", "Monthly", "Manual"] },
  { key: "backup.time", label: "Backup Time", hint: "24h HH:MM" },
  { key: "backup.retention", label: "Keep Last N Backups", type: "number" },
];

export default async function BackupSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const perPage = 10;

  const [settings, backups, total] = await Promise.all([
    getSettings(),
    prisma.backup.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.backup.count(),
  ]);

  const last = backups[0];
  const totalSize = backups.reduce((s, b) => s + b.size, 0);


  return (
    <>
      <PageHeader
        title="Backup & Restore"
        description="Schedule database snapshots and review previous runs."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Backup" }]}
        actions={<BackupNowButton />}
      />
      <PageContainer className="max-w-4xl">
        <StatCardGrid>
          <StatCard label="Last Backup" value={last ? formatDateTime(last.createdAt) : "Never"} icon={Clock} tone="brand" />
          <StatCard label="Backup Size" value={formatBytes(last?.size ?? 0)} icon={HardDrive} tone="info" />
          <StatCard label="Total Backups" value={formatNumber(total)} icon={Database} tone="neutral" />
          <StatCard label="Total Size" value={formatBytes(totalSize)} icon={HardDrive} tone="warning" />
        </StatCardGrid>

        <div className="mt-4">
          <SettingsForm fields={FIELDS} values={redactSecrets(settings)} title="Schedule" description="Automatic snapshots run on the configured schedule and are pruned to the retention count." />
        </div>

        <Card className="mt-4">
          <CardHeader title="Backup history" description="Manual and automatic snapshots" icon={<Database />} />
          <CardBody className="p-0">
            <BackupsTable
              rows={backups.map((b) => ({
                id: b.id,
                fileName: b.fileName,
                size: b.size,
                type: b.type,
                status: b.status,
                createdAt: b.createdAt,
                createdBy: b.createdBy,
              }))}
              pagination={
                <Pagination
                  page={page}
                  perPage={perPage}
                  total={total}
                  totalPages={Math.max(1, Math.ceil(total / perPage))}
                />
              }
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
