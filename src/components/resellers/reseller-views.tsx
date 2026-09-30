"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Handshake, Plus, Trash2 } from "lucide-react";
import {
  createResellerAction,
  updateResellerAction,
  deleteResellerAction,
  type ResellerFormState,
} from "@/app/(app)/resellers/actions";

export type Reseller = {
  id: string;
  name: string;
  phone: string | null;
  areaId: string | null;
  areaName: string | null;
  commissionPct: number;
  status: string;
  customers: number;
  collected: number;
};

type Area = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

function Alert({ state }: { state?: ResellerFormState }) {
  if (!state?.formError && !state?.success) return null;
  const bad = Boolean(state.formError);
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        bad
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      }`}
    >
      {state.formError ?? state.success}
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? "Saving..." : label}
    </Button>
  );
}

/**
 * Only the editable fields. The derived columns (customer count, collected)
 * deliberately have no place in a form — a value that is computed elsewhere
 * should never be something a person can type.
 */
export type ResellerEditable = Pick<
  Reseller,
  "id" | "name" | "phone" | "areaId" | "commissionPct" | "status"
>;

export function ResellerForm({
  areas,
  reseller,
}: {
  areas: Area[];
  reseller?: ResellerEditable;
}) {
  const action = reseller ? updateResellerAction : createResellerAction;
  const [state, formAction] = useActionState(action, {} as ResellerFormState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {reseller ? <input type="hidden" name="id" value={reseller.id} /> : null}
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={state.errors?.name?.[0]}>
          <Input name="name" defaultValue={reseller?.name} required placeholder="Karim Uddin, Mirpur" />
        </Field>
        <Field label="Phone" error={state.errors?.phone?.[0]}>
          <Input name="phone" defaultValue={reseller?.phone ?? ""} placeholder="017…" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Area" error={state.errors?.areaId?.[0]} hint="Optional — where they collect.">
          <Select name="areaId" defaultValue={reseller?.areaId ?? ""}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Commission %"
          error={state.errors?.commissionPct?.[0]}
          hint="Percentage of cash collected that is owed to them."
        >
          <Input
            name="commissionPct"
            type="number"
            step="0.01"
            min={0}
            max={100}
            defaultValue={reseller?.commissionPct ?? 5}
          />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={reseller?.status ?? "Active"}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </div>

      <div className="flex justify-end">
        <Submit label={reseller ? "Save changes" : "Add reseller"} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function ResellerTable({ rows, areas }: { rows: Reseller[]; areas: Area[] }) {
  const [editing, setEditing] = useState<Reseller | null>(null);

  const columns: Column<Reseller>[] = [
    {
      key: "name",
      header: "Reseller",
      cell: (r) => (
        <div>
          <Link href={`/resellers/${r.id}`} className="text-sm font-medium hover:text-brand-600">
            {r.name}
          </Link>
          {r.phone ? <p className="text-[11px] text-fg-subtle">{r.phone}</p> : null}
        </div>
      ),
      exportValue: (r) => r.name,
    },
    { key: "area", header: "Area", hideBelow: "sm", cell: (r) => <span className="text-xs">{r.areaName ?? "—"}</span>, exportValue: (r) => r.areaName ?? "" },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      cell: (r) => <span className="tnum text-xs">{r.commissionPct}%</span>,
      exportValue: (r) => r.commissionPct,
    },
    {
      key: "customers",
      header: "Customers",
      align: "right",
      hideBelow: "md",
      cell: (r) => <span className="tnum text-xs">{formatNumber(r.customers)}</span>,
      exportValue: (r) => r.customers,
    },
    {
      key: "collected",
      header: "Collected (all time)",
      align: "right",
      cell: (r) => <span className="tnum text-xs font-medium">{formatCurrency(r.collected)}</span>,
      exportValue: (r) => r.collected,
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "90px",
      cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty="No resellers yet. Add one to start attributing zone collections."
      />
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ""}
        icon={<Handshake className="size-4" />}
      >
        {editing ? <ResellerForm areas={areas} reseller={editing} /> : null}
      </Modal>
    </>
  );
}

export function NewResellerButton({ areas }: { areas: Area[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>
        New Reseller
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New reseller"
        description="Someone who collects cash in a zone on your behalf. Commission is a percentage of what they collect."
        icon={<Plus className="size-4" />}
        size="lg"
      >
        <ResellerForm areas={areas} />
      </Modal>
    </>
  );
}

export function DeleteResellerButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} icon={<Trash2 className="size-4" />}>
        Delete reseller
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${name}?`}
        description="Only possible when no customers and no payments point at them. A reseller who has stopped working should be set to Inactive instead, so their collections stay attributed."
        confirmLabel="Delete"
        onConfirm={async () => {
          const result = await deleteResellerAction(id);
          if (result?.error) {
            setError(result.error);
            setOpen(false);
          }
        }}
      />
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </>
  );
}