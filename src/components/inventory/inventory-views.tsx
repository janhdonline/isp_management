"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package as PackageIcon, Plus, Scale } from "lucide-react";
import { formatCurrency, formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { INVENTORY_CATEGORIES as CATEGORIES } from "@/lib/enums";
import {
  createItemAction,
  updateItemAction,
  movementAction,
  deleteItemAction,
  type FormState,
} from "@/app/(app)/inventory/actions";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Item = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitPrice: number | null;
  lowStock: boolean;
  value: number;
  updatedAt: Date;
};

type Movement = {
  id: string;
  type: string;
  quantity: number;
  note: string | null;
  reference: string | null;
  createdAt: Date;
  createdBy: { name: string } | null;
};

type Assigned = {
  id: string;
  serial: string;
  mac: string | null;
  status: string;
  assignedAt: Date;
  returnedAt: Date | null;
  customer: { id: string; name: string; username: string } | null;
  /** Present where the table is shown across several items; absent on an item's own page. */
  item?: { sku: string; name: string };
};

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Alert({ state }: { state?: FormState }) {
  if (!state?.formError && !state?.success) return null;
  const bad = Boolean(state.formError);
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        bad
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      )}
    >
      {state.formError ?? state.success}
    </div>
  );
}

function SubmitButton({ label, pendingLabel, icon }: { label: string; pendingLabel: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} icon={icon}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Item form — used for both create and edit                            */
/* ------------------------------------------------------------------ */

export function ItemForm({ item }: { item?: Item }) {
  const action = item ? updateItemAction : createItemAction;
  const [state, formAction] = useActionState(action, {} as FormState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={state.errors?.name?.[0]}>
          <Input name="name" defaultValue={item?.name} required placeholder="GPON ONT, 1G" />
        </Field>
        <Field
          label="SKU"
          required
          error={state.errors?.sku?.[0]}
          hint="The code on the box. Must be unique, and is stored uppercase."
        >
          <Input name="sku" defaultValue={item?.sku} required placeholder="ONT-1G-B" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required error={state.errors?.category?.[0]}>
          <Select name="category" defaultValue={item?.category ?? "ONU"}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit" error={state.errors?.unit?.[0]} hint="pcs, m, box…">
          <Input name="unit" defaultValue={item?.unit ?? "pcs"} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Reorder level"
          error={state.errors?.reorderLevel?.[0]}
          hint="Leave at 0 to switch the low-stock warning off for this item."
        >
          <Input
            name="reorderLevel"
            type="number"
            min={0}
            step={1}
            defaultValue={item?.reorderLevel ?? 0}
          />
        </Field>
        <Field label="Unit price" error={state.errors?.unitPrice?.[0]} hint="Optional. Used for stock value.">
          <Input
            name="unitPrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={item?.unitPrice ?? ""}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <SubmitButton
          label={item ? "Save changes" : "Add item"}
          pendingLabel={item ? "Saving..." : "Adding..."}
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Stock in / out dialog                                               */
/* ------------------------------------------------------------------ */

export function MovementDialog({
  item,
  open,
  onClose,
}: {
  item: Item;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(movementAction, {} as FormState);
  // The dialog is reused for every item, so it is keyed by item id from the
  // parent — which resets the choice and the result for free. Storing the type
  // and correcting it in an effect is the version that causes a second render
  // and, worse, briefly shows the previous item's type over the new one.
  const [type, setType] = useState<"IN" | "OUT" | "ADJUST">("IN");

  const isCount = type === "ADJUST";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${item.name} — record stock`}
      description={`Currently ${item.quantity} ${item.unit} on the shelf.`}
      icon={<PackageIcon className="size-4" />}
      size="sm"
    >
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="type" value={type} />
        <Alert state={state} />

        <Field label="What happened?">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { v: "IN", label: "Stock in", icon: <ArrowDownToLine className="size-3.5" /> },
                { v: "OUT", label: "Stock out", icon: <ArrowUpFromLine className="size-3.5" /> },
                { v: "ADJUST", label: "Count", icon: <Scale className="size-3.5" /> },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setType(o.v)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
                  type === o.v
                    ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-700)] dark:bg-[var(--brand-50)]"
                    : "border-[var(--border)] text-fg-muted hover:text-fg"
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label={isCount ? "How many are actually on the shelf?" : `How many ${item.unit}?`}
          required
          hint={
            isCount
              ? "Enter the counted total. The difference is what gets recorded."
              : type === "IN"
                ? "Added to the current balance."
                : `Cannot exceed the ${item.quantity} currently in stock.`
          }
        >
          <Input
            name="quantity"
            type="number"
            min={0}
            step={1}
            defaultValue={isCount ? item.quantity : 1}
            key={`${item.id}-${type}`}
            required
            autoFocus
          />
        </Field>

        <Field label="Reference" hint="Purchase order number, or who it went to.">
          <Input name="reference" placeholder="PO-2291" />
        </Field>

        <Field label="Note">
          <Textarea name="note" rows={2} placeholder="Optional" />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton label="Record" pendingLabel="Recording..." />
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The items table                                                     */
/* ------------------------------------------------------------------ */

export function InventoryTable({ rows }: { rows: Item[] }) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Item",
      cell: (r) => (
        <div>
          <Link href={`/inventory/${r.id}`} className="text-sm font-medium hover:text-brand-600">
            {r.name}
          </Link>
          <p className="font-mono text-[11px] text-fg-subtle">{r.sku}</p>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: "sku",
      header: "SKU",
      hideBelow: "md",
      cell: (r) => <span className="font-mono text-[11px] text-fg-subtle">{r.sku}</span>,
      exportValue: (r) => r.sku,
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "sm",
      cell: (r) => <span className="text-xs">{r.category}</span>,
      exportValue: (r) => r.category,
    },
    {
      key: "quantity",
      header: "In stock",
      align: "right",
      // The number an operator is looking for, so a short shelf is visible
      // without reading the reorder column.
      cell: (r) => (
        <span className={cn("tnum text-sm font-medium", r.lowStock && "text-red-600 dark:text-red-400")}>
          {formatNumber(r.quantity)}{" "}
          <span className="text-[11px] font-normal text-fg-subtle">{r.unit}</span>
        </span>
      ),
      exportValue: (r) => r.quantity,
    },
    {
      key: "reorder",
      header: "Reorder at",
      align: "right",
      hideBelow: "lg",
      cell: (r) => (
        <span className="tnum text-xs text-fg-subtle">
          {r.reorderLevel > 0 ? formatNumber(r.reorderLevel) : "—"}
        </span>
      ),
      exportValue: (r) => r.reorderLevel,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.lowStock ? (
          <StatusBadge status="Low stock" />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            In stock
          </span>
        ),
      exportValue: (r) => (r.lowStock ? "Low stock" : "In stock"),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      hideBelow: "xl",
      cell: (r) => <span className="tnum text-xs">{r.unitPrice ? formatCurrency(r.value) : "—"}</span>,
      exportValue: (r) => r.value,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" onClick={() => setMoving(r)}>
            Stock
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        // A short shelf is tinted rather than merely badged: a column of amber
        // badges reads as decoration, a column of tinted rows reads as a problem.
        rowClassName={(r) => (r.lowStock ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined)}
        empty="No inventory items yet. Add the equipment you buy and hand out."
      />

      {/* Keyed by item so the movement type and any previous result reset when a
          different item is opened. */}
      {moving ? (
        <MovementDialog key={moving.id} item={moving} open onClose={() => setMoving(null)} />
      ) : null}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ""}
        icon={<PackageIcon className="size-4" />}
        size="md"
      >
        {editing ? <ItemForm item={editing} /> : null}
      </Modal>
    </>
  );
}

export function NewItemButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>
        New Item
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New inventory item"
        description="What you buy and hand out. Stock is set with a movement afterwards, not here."
        icon={<Plus className="size-4" />}
        size="md"
      >
        <ItemForm />
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Low-stock banner                                                    */
/* ------------------------------------------------------------------ */

export function LowStockNotice({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">
          {items.length} item{items.length === 1 ? "" : "s"} at or below the reorder level
        </p>
        <p className="mt-0.5 text-xs">
          {items
            .slice(0, 6)
            .map((i) => `${i.name} (${i.quantity} ${i.unit})`)
            .join(", ")}
          {items.length > 6 ? `, and ${items.length - 6} more` : ""}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

export function MovementHistory({ movements }: { movements: Movement[] }) {
  const columns: Column<Movement>[] = [
    {
      key: "type",
      header: "Movement",
      cell: (m) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            m.quantity > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
          )}
        >
          {m.quantity > 0 ? (
            <ArrowDownToLine className="size-3.5" />
          ) : (
            <ArrowUpFromLine className="size-3.5" />
          )}
          {m.type === "IN" ? "In" : m.type === "OUT" ? "Out" : "Count"} {m.quantity > 0 ? "+" : ""}
          {m.quantity}
        </span>
      ),
      exportValue: (m) => `${m.type} ${m.quantity}`,
    },
    {
      key: "note",
      header: "Note",
      cell: (m) => (
        <div>
          <p className="text-xs">{m.note ?? "—"}</p>
          {m.reference ? <p className="font-mono text-[10px] text-fg-subtle">{m.reference}</p> : null}
        </div>
      ),
      exportValue: (m) => m.note ?? "",
    },
    {
      key: "by",
      header: "By",
      hideBelow: "sm",
      cell: (m) => <span className="text-xs text-fg-subtle">{m.createdBy?.name ?? "System"}</span>,
      exportValue: (m) => m.createdBy?.name ?? "",
    },
    {
      key: "when",
      header: "When",
      align: "right",
      hideBelow: "md",
      cell: (m) => (
        <span className="text-xs text-fg-subtle" title={formatDate(m.createdAt)}>
          {relativeTime(m.createdAt)}
        </span>
      ),
      exportValue: (m) => formatDate(m.createdAt),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={movements}
      rowKey={(m) => m.id}
      compact
      empty="No movements recorded. The ledger starts with the first receipt."
    />
  );
}

export function AssignedTable({ rows }: { rows: Assigned[] }) {
  const columns: Column<Assigned>[] = [
    {
      key: "serial",
      header: "Serial",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.serial}</span>,
      exportValue: (r) => r.serial,
    },
    {
      key: "customer",
      header: "With",
      cell: (r) =>
        r.customer ? (
          <Link href={`/customers/${r.customer.id}`} className="text-xs hover:text-brand-600">
            {r.customer.name} <span className="font-mono text-fg-subtle">({r.customer.username})</span>
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">customer removed</span>
        ),
      exportValue: (r) => r.customer?.name ?? "",
    },
    {
      key: "mac",
      header: "MAC",
      hideBelow: "sm",
      cell: (r) => <span className="font-mono text-[11px] text-fg-subtle">{r.mac ?? "—"}</span>,
      exportValue: (r) => r.mac ?? "",
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    {
      key: "since",
      header: "Since",
      align: "right",
      hideBelow: "md",
      cell: (r) => <span className="text-xs text-fg-subtle">{formatDate(r.assignedAt)}</span>,
      exportValue: (r) => formatDate(r.assignedAt),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty="No devices of this kind are out with customers."
    />
  );
}

export function DeleteItemButton({ id, name }: { id: string; name: string }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    setState({ busy: true });
    const result = await deleteItemAction(id);
    if (result?.formError) {
      setState({ busy: false, error: result.formError });
      setConfirming(false);
    }
  };

  return (
    <>
      <Button variant="danger" size="sm" loading={state.busy} onClick={() => setConfirming(true)}>
        Delete item
      </Button>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${name}?`}
        description="Only possible if nothing is in stock and no customer holds a device of this kind. The movement history goes with it."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={state.busy} onClick={run}>
              Delete
            </Button>
          </div>
        }
      >
        {state.error ? <Alert state={{ formError: state.error }} /> : null}
      </Modal>
    </>
  );
}
