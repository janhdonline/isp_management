"use client";

import { DataTableShell, TableToolbar, ExportCsvButton, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatBytes } from "@/lib/utils";
import { Database } from "lucide-react";

export type BackupRow = {
  id: string;
  fileName: string;
  size: number;
  type: string;
  status: string;
  createdAt: Date;
  createdBy: { name: string } | null;
};

export function BackupsTable({
  rows,
  pagination,
}: {
  rows: BackupRow[];
  pagination?: React.ReactNode;
}) {
  const columns: Column<BackupRow>[] = [
    {
      key: "file",
      header: "File",
      cell: (b) => <span className="font-mono text-xs font-medium">{b.fileName}</span>,
      exportValue: (b) => b.fileName,
    },
    {
      key: "size",
      header: "Size",
      align: "right",
      cell: (b) => <span className="tnum text-xs">{formatBytes(b.size)}</span>,
      exportValue: (b) => b.size,
    },
    { key: "type", header: "Type", cell: (b) => <Badge tone={b.type === "Auto" ? "info" : "neutral"}>{b.type}</Badge>, exportValue: (b) => b.type },
    {
      key: "by",
      header: "Created by",
      hideBelow: "sm",
      cell: (b) => <span className="text-xs text-fg-muted">{b.createdBy?.name ?? "System"}</span>,
      exportValue: (b) => b.createdBy?.name ?? "System",
    },
    { key: "status", header: "Status", cell: (b) => <Badge tone="success">{b.status}</Badge>, exportValue: (b) => b.status },
    {
      key: "date",
      header: "Date",
      align: "right",
      cell: (b) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(b.createdAt)}</span>,
      exportValue: (b) => formatDateTime(b.createdAt),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(b) => b.id}
      compact
      className="border-0"
      toolbar={
        <TableToolbar
          searchPlaceholder="Search backup file..."
          actions={<ExportCsvButton rows={rows} columns={columns} filename="backups" />}
        />
      }
      pagination={pagination}
      empty={
        <EmptyState
          icon={<Database />}
          title="No backups yet"
          description="Run a backup now or wait for the scheduled job to create the first snapshot."
        />
      }
    />
  );
}
