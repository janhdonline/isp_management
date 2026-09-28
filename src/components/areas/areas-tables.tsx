"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { DataTableShell, TableToolbar, ExportCsvButton, FilterSelect, Column } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { DropdownMenu } from "@/components/ui/dropdown";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

export type AreaRow = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  zone: { id: string; name: string } | null;
  customers: number;
  active: number;
  online: number;
  due: number;
};

export type ZoneRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  areaCount: number;
  customerCount: number;
  activeCount: number;
  onlineCount: number;
};

export function AreasTable({
  rows,
  zones,
}: {
  rows: AreaRow[];
  zones: { id: string; name: string }[];
}) {
  const searchParams = useSearchParams();
  const hasFilters = Array.from(searchParams.keys()).some((k) => !["page", "perPage"].includes(k));

  const columns: Column<AreaRow>[] = [
    {
      key: "name",
      header: "Area",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/areas?areaId=${r.id}`} className="block truncate font-medium hover:text-brand-600">
            {r.name}
          </Link>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.code ?? "—"}</span>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: "zone",
      header: "Zone",
      hideBelow: "sm",
      cell: (r) => (r.zone ? <Badge>{r.zone.name}</Badge> : <span className="text-xs text-fg-subtle">Unzoned</span>),
      exportValue: (r) => r.zone?.name ?? "",
    },
    { key: "customers", header: "Customers", align: "right", cell: (r) => <span className="tnum text-xs font-medium">{formatNumber(r.customers)}</span>, exportValue: (r) => r.customers },
    { key: "active", header: "Active", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{r.active}</span>, exportValue: (r) => r.active },
    { key: "online", header: "Online", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs text-sky-600 dark:text-sky-400">{r.online}</span>, exportValue: (r) => r.online },
    { key: "due", header: "Due", align: "right", cell: (r) => <span className={`tnum text-xs font-medium ${r.due > 0 ? "text-red-600 dark:text-red-400" : "text-fg-subtle"}`}>{formatCurrency(r.due)}</span>, exportValue: (r) => r.due },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: "actions", header: "", align: "right", width: "52px", cell: (r) => <AreaRowActions row={r} zones={zones} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder="Search area name or code..."
          filters={
            <>
              <FilterSelect param="status" placeholder="All statuses" options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} />
              <FilterSelect param="zoneId" placeholder="All zones" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="areas" />
              <AddButton />
            </div>
          }
        />
      }
      empty={
        hasFilters ? (
          <p className="px-4 py-12 text-center text-sm text-fg-muted">No areas match your filters.</p>
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium">No areas yet</p>
            <p className="mt-1 text-xs text-fg-muted">Create areas and zones to organise your coverage.</p>
          </div>
        )
      }
    />
  );
}

function AddButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        <Plus className="size-4" /> Add Area
      </button>
      <SimpleFormModal
        open={open}
        onClose={() => setOpen(false)}
        kind="area"
        title="Add area"
        description="Areas are the billing and coverage unit used across the whole system."
      />
    </>
  );
}

export function AreaRowActions({ row, zones }: { row: AreaRow; zones: { id: string; name: string }[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "edit" | "delete">(null);
  return (
    <>
      <DropdownMenu
        items={[
          { label: "View customers", onSelect: () => router.push(`/customers?areaId=${row.id}`) },
          { label: "Edit", icon: <Pencil />, onSelect: () => setDialog("edit") },
          "separator",
          { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setDialog("delete") },
        ]}
        trigger={<MoreHorizontal className="size-4" />}
      />
      <SimpleFormModal
        open={dialog === "edit"}
        onClose={() => setDialog(null)}
        kind="area"
        title={`Edit ${row.name}`}
        defaults={{ name: row.name, code: row.code ?? "", zoneId: row.zone?.id ?? "", status: row.status }}
        zones={zones}
        id={row.id}
      />
      <SimpleFormModal
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        kind="delete"
        title="Delete area?"
        description={`${row.name} can only be deleted when it has no customers assigned.`}
        id={row.id}
        name={row.name}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

export function ZonesTable({ rows }: { rows: ZoneRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const columns: Column<ZoneRow>[] = [
    {
      key: "name",
      header: "Zone",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          {r.description ? <span className="block truncate text-[11px] text-fg-subtle">{r.description}</span> : null}
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "areas", header: "Areas", align: "right", cell: (r) => <span className="tnum text-xs">{r.areaCount}</span>, exportValue: (r) => r.areaCount },
    { key: "customers", header: "Customers", align: "right", cell: (r) => <span className="tnum text-xs font-medium">{formatNumber(r.customerCount)}</span>, exportValue: (r) => r.customerCount },
    { key: "active", header: "Active", align: "right", hideBelow: "md", cell: (r) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{r.activeCount}</span>, exportValue: (r) => r.activeCount },
    { key: "online", header: "Online", align: "right", hideBelow: "lg", cell: (r) => <span className="tnum text-xs text-sky-600 dark:text-sky-400">{r.onlineCount}</span>, exportValue: (r) => r.onlineCount },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "52px",
      cell: (r) => (
        <DropdownMenu
          items={[
            { label: "View areas", onSelect: () => router.push(`/areas?zoneId=${r.id}`) },
            { label: "Edit", icon: <Pencil />, onSelect: () => setEditing(r) },
          ]}
          trigger={<MoreHorizontal className="size-4" />}
        />
      ),
    },
  ];

  const [editing, setEditing] = useState<ZoneRow | null>(null);

  return (
    <>
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        toolbar={
          <TableToolbar
            searchPlaceholder="Search zones..."
            actions={
              <button
                onClick={() => setOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Plus className="size-4" /> Add Zone
              </button>
            }
          />
        }
        empty={<p className="px-4 py-12 text-center text-sm text-fg-muted">No zones yet. Create a zone to group your areas.</p>}
      />

      <SimpleFormModal open={open} onClose={() => setOpen(false)} kind="zone" title="Add zone" description="Zones group areas for reporting and coverage planning." />
      <SimpleFormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        kind="zone"
        title={`Edit ${editing?.name ?? "zone"}`}
        defaults={{ name: editing?.name ?? "", description: editing?.description ?? "", status: editing?.status ?? "Active" }}
        id={editing?.id}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Simple CRUD modal shared by areas / zones                           */
/* ------------------------------------------------------------------ */

type Kind = "area" | "zone" | "delete";

export function SimpleFormModal({
  open,
  onClose,
  kind,
  title,
  description,
  defaults,
  zones,
  id,
  name,
}: {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  title: string;
  description?: string;
  defaults?: { name?: string; code?: string; zoneId?: string; status?: string; description?: string };
  zones?: { id: string; name: string }[];
  id?: string;
  name?: string;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const fd = new FormData(e.currentTarget);
    try {
      const { createAreaAction, updateAreaAction, createZoneAction, updateZoneAction, deleteAreaAction, deleteZoneAction } =
        await import("@/app/(app)/areas/actions");

      let res;
      if (kind === "area") res = id ? await updateAreaAction(id, Object.fromEntries(fd)) : await createAreaAction(Object.fromEntries(fd));
      else if (kind === "zone") res = id ? await updateZoneAction(id, Object.fromEntries(fd)) : await createZoneAction(Object.fromEntries(fd));
      else res = await (name === undefined ? deleteZoneAction : deleteAreaAction)(id!);

      if (res.formError) error(res.formError);
      else {
        success(res.success ?? "Saved");
        onClose();
        startTransition(() => router.refresh());
      }
    } catch (err) {
      error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (kind === "delete") {
    return (
      <ConfirmDialog
        open={open}
        onClose={onClose}
        onConfirm={async () => {
          setBusy(true);
          const { deleteAreaAction, deleteZoneAction } = await import("@/app/(app)/areas/actions");
          const res = name === undefined ? await deleteZoneAction(id!) : await deleteAreaAction(id!);
          setBusy(false);
          if (res.formError) error(res.formError);
          else {
            success(res.success ?? "Deleted");
            onClose();
            startTransition(() => router.refresh());
          }
        }}
        title={title}
        description={description}
        confirmLabel="Delete"
        loading={busy}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="simple-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="simple-form" onSubmit={submit} className="space-y-4">
        <Field label={kind === "area" ? "Area name" : "Zone name"} required error={errors.name}>
          <Input name="name" defaultValue={defaults?.name} invalid={!!errors.name} />
        </Field>
        {kind === "area" ? (
          <>
            <Field label="Code" error={errors.code} hint="Short code used in reports">
              <Input name="code" defaultValue={defaults?.code} placeholder="AR-001" />
            </Field>
            <Field label="Zone" error={errors.zoneId}>
              <Select name="zoneId" defaultValue={defaults?.zoneId ?? ""} placeholder="No zone" options={(zones ?? []).map((z) => ({ value: z.id, label: z.name }))} />
            </Field>
          </>
        ) : (
          <Field label="Description">
            <Textarea name="description" rows={2} defaultValue={defaults?.description} />
          </Field>
        )}
        <Field label="Status">
          <Select name="status" defaultValue={defaults?.status ?? "Active"} options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} />
        </Field>
      </form>
    </Modal>
  );
}
