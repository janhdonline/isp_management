"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useState, useTransition, useCallback } from "react";
import { DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, useTableQuery, Column } from "@/components/ui/data-table";
import { StatusTriple, Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EmptyState, NoSearchResults } from "@/components/ui/states";
import { Avatar } from "@/components/layout/avatar";
import { DropdownMenu, MenuItem } from "@/components/ui/dropdown";
import { useToast } from "@/components/providers";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatCurrency, formatDate, formatBytes, daysUntil } from "@/lib/utils";
import { CONNECTION_STATUSES, BILLING_STATUSES } from "@/lib/enums";
import { changePackageAction, deleteCustomerAction, disconnectCustomerAction, reconnectCustomerAction, renewCustomerAction, suspendCustomerAction } from "@/app/(app)/customers/actions";
import {
  Banknote,
  CalendarPlus,
  Eye,
  Package as PackageIcon,
  PauseCircle,
  Pencil,
  PlayCircle,
  Trash2,
  Unplug,
  UserCheck,
} from "lucide-react";

export type Row = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  username: string;
  ipAddress: string | null;
  macAddress?: string | null;
  onlineStatus: string;
  monthlyBill: number;
  previousDue: number;
  expiryDate: Date | null;
  connectionStatus: string;
  billingStatus: string;
  lastOnlineAt?: Date | null;
  loginTime?: Date | null;
  connectionDate?: Date;
  disconnectReason?: string | null;
  suspendedAt?: Date | null;
  suspendReason?: string | null;
  downloadBytes?: number;
  uploadBytes?: number;
  daysOverdue?: number;
  oldestInvoice?: { id: string; invoiceNumber: string; dueDate: Date; total: number; paid: number } | null;
  package: { id: string; name: string; downloadSpeed: number; uploadSpeed: number } | null;
  area: { id: string; name: string } | null;
  router?: { id: string; name: string } | null;
};

export type { Column } from "@/components/ui/data-table";

export type FilterOption = { id: string; name: string };

export type CustomerFiltersProps = {
  areas: FilterOption[];
  packages: FilterOption[];
  showStatus?: boolean;
  showBilling?: boolean;
  showOnline?: boolean;
  showExpiry?: boolean;
  showPriority?: boolean;
  showMethod?: boolean;
  extra?: React.ReactNode;
};

export function CustomerFilters({
  areas, packages, showStatus, showBilling, showOnline, showExpiry, extra,
}: CustomerFiltersProps) {
  return (
    <>
      <FilterSelect
        param="areaId"
        placeholder="All areas"
        width="w-36"
        options={areas.map((a) => ({ value: a.id, label: a.name }))}
      />
      <FilterSelect
        param="packageId"
        placeholder="All packages"
        width="w-40"
        options={packages.map((p) => ({ value: p.id, label: p.name }))}
      />
      {showStatus ? (
        <FilterSelect
          param="status"
          placeholder="All statuses"
          width="w-36"
          options={CONNECTION_STATUSES.map((s) => ({ value: s, label: s }))}
        />
      ) : null}
      {showBilling ? (
        <FilterSelect
          param="billingStatus"
          placeholder="All billing"
          width="w-32"
          options={BILLING_STATUSES.map((s) => ({ value: s, label: s }))}
        />
      ) : null}
      {showOnline ? (
        <FilterSelect
          param="onlineStatus"
          placeholder="Online/Offline"
          width="w-32"
          options={[
            { value: "Online", label: "Online" },
            { value: "Offline", label: "Offline" },
          ]}
        />
      ) : null}
      {showExpiry ? <ExpiryRange /> : null}
      {extra}
    </>
  );
}

function ExpiryRange() {
  const { searchParams, setParams } = useTableQuery();
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label="Expiry from"
        value={searchParams.get("expiryFrom") ?? ""}
        onChange={(e) => setParams({ expiryFrom: e.target.value || null })}
        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
      />
      <span className="text-xs text-fg-subtle">-</span>
      <input
        type="date"
        aria-label="Expiry to"
        value={searchParams.get("expiryTo") ?? ""}
        onChange={(e) => setParams({ expiryTo: e.target.value || null })}
        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)] focus:border-brand-500 focus:outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row actions                                                         */
/* ------------------------------------------------------------------ */

export function CustomerRowActions({
  row,
  packages,
  canEdit = true,
  canDelete = true,
  canCollect = true,
  onCollect,
}: {
  row: Row;
  packages: FilterOption[];
  canEdit?: boolean;
  canDelete?: boolean;
  canCollect?: boolean;
  onCollect?: (id: string) => void;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | "suspend" | "reconnect" | "renew" | "package" | "disconnect" | "delete">(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<{ success?: string; formError?: string }>, okMessage?: string) => {
      setBusy(true);
      try {
        const res = await fn();
        if (res.formError) error(res.formError);
        else {
          success(res.success ?? okMessage ?? "Done");
          setDialog(null);
          startTransition(() => router.refresh());
        }
      } catch (e) {
        error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [error, success, router]
  );

  const items: (MenuItem | "separator")[] = [
    { label: "View profile", icon: <Eye />, onSelect: () => router.push(`/customers/${row.id}`) },
    canEdit ? { label: "Edit", icon: <Pencil />, onSelect: () => router.push(`/customers/${row.id}/edit`) } : { label: "Edit", disabled: true },
    canCollect && onCollect
      ? { label: "Collect payment", icon: <Banknote />, onSelect: () => onCollect(row.id) }
      : { label: "Collect payment", icon: <Banknote />, onSelect: () => router.push(`/billing/payments/new?customerId=${row.id}`) },
    { label: "Renew", icon: <CalendarPlus />, onSelect: () => setDialog("renew"), disabled: !canEdit },
    { label: "Change package", icon: <PackageIcon />, onSelect: () => setDialog("package"), disabled: !canEdit },
    "separator",
    row.connectionStatus === "Suspended"
      ? { label: "Reconnect", icon: <PlayCircle />, onSelect: () => setDialog("reconnect"), disabled: !canEdit }
      : { label: "Suspend", icon: <PauseCircle />, onSelect: () => setDialog("suspend"), disabled: !canEdit },
    { label: "Disconnect", icon: <Unplug />, onSelect: () => setDialog("disconnect"), disabled: !canEdit },
    "separator",
    { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setDialog("delete"), disabled: !canDelete },
  ];

  return (
    <>
      <DropdownMenu items={items} buttonClassName="size-8" trigger={<span className="sr-only">Actions</span>} />
      <span className="sr-only" aria-live="polite">
        {isPending ? "Working" : ""}
      </span>

      <SuspendDialog open={dialog === "suspend"} onClose={() => setDialog(null)} busy={busy} onConfirm={(reason) => run(() => suspendCustomerAction(row.id, reason), "Customer suspended.")} />
      <ReconnectDialog open={dialog === "reconnect"} onClose={() => setDialog(null)} busy={busy} onConfirm={() => run(() => reconnectCustomerAction(row.id), "Customer reconnected.")} />
      <RenewDialog open={dialog === "renew"} onClose={() => setDialog(null)} busy={busy} defaultDays={row.package ? 30 : 30} onConfirm={(days) => run(() => renewCustomerAction(row.id, days), "Subscription renewed.")} />
      <PackageDialog open={dialog === "package"} onClose={() => setDialog(null)} busy={busy} packages={packages} currentId={row.package?.id} onConfirm={(pkgId, reason) => run(() => changePackageAction(row.id, pkgId, reason), "Package changed.")} />
      <DisconnectDialog open={dialog === "disconnect"} onClose={() => setDialog(null)} busy={busy} onConfirm={(reason) => run(() => disconnectCustomerAction(row.id, reason), "Customer disconnected.")} />
      <DeleteDialog open={dialog === "delete"} onClose={() => setDialog(null)} busy={busy} name={row.name} onConfirm={() => run(async () => { const r = await deleteCustomerAction(row.id); if (r.success) router.push("/customers"); return r; }, "Customer deleted.")} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

export function SuspendDialog({ open, onClose, busy, onConfirm }: { open: boolean; onClose: () => void; busy: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("Unpaid bill beyond grace period");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Suspend customer"
      description="Suspending immediately removes the session and keeps the billing history intact."
      icon={<PauseCircle />}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => onConfirm(reason)}>Suspend</Button>
        </>
      }
    >
      <Field label="Reason" required hint="Stored on the customer record and in the activity log.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
      <div className="mt-3 space-y-1.5">
        {["Unpaid bill beyond grace period", "Customer request", "Abuse / policy violation", "Equipment not returned"].map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className="block w-full rounded-md border border-[var(--border)] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-3)]"
          >
            {r}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ReconnectDialog({ open, onClose, busy, onConfirm }: { open: boolean; onClose: () => void; busy: boolean; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Reconnect customer?"
      description="The connection status returns to Active and the suspension reason is cleared. Outstanding dues are not waived."
      confirmLabel="Reconnect"
      variant="primary"
      loading={busy}
    />
  );
}

export function DisconnectDialog({ open, onClose, busy, onConfirm }: { open: boolean; onClose: () => void; busy: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("Customer moved out of service area");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Disconnect customer"
      description="Disconnection ends service. The record and its financial history are kept."
      icon={<Unplug />}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => onConfirm(reason)}>Disconnect</Button>
        </>
      }
    >
      <Field label="Reason" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
    </Modal>
  );
}

export function DeleteDialog({ open, onClose, busy, name, onConfirm }: { open: boolean; onClose: () => void; busy: boolean; name: string; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete customer?"
      description={
        <>
          <strong>{name}</strong> and every related invoice, payment, session and ticket will be permanently removed. This action cannot be undone.
        </>
      }
      confirmLabel="Delete permanently"
      loading={busy}
    />
  );
}

export function RenewDialog({ open, onClose, busy, onConfirm, defaultDays = 30 }: { open: boolean; onClose: () => void; busy: boolean; onConfirm: (days: number) => void; defaultDays?: number }) {
  const [days, setDays] = useState(defaultDays);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Renew subscription"
      description="Extends the expiry date without creating an invoice. Use Collect Payment for a full billing cycle."
      icon={<CalendarPlus />}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => onConfirm(days)}>Extend {days} days</Button>
        </>
      }
    >
      <Field label="Days to add" required>
        <Input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        {[7, 15, 30, 60, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--surface-3)]">
            {d} days
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PackageDialog({ open, onClose, busy, packages, currentId, onConfirm }: { open: boolean; onClose: () => void; busy: boolean; packages: FilterOption[]; currentId?: string; onConfirm: (packageId: string, reason: string) => void }) {
  const initial = currentId ?? packages[0]?.id ?? "";
  const [packageId, setPackageId] = useState(initial);
  const [reason, setReason] = useState("Upgraded by customer request");

  // Re-seed the selection every time the dialog opens.
  const [lastOpen, setLastOpen] = React.useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setPackageId(initial);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change package"
      description="The new monthly bill is copied onto the customer and the change is logged in history."
      icon={<PackageIcon />}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => onConfirm(packageId, reason)}>Change package</Button>
        </>
      }
    >
      <Field label="New package" required>
        <Select value={packageId} onChange={(e) => setPackageId(e.target.value)} options={packages.map((p) => ({ value: p.id, label: p.name }))} placeholder="Select package" />
      </Field>
      <div className="mt-3">
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Column factories - reused across every customer list page            */
/* ------------------------------------------------------------------ */

export function customerIdentityColumn(): Column<Row> {
  return {
    key: "customer",
    header: "Customer",
    sortKey: "name",
    cell: (r) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={r.name} size="sm" />
        <div className="min-w-0">
          <Link href={`/customers/${r.id}`} className="block truncate font-medium hover:text-brand-600">
            {r.name}
          </Link>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.customerCode}</span>
        </div>
      </div>
    ),
    exportValue: (r) => r.name,
  };
}

export function customerContactColumn(): Column<Row> {
  return {
    key: "phone",
    header: "Phone",
    sortKey: "phone",
    hideBelow: "sm",
    cell: (r) => <span className="tnum text-xs">{r.phone}</span>,
    exportValue: (r) => r.phone,
  };
}

export function customerUsernameColumn(): Column<Row> {
  return {
    key: "username",
    header: "Username",
    sortKey: "username",
    hideBelow: "md",
    cell: (r) => <span className="font-mono text-xs">{r.username}</span>,
    exportValue: (r) => r.username,
  };
}

export function customerPackageColumn(): Column<Row> {
  return {
    key: "package",
    header: "Package",
    hideBelow: "lg",
    cell: (r) =>
      r.package ? (
        <div className="min-w-0">
          <span className="block truncate text-xs">{r.package.name}</span>
          <span className="block text-[11px] text-fg-subtle">
            {r.package.downloadSpeed}/{r.package.uploadSpeed} Mbps
          </span>
        </div>
      ) : (
        <span className="text-xs text-fg-subtle">—</span>
      ),
    exportValue: (r) => r.package?.name ?? "",
  };
}

export function customerAreaColumn(): Column<Row> {
  return {
    key: "area",
    header: "Area",
    hideBelow: "xl",
    cell: (r) => <span className="text-xs text-fg-muted">{r.area?.name ?? "—"}</span>,
    exportValue: (r) => r.area?.name ?? "",
  };
}

export function customerBillColumn(): Column<Row> {
  return {
    key: "monthlyBill",
    header: "Monthly Bill",
    sortKey: "monthlyBill",
    align: "right",
    cell: (r) => <span className="tnum text-xs">{formatCurrency(r.monthlyBill)}</span>,
    exportValue: (r) => r.monthlyBill,
  };
}

export function customerDueColumn(): Column<Row> {
  return {
    key: "due",
    header: "Due",
    sortKey: "previousDue",
    align: "right",
    cell: (r) => (
      <span className={`tnum text-xs font-semibold ${r.previousDue > 0 ? "text-red-600 dark:text-red-400" : "text-fg-subtle"}`}>
        {formatCurrency(r.previousDue)}
      </span>
    ),
    exportValue: (r) => r.previousDue,
  };
}

export function customerExpiryColumn(): Column<Row> {
  return {
    key: "expiry",
    header: "Expiry",
    sortKey: "expiryDate",
    cell: (r) => {
      const d = daysUntil(r.expiryDate);
      return (
        <div className="whitespace-nowrap">
          <span className="block text-xs">{formatDate(r.expiryDate)}</span>
          {d !== null ? (
            <span className={`block text-[11px] ${d < 0 ? "text-red-600 dark:text-red-400" : d <= 3 ? "text-amber-600 dark:text-amber-400" : "text-fg-subtle"}`}>
              {d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`}
            </span>
          ) : null}
        </div>
      );
    },
    exportValue: (r) => formatDate(r.expiryDate),
  };
}

export function customerStatusColumn(): Column<Row> {
  return {
    key: "status",
    header: "Status",
    sortKey: "connectionStatus",
    cell: (r) => <StatusTriple connection={r.connectionStatus} online={r.onlineStatus} billing={r.billingStatus} />,
    exportValue: (r) => `${r.connectionStatus} / ${r.onlineStatus} / ${r.billingStatus}`,
  };
}

export function customerOnlineColumn(): Column<Row> {
  return {
    key: "online",
    header: "Online",
    cell: (r) => (
      <Badge tone={r.onlineStatus === "Online" ? "success" : "neutral"}>
        <span className="size-1.5 rounded-full bg-current" />
        {r.onlineStatus}
      </Badge>
    ),
    exportValue: (r) => r.onlineStatus,
  };
}

export function customerIpColumn(): Column<Row> {
  return {
    key: "ip",
    header: "IP",
    hideBelow: "md",
    cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.ipAddress ?? "—"}</span>,
    exportValue: (r) => r.ipAddress ?? "",
  };
}

export function customerMacColumn(): Column<Row> {
  return {
    key: "mac",
    header: "MAC",
    hideBelow: "xl",
    cell: (r) => <span className="font-mono text-[11px] text-fg-muted">{r.macAddress ?? "—"}</span>,
    exportValue: (r) => r.macAddress ?? "",
  };
}

export function customerTrafficColumn(): Column<Row> {
  return {
    key: "traffic",
    header: "Traffic (D / U)",
    align: "right",
    hideBelow: "xl",
    cell: (r) => (
      <span className="tnum whitespace-nowrap text-[11px] text-fg-muted">
        {formatBytes(r.downloadBytes ?? 0)} / {formatBytes(r.uploadBytes ?? 0)}
      </span>
    ),
    exportValue: (r) => (r.downloadBytes ?? 0) + (r.uploadBytes ?? 0),
  };
}

export function customerLastSeenColumn(): Column<Row> {
  return {
    key: "lastOnline",
    header: "Last Online",
    cell: (r) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(r.lastOnlineAt)}</span>,
    exportValue: (r) => formatDate(r.lastOnlineAt),
  };
}

export function customerActionColumn(packages: FilterOption[], canCollect?: (id: string) => void): Column<Row> {
  return {
    key: "actions",
    header: "",
    align: "right",
    width: "52px",
    cell: (r) => <CustomerRowActions row={r} packages={packages} onCollect={canCollect} />,
  };
}

/* ------------------------------------------------------------------ */
/* Column sets per view                                                */
/* ------------------------------------------------------------------ */

export type CustomerView =
  | "list"
  | "active"
  | "expired"
  | "suspended"
  | "disconnected"
  | "expiring"
  | "due"
  | "online"
  | "offline";

/** Columns are built here, inside the client boundary, so server pages never
 *  have to call a client function. */
function buildColumns(view: CustomerView, packages: FilterOption[]): Column<Row>[] {
  switch (view) {
    case "online":
      return [
        customerUsernameColumn(),
        customerNameLinkColumn(),
        customerIpColumn(),
        customerMacColumn(),
        customerPackageColumn(),
        customerTrafficColumn(),
        {
          key: "router",
          header: "Router",
          hideBelow: "lg",
          cell: (r) => <span className="text-xs text-fg-muted">{(r as { router?: { name: string } }).router?.name ?? "—"}</span>,
          exportValue: (r) => (r as { router?: { name: string } }).router?.name ?? "",
        },
        {
          key: "login",
          header: "Login Time",
          align: "right",
          cell: (r) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(r.loginTime)}</span>,
          exportValue: (r) => formatDate(r.loginTime),
        },
        customerOnlineColumn(),
        customerActionColumn(packages),
      ];

    case "offline":
      return [
        customerIdentityColumn(),
        customerUsernameColumn(),
        customerPackageColumn(),
        customerLastSeenColumn(),
        customerExpiryColumn(),
        customerDueColumn(),
        customerStatusColumn(),
        customerActionColumn(packages),
      ];

    case "due":
      return [
        customerIdentityColumn(),
        customerContactColumn(),
        customerPackageColumn(),
        {
          key: "invoice",
          header: "Oldest Invoice",
          hideBelow: "md",
          cell: (r) =>
            r.oldestInvoice ? (
              <span className="font-mono text-[11px]">{r.oldestInvoice.invoiceNumber}</span>
            ) : (
              <span className="text-xs text-fg-subtle">—</span>
            ),
          exportValue: (r) => r.oldestInvoice?.invoiceNumber ?? "",
        },
        {
          key: "daysOverdue",
          header: "Days Overdue",
          align: "right",
          cell: (r) => (
            <Badge tone={(r.daysOverdue ?? 0) > 30 ? "danger" : (r.daysOverdue ?? 0) > 7 ? "warning" : "neutral"}>
              {r.daysOverdue ?? 0} days
            </Badge>
          ),
          exportValue: (r) => r.daysOverdue ?? 0,
        },
        customerDueColumn(),
        customerActionColumn(packages),
      ];

    case "expiring":
      return [
        customerIdentityColumn(),
        customerContactColumn(),
        customerPackageColumn(),
        {
          key: "expiry",
          header: "Expiry",
          sortKey: "expiryDate",
          cell: (r) => {
            const d = daysUntil(r.expiryDate);
            return (
              <div className="whitespace-nowrap">
                <span className="block text-xs">{formatDate(r.expiryDate)}</span>
                <Badge tone={d !== null && d <= 1 ? "danger" : "warning"}>{d !== null ? `${d} days left` : "—"}</Badge>
              </div>
            );
          },
          exportValue: (r) => formatDate(r.expiryDate),
        },
        customerDueColumn(),
        customerStatusColumn(),
        customerActionColumn(packages),
      ];

    default:
      return [
        customerIdentityColumn(),
        customerContactColumn(),
        customerUsernameColumn(),
        customerPackageColumn(),
        customerAreaColumn(),
        customerBillColumn(),
        customerExpiryColumn(),
        customerDueColumn(),
        customerStatusColumn(),
        customerActionColumn(packages),
      ];
  }
}

function customerNameLinkColumn(): Column<Row> {
  return {
    key: "customer",
    header: "Customer",
    cell: (r) => (
      <div className="min-w-0">
        <Link href={`/customers/${r.id}`} className="block truncate font-medium hover:text-brand-600">
          {r.name}
        </Link>
        <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.customerCode}</span>
      </div>
    ),
    exportValue: (r) => r.name,
  };
}

/* ------------------------------------------------------------------ */
/* Full page scaffold                                                  */
/* ------------------------------------------------------------------ */

export function CustomerListPage({
  rows,
  total,
  page,
  perPage,
  totalPages,
  areas,
  packages,
  view = "list",
  searchPlaceholder = "Search name, username, phone, IP...",
  filterProps,
  newHref = "/customers/new",
  newLabel = "New Customer",
  emptyTitle = "No customers found",
  emptyDescription = "Adjust your filters or add a new customer to get started.",
  toolbarRight,
}: {
  rows: Row[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  areas: FilterOption[];
  packages: FilterOption[];
  view?: CustomerView;
  searchPlaceholder?: string;
  filterProps?: Partial<CustomerFiltersProps>;
  newHref?: string;
  newLabel?: string;
  onCollect?: (id: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbarRight?: React.ReactNode;
}) {
  const hasFilters = useHasFilters();
  const columns = React.useMemo(() => buildColumns(view, packages), [view, packages]);

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      toolbar={
        <TableToolbar
          searchPlaceholder={searchPlaceholder}
          filters={<CustomerFilters areas={areas} packages={packages} {...filterProps} />}
          right={toolbarRight}
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="customers" />
              <Link
                href={newHref}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <UserCheck className="size-4" />
                {newLabel}
              </Link>
            </div>
          }
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        hasFilters ? (
          <NoSearchResults />
        ) : (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={
              <Link href={newHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white">
                <UserCheck className="size-4" /> {newLabel}
              </Link>
            }
          />
        )
      }
    />
  );
}

function useHasFilters() {
  const { searchParams } = useTableQuery();
  return Array.from(searchParams.keys()).some(
    (k) => !["page", "perPage", "sort", "dir"].includes(k)
  );
}
