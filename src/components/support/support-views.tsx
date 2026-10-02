"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  DataTableShell, TableToolbar, Pagination, ExportCsvButton, FilterSelect, type Column,
} from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { DropdownMenu, type MenuItem } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { EmptyState, NoSearchResults } from "@/components/ui/states";
import { useToast } from "@/components/providers";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { TICKET_PRIORITIES, TICKET_STATUSES, COMPLAINT_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from "@/lib/enums";
import {
  assignTicketAction, decideLeaveAction, markAttendanceAction,
  paySalaryAction, resendMessageAction, updateTicketAction,
} from "@/app/(app)/support/actions";
import {
  Eye, MessageSquare, MoreHorizontal, UserCheck, Check, X, Play, Send, RotateCcw, Ticket as TicketIcon,
} from "lucide-react";

/* ================================================================== */
/* Tickets                                                             */
/* ================================================================== */

export type TicketRow = {
  id: string;
  ticketNumber: string;
  subject: string;
  problem: string;
  category: string;
  priority: string;
  status: string;
  createdAt: Date;
  /** Contract response time for a corporate client; null for a home customer. */
  slaDueAt: Date | null;
  escalated: boolean;
  customer: { id: string; name: string; username: string; customerCode: string } | null;
  technician: { id: string; name: string } | null;
  area: { id: string; name: string } | null;
  _count: { comments: number };
};

export function TicketsTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
  technicians,
  showStatusColumn = true,
  searchPlaceholder = "Search ticket, subject, customer...",
}: {
  rows: TicketRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  technicians: { id: string; name: string }[];
  showStatusColumn?: boolean;
  searchPlaceholder?: string;
}) {
  const columns: Column<TicketRow>[] = [
    {
      key: "ticketNumber",
      header: "Ticket",
      cell: (t) => (
        <Link href={`/support/tickets/${t.id}`} className="font-mono text-xs font-medium hover:text-brand-600">
          {t.ticketNumber}
        </Link>
      ),
      exportValue: (t) => t.ticketNumber,
    },
    {
      key: "subject",
      header: "Subject",
      cell: (t) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{t.subject}</span>
          {t._count.comments > 0 ? (
            <span className="block text-[11px] text-fg-subtle">{t._count.comments} comment(s)</span>
          ) : null}
        </div>
      ),
      exportValue: (t) => t.subject,
    },
    {
      key: "customer",
      header: "Customer",
      hideBelow: "sm",
      cell: (t) =>
        t.customer ? (
          <Link href={`/customers/${t.customer.id}?tab=complaints`} className="truncate text-xs hover:text-brand-600">
            {t.customer.name}
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">Walk-in</span>
        ),
      exportValue: (t) => t.customer?.name ?? "",
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "xl",
      cell: (t) => <Badge>{t.category}</Badge>,
      exportValue: (t) => t.category,
    },
    {
      key: "priority",
      header: "Priority",
      cell: (t) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={t.priority} />
          {t.escalated ? (
            // The flag a collections or account manager needs: a contractual
            // response time has passed and the ticket is still open. Priority
            // alone does not say that — a corporate ticket is High from the start.
            <span
              className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:bg-red-950/60 dark:text-red-300"
              title={t.slaDueAt ? `SLA was due ${formatDateTime(t.slaDueAt)}` : "SLA breached"}
            >
              SLA breached
            </span>
          ) : t.slaDueAt ? (
            <span
              className="hidden text-[10px] text-fg-subtle lg:inline"
              title="Contractual response time"
            >
              due {formatDate(t.slaDueAt)}
            </span>
          ) : null}
        </span>
      ),
      exportValue: (t) => (t.escalated ? `${t.priority} (SLA breached)` : t.priority),
    },
    {
      key: "technician",
      header: "Technician",
      hideBelow: "lg",
      cell: (t) => <span className="text-xs text-fg-muted">{t.technician?.name ?? "Unassigned"}</span>,
      exportValue: (t) => t.technician?.name ?? "",
    },
    ...(showStatusColumn
      ? [{ key: "status", header: "Status", align: "right" as const, cell: (t: TicketRow) => <StatusBadge status={t.status} />, exportValue: (t: TicketRow) => t.status }]
      : []),
    {
      key: "created",
      header: "Created",
      align: "right",
      hideBelow: "md",
      cell: (t) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(t.createdAt)}</span>,
      exportValue: (t) => formatDate(t.createdAt),
    },
    { key: "actions", header: "", align: "right", width: "52px", cell: (t) => <TicketRowActions row={t} technicians={technicians} /> },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(t) => t.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder={searchPlaceholder}
          filters={
            <>
              {showStatusColumn ? (
                <FilterSelect param="status" placeholder="All statuses" options={TICKET_STATUSES.map((s) => ({ value: s, label: s }))} />
              ) : null}
              <FilterSelect param="priority" placeholder="All priorities" options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))} />
              {showStatusColumn ? (
                <FilterSelect param="technicianId" placeholder="All technicians" options={technicians.map((t) => ({ value: t.id, label: t.name }))} width="w-40" />
              ) : null}
            </>
          }
          actions={<ExportCsvButton rows={rows} columns={columns} filename="tickets" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={
        <NoSearchResultsFallback
          title="No tickets"
          description="Tickets raised from a customer profile or here will show up in this list."
        />
      }
    />
  );
}

function NoSearchResultsFallback({ title, description }: { title: string; description: string }) {
  return <EmptyState icon={<TicketIcon />} title={title} description={description} />;
}

function TicketRowActions({ row, technicians }: { row: TicketRow; technicians: { id: string; name: string }[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const run = async (fn: () => Promise<{ success?: string; formError?: string }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.formError) error(r.formError);
      else {
        success(r.success ?? ok);
        startTransition(() => router.refresh());
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const items: (MenuItem | "separator")[] = [
    { label: "View", icon: <Eye />, onSelect: () => router.push(`/support/tickets/${row.id}`) },
    ...TICKET_STATUSES.filter((s) => s !== row.status).map((s) => ({
      label: `Mark ${s}`,
      icon: s === "Closed" ? <Check /> : s === "Resolved" ? <Check /> : <Play />,
      onSelect: () => run(() => updateTicketAction(row.id, { status: s }), `Ticket marked ${s}.`),
      disabled: busy,
    })),
    "separator",
    ...technicians.slice(0, 4).map((t) => ({
      label: `Assign ${t.name}`,
      icon: <UserCheck />,
      onSelect: () => run(() => assignTicketAction(row.id, t.id), `Assigned to ${t.name}.`),
      disabled: busy || row.technician?.id === t.id,
    })),
  ];

  return <DropdownMenu items={items} trigger={<MoreHorizontal className="size-4" />} />;
}

/* ================================================================== */
/* Technicians                                                         */
/* ================================================================== */

export type TechnicianRow = {
  id: string;
  employeeCode: string;
  name: string;
  role: string;
  phone: string;
  area: { id: string; name: string } | null;
  status: string;
  assigned: number;
  pending: number;
  completed: number;
};

export function TechniciansTable({ rows, hasFilters }: { rows: TechnicianRow[]; hasFilters: boolean }) {
  const columns: Column<TechnicianRow>[] = [
    {
      key: "name",
      header: "Technician",
      cell: (t) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{t.name}</span>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{t.employeeCode}</span>
        </div>
      ),
      exportValue: (t) => t.name,
    },
    { key: "role", header: "Role", hideBelow: "sm", cell: (t) => <span className="text-xs text-fg-muted">{t.role}</span>, exportValue: (t) => t.role },
    { key: "phone", header: "Phone", hideBelow: "md", cell: (t) => <span className="tnum text-xs">{t.phone}</span>, exportValue: (t) => t.phone },
    { key: "area", header: "Area", hideBelow: "xl", cell: (t) => <span className="text-xs text-fg-muted">{t.area?.name ?? "—"}</span>, exportValue: (t) => t.area?.name ?? "" },
    {
      key: "assigned",
      header: "Assigned",
      align: "right",
      cell: (t) => <span className="tnum text-xs font-medium">{t.assigned}</span>,
      exportValue: (t) => t.assigned,
    },
    { key: "pending", header: "Pending", align: "right", hideBelow: "lg", cell: (t) => <span className="tnum text-xs text-amber-600 dark:text-amber-400">{t.pending}</span>, exportValue: (t) => t.pending },
    { key: "completed", header: "Completed", align: "right", hideBelow: "lg", cell: (t) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{t.completed}</span>, exportValue: (t) => t.completed },
    {
      key: "workload",
      header: "Workload",
      align: "right",
      hideBelow: "md",
      cell: (t) => (
        <Badge tone={t.assigned === 0 ? "success" : t.assigned > 3 ? "danger" : "warning"}>
          {t.assigned === 0 ? "Free" : t.assigned > 3 ? "Overloaded" : "Busy"}
        </Badge>
      ),
      exportValue: (t) => t.assigned,
    },
    { key: "status", header: "Status", align: "right", cell: (t) => <StatusBadge status={t.status} />, exportValue: (t) => t.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(t) => t.id}
      compact
      toolbar={<TableToolbar searchPlaceholder="Search technician..." actions={<ExportCsvButton rows={rows} columns={columns} filename="technicians" />} />}
      empty={
        hasFilters ? (
          <NoSearchResults />
        ) : (
          <EmptyState icon={<UserCheck />} title="No technicians" description="Add employees with a Technician role to see them here." />
        )
      }
    />
  );
}

/* ================================================================== */
/* Employees                                                           */
/* ================================================================== */

export type EmployeeRow = {
  id: string;
  employeeCode: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  joiningDate: Date;
  status: string;
  area: { id: string; name: string } | null;
  ticketCount: number;
};

export function EmployeesTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
  areas,
}: {
  rows: EmployeeRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  areas: { id: string; name: string }[];
}) {
  const columns: Column<EmployeeRow>[] = [
    {
      key: "name",
      header: "Employee",
      cell: (e) => (
        <div className="min-w-0">
          <Link href={`/employees/${e.id}`} className="block truncate font-medium hover:text-brand-600">
            {e.name}
          </Link>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{e.employeeCode}</span>
        </div>
      ),
      exportValue: (e) => e.name,
    },
    { key: "role", header: "Role", cell: (e) => <span className="text-xs">{e.role}</span>, exportValue: (e) => e.role },
    { key: "phone", header: "Phone", hideBelow: "sm", cell: (e) => <span className="tnum text-xs">{e.phone}</span>, exportValue: (e) => e.phone },
    { key: "email", header: "Email", hideBelow: "xl", cell: (e) => <span className="truncate text-xs text-fg-muted">{e.email ?? "—"}</span>, exportValue: (e) => e.email ?? "" },
    { key: "area", header: "Area", hideBelow: "lg", cell: (e) => <span className="text-xs text-fg-muted">{e.area?.name ?? "—"}</span>, exportValue: (e) => e.area?.name ?? "" },
    { key: "joining", header: "Joining Date", hideBelow: "md", cell: (e) => <span className="whitespace-nowrap text-xs">{formatDate(e.joiningDate)}</span>, exportValue: (e) => formatDate(e.joiningDate) },
    { key: "tickets", header: "Tickets", align: "right", hideBelow: "xl", cell: (e) => <span className="tnum text-xs text-fg-muted">{e.ticketCount}</span>, exportValue: (e) => e.ticketCount },
    { key: "status", header: "Status", align: "right", cell: (e) => <StatusBadge status={e.status} />, exportValue: (e) => e.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(e) => e.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search name, code, phone, role..."
          filters={
            <>
              <FilterSelect param="status" placeholder="All statuses" options={[{ value: "Active", label: "Active" }, { value: "On Leave", label: "On Leave" }, { value: "Inactive", label: "Inactive" }]} />
              <FilterSelect param="areaId" placeholder="All areas" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="employees" />
              <Link href="/employees/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
                <UserCheck className="size-4" /> New Employee
              </Link>
            </div>
          }
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={<EmptyState icon={<UserCheck />} title="No employees" description="Add your support, field and office staff here." />}
    />
  );
}

/* ================================================================== */
/* Attendance                                                          */
/* ================================================================== */

export type AttendanceRow = {
  id: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string;
  note: string | null;
  employee: { id: string; name: string; employeeCode: string; role: string; area: { name: string } | null };
};

const ATTENDANCE_STATUSES_UI = ["Present", "Absent", "Late", "Leave"] as const;

export function AttendanceTable({
  rows,
  date,
  onMarked,
}: {
  rows: AttendanceRow[];
  date: Date;
  onMarked: () => void;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const mark = async (employeeId: string, status: string) => {
    setBusyId(employeeId);
    const r = await markAttendanceAction(employeeId, date, status);
    setBusyId(null);
    if (r.formError) error(r.formError);
    else {
      success(r.success ?? "Saved");
      startTransition(() => router.refresh());
    }
    onMarked();
  };

  const columns: Column<AttendanceRow>[] = [
    {
      key: "employee",
      header: "Employee",
      cell: (a) => (
        <div className="min-w-0">
          <Link href={`/employees/${a.employee.id}`} className="block truncate font-medium hover:text-brand-600">
            {a.employee.name}
          </Link>
          <span className="block truncate text-[11px] text-fg-subtle">{a.employee.role}</span>
        </div>
      ),
      exportValue: (a) => a.employee.name,
    },
    { key: "date", header: "Date", hideBelow: "sm", cell: () => <span className="whitespace-nowrap text-xs">{formatDate(date)}</span>, exportValue: () => formatDate(date) },
    { key: "checkIn", header: "Check In", cell: (a) => <span className="tnum text-xs">{a.checkIn ? a.checkIn.toISOString().slice(11, 16) : "—"}</span>, exportValue: (a) => (a.checkIn ? a.checkIn.toISOString() : "") },
    { key: "checkOut", header: "Check Out", hideBelow: "sm", cell: (a) => <span className="tnum text-xs">{a.checkOut ? a.checkOut.toISOString().slice(11, 16) : "—"}</span>, exportValue: (a) => (a.checkOut ? a.checkOut.toISOString() : "") },
    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} />, exportValue: (a) => a.status },
    {
      key: "quick",
      header: "Quick mark",
      align: "right",
      cell: (a) => (
        <div className="flex justify-end gap-1">
          {ATTENDANCE_STATUSES_UI.map((s) => (
            <button
              key={s}
              disabled={busyId === a.employee.id}
              onClick={() => mark(a.employee.id, s)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                a.status === s
                  ? "bg-brand-600 text-white"
                  : "border border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search employee..."
          actions={<ExportCsvButton rows={rows} columns={columns} filename="attendance" />}
        />
      }
      empty={<EmptyState icon={<UserCheck />} title="No attendance recorded" description="Use the quick mark buttons to record today's attendance." />}
    />
  );
}

/* ================================================================== */
/* Leave                                                               */
/* ================================================================== */

export type LeaveRow = {
  id: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  employee: { id: string; name: string; employeeCode: string; role: string };
};

export function LeaveTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: LeaveRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [, startTransition] = useTransition();

  const decide = async (id: string, decision: "Approved" | "Rejected") => {
    const r = await decideLeaveAction(id, decision);
    if (r.formError) error(r.formError);
    else {
      success(r.success ?? "Updated");
      startTransition(() => router.refresh());
    }
  };

  const columns: Column<LeaveRow>[] = [
    {
      key: "employee",
      header: "Employee",
      cell: (l) => (
        <div className="min-w-0">
          <Link href={`/employees/${l.employee.id}`} className="block truncate font-medium hover:text-brand-600">
            {l.employee.name}
          </Link>
          <span className="block truncate text-[11px] text-fg-subtle">{l.employee.role}</span>
        </div>
      ),
      exportValue: (l) => l.employee.name,
    },
    { key: "type", header: "Leave Type", cell: (l) => <Badge>{l.leaveType}</Badge>, exportValue: (l) => l.leaveType },
    {
      key: "duration",
      header: "Duration",
      cell: (l) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(l.startDate)} → {formatDate(l.endDate)}
          <span className="ml-1 text-fg-subtle">
            ({Math.max(1, Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1)}d)
          </span>
        </span>
      ),
      exportValue: (l) => `${formatDate(l.startDate)} - ${formatDate(l.endDate)}`,
    },
    { key: "reason", header: "Reason", hideBelow: "lg", cell: (l) => <span className="truncate text-xs text-fg-muted">{l.reason ?? "—"}</span>, exportValue: (l) => l.reason ?? "" },
    { key: "status", header: "Status", cell: (l) => <StatusBadge status={l.status} />, exportValue: (l) => l.status },
    { key: "by", header: "Approved By", hideBelow: "xl", cell: (l) => <span className="text-xs text-fg-muted">{l.approvedBy ?? "—"}</span>, exportValue: (l) => l.approvedBy ?? "" },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (l) =>
        l.status === "Pending" ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="success" icon={<Check className="size-3" />} onClick={() => decide(l.id, "Approved")}>
              Approve
            </Button>
            <Button size="sm" variant="danger-outline" icon={<X className="size-3" />} onClick={() => decide(l.id, "Rejected")}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(l) => l.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search employee..."
          filters={<FilterSelect param="status" placeholder="All statuses" options={["Pending", "Approved", "Rejected"].map((s) => ({ value: s, label: s }))} />}
          actions={<ExportCsvButton rows={rows} columns={columns} filename="leave" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={<EmptyState title="No leave requests" description="Requests submitted by employees appear here for approval." />}
    />
  );
}

/* ================================================================== */
/* Salary                                                              */
/* ================================================================== */

export type SalaryRow = {
  id: string;
  month: string;
  basic: number;
  allowance: number;
  bonus: number;
  deduction: number;
  advance: number;
  netSalary: number;
  status: string;
  paidAt: Date | null;
  employee: { id: string; name: string; employeeCode: string; role: string };
};

export function SalaryTable({
  rows,
  month,
  onGenerate,
}: {
  rows: SalaryRow[];
  month: string;
  onGenerate: () => void;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const pay = async (id: string) => {
    setBusy(true);
    const r = await paySalaryAction(id);
    setBusy(false);
    if (r.formError) error(r.formError);
    else {
      success(r.success ?? "Paid");
      startTransition(() => router.refresh());
    }
  };

  const generate = async () => {
    setBusy(true);
    const { generateSalaryAction } = await import("@/app/(app)/support/actions");
    const r = await generateSalaryAction(month);
    setBusy(false);
    if (r.formError) error(r.formError);
    else {
      success(r.success ?? "Generated");
      startTransition(() => router.refresh());
    }
    onGenerate();
  };

  const columns: Column<SalaryRow>[] = [
    {
      key: "employee",
      header: "Employee",
      cell: (s) => (
        <div className="min-w-0">
          <Link href={`/employees/${s.employee.id}`} className="block truncate font-medium hover:text-brand-600">
            {s.employee.name}
          </Link>
          <span className="block truncate text-[11px] text-fg-subtle">{s.employee.role}</span>
        </div>
      ),
      exportValue: (s) => s.employee.name,
    },
    { key: "basic", header: "Basic", align: "right", cell: (s) => <span className="tnum text-xs">{formatCurrency(s.basic)}</span>, exportValue: (s) => s.basic },
    { key: "allowance", header: "Allowance", align: "right", hideBelow: "sm", cell: (s) => <span className="tnum text-xs">{formatCurrency(s.allowance)}</span>, exportValue: (s) => s.allowance },
    { key: "bonus", header: "Bonus", align: "right", hideBelow: "lg", cell: (s) => <span className="tnum text-xs text-emerald-600 dark:text-emerald-400">{s.bonus ? formatCurrency(s.bonus) : "—"}</span>, exportValue: (s) => s.bonus },
    { key: "deduction", header: "Deduction", align: "right", hideBelow: "lg", cell: (s) => <span className="tnum text-xs text-red-600 dark:text-red-400">{s.deduction ? formatCurrency(s.deduction) : "—"}</span>, exportValue: (s) => s.deduction },
    { key: "net", header: "Net Salary", align: "right", cell: (s) => <span className="tnum text-xs font-semibold">{formatCurrency(s.netSalary)}</span>, exportValue: (s) => s.netSalary },
    { key: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} />, exportValue: (s) => s.status },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (s) =>
        s.status !== "Paid" ? (
          <Button size="sm" variant="success" loading={busy} onClick={() => pay(s.id)}>
            Mark paid
          </Button>
        ) : (
          <span className="text-[11px] text-fg-subtle">{formatDate(s.paidAt)}</span>
        ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(s) => s.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search employee..."
          actions={
            <div className="flex items-center gap-2">
              <ExportCsvButton rows={rows} columns={columns} filename="salary" />
              <Button variant="outline" loading={busy} onClick={generate}>
                Generate for {month}
              </Button>
            </div>
          }
        />
      }
      empty={
        <EmptyState
          icon={<Send />}
          title="No salary records"
          description={`No salary rows for ${month}. Use “Generate for ${month}” to create them from active employees.`}
        />
      }
    />
  );
}

/* ================================================================== */
/* Message history                                                     */
/* ================================================================== */

export type MessageRow = {
  id: string;
  channel: string;
  recipient: string;
  body: string;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  scheduledAt: Date | null;
  customer: { id: string; name: string } | null;
};

export function MessagesTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: MessageRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [, startTransition] = useTransition();

  const resend = async (id: string) => {
    const r = await resendMessageAction(id);
    if (r.formError) error(r.formError);
    else {
      success(r.success ?? "Resent");
      startTransition(() => router.refresh());
    }
  };

  const columns: Column<MessageRow>[] = [
    { key: "date", header: "Date", cell: (m) => <span className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</span>, exportValue: (m) => formatDate(m.createdAt) },
    { key: "channel", header: "Channel", cell: (m) => <Badge>{m.channel}</Badge>, exportValue: (m) => m.channel },
    {
      key: "recipient",
      header: "Recipient",
      cell: (m) =>
        m.customer ? (
          <Link href={`/customers/${m.customer.id}`} className="truncate text-xs hover:text-brand-600">
            {m.customer.name}
          </Link>
        ) : (
          <span className="tnum text-xs">{m.recipient}</span>
        ),
      exportValue: (m) => m.recipient,
    },
    { key: "message", header: "Message", cell: (m) => <span className="line-clamp-2 text-xs text-fg-muted">{m.body}</span> },
    { key: "status", header: "Status", cell: (m) => <StatusBadge status={m.status} />, exportValue: (m) => m.status },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "52px",
      cell: (m) => (
        <DropdownMenu
          items={[
            { label: "Resend", icon: <RotateCcw />, onSelect: () => resend(m.id) },
            { label: "View message", icon: <MessageSquare />, onSelect: () => window.open(`/api/search?q=${encodeURIComponent(m.recipient)}`, "_blank") },
          ]}
          trigger={<MoreHorizontal className="size-4" />}
        />
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(m) => m.id}
      compact
      toolbar={
        <TableToolbar
          searchPlaceholder="Search recipient or message..."
          filters={
            <>
              <FilterSelect param="channel" placeholder="All channels" options={NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: c }))} />
              <FilterSelect param="status" placeholder="All statuses" options={NOTIFICATION_STATUSES.map((s) => ({ value: s, label: s }))} />
            </>
          }
          actions={<ExportCsvButton rows={rows} columns={columns} filename="messages" />}
        />
      }
      pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
      empty={<EmptyState icon={<Send />} title="No messages yet" description="SMS and email you send are logged here with their delivery status." />}
    />
  );
}

export { ATTENDANCE_STATUSES_UI, COMPLAINT_CATEGORIES };
