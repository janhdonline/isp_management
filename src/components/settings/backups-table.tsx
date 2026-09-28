"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DataTableShell,
  TableToolbar,
  ExportCsvButton,
  type Column,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/providers";
import { restoreBackupAction } from "@/app/(app)/accounts/actions";
import { formatDateTime, formatBytes } from "@/lib/utils";
import { Database, Download, RotateCcw } from "lucide-react";

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
  const router = useRouter();
  const { success, error } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  /**
   * A restore replaces every table, so it goes through an explicit confirmation
   * that names the file. The action re-checks `settings.approve` server-side.
   */
  const restore = async () => {
    if (!target) return;
    setBusy(true);
    const result = await restoreBackupAction(target);
    setBusy(false);
    setTarget(null);
    if (result.formError) error(result.formError);
    else {
      success(result.success ?? "Restored");
      startTransition(() => router.refresh());
    }
  };

  const columns: Column<BackupRow>[] = [
    {
      key: "file",
      header: "File",
      cell: (b) => (
        <span className="font-mono text-xs font-medium">{b.fileName}</span>
      ),
      exportValue: (b) => b.fileName,
    },
    {
      key: "size",
      header: "Size",
      align: "right",
      cell: (b) => <span className="tnum text-xs">{formatBytes(b.size)}</span>,
      exportValue: (b) => b.size,
    },
    {
      key: "type",
      header: "Type",
      cell: (b) => (
        <Badge tone={b.type === "Auto" ? "info" : "neutral"}>{b.type}</Badge>
      ),
      exportValue: (b) => b.type,
    },
    {
      key: "by",
      header: "Created by",
      hideBelow: "sm",
      cell: (b) => (
        <span className="text-xs text-fg-muted">
          {b.createdBy?.name ?? "System"}
        </span>
      ),
      exportValue: (b) => b.createdBy?.name ?? "System",
    },
    {
      key: "status",
      header: "Status",
      cell: (b) => (
        <Badge
          tone={
            b.status === "Failed"
              ? "danger"
              : b.status === "Restored"
                ? "info"
                : "success"
          }
        >
          {b.status}
        </Badge>
      ),
      exportValue: (b) => b.status,
    },
    {
      key: "date",
      header: "Date",
      align: "right",
      cell: (b) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">
          {formatDateTime(b.createdAt)}
        </span>
      ),
      exportValue: (b) => formatDateTime(b.createdAt),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "96px",
      cell: (b) =>
        b.status === "Failed" || b.fileName === "—" ? (
          <span className="text-[11px] text-fg-subtle">—</span>
        ) : (
          <div className="flex justify-end gap-1">
            <a
              href={`/api/backup/download?file=${encodeURIComponent(b.fileName)}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-[11px] font-medium hover:bg-[var(--surface-3)]"
              title={`Download ${b.fileName}`}
            >
              <Download className="size-3" />
              Get
            </a>
            <button
              onClick={() => setTarget(b.fileName)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-red-300 px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              title={`Restore from ${b.fileName}`}
            >
              <RotateCcw className="size-3" />
              Restore
            </button>
          </div>
        ),
    },
  ];

  return (
    <>
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={restore}
        title="Restore from this backup?"
        description={
          target ? (
            <>
              Every table will be replaced with the contents of{" "}
              <span className="font-mono text-xs">{target}</span>. Anything
              saved since that backup is lost, and anyone signed in will need to
              sign in again.
            </>
          ) : null
        }
        confirmLabel="Restore now"
        loading={busy}
      />
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        compact
        className="border-0"
        toolbar={
          <TableToolbar
            searchPlaceholder="Search backup file..."
            actions={
              <ExportCsvButton
                rows={rows}
                columns={columns}
                filename="backups"
              />
            }
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
    </>
  );
}
