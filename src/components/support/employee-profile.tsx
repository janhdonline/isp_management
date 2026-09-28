"use client";

import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { BarChartView } from "@/components/ui/charts";
import { Avatar } from "@/components/layout/avatar";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { User, Briefcase, Banknote, CalendarCheck, Plane, FileText, Ticket as TicketIcon } from "lucide-react";

type Employee = {
  id: string;
  employeeCode: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  address: string | null;
  photoUrl: string | null;
  joiningDate: Date;
  status: string;
  area: { name: string; zone: { name: string } | null } | null;
  attendances: { id: string; date: Date; checkIn: Date | null; checkOut: Date | null; status: string }[];
  leaves: { id: string; leaveType: string; startDate: Date; endDate: Date; status: string; reason: string | null }[];
  salaries: { id: string; month: string; basic: number; allowance: number; bonus: number; deduction: number; advance: number; netSalary: number; status: string; paidAt: Date | null }[];
  tickets: { id: string; ticketNumber: string; subject: string; status: string; createdAt: Date }[];
};

export function EmployeeProfile({ employee, tab }: { employee: Employee; tab: string }) {
  const present = employee.attendances.filter((a) => a.status === "Present").length;
  const absent = employee.attendances.filter((a) => a.status === "Absent").length;
  const totalPaid = employee.salaries.filter((s) => s.status === "Paid").reduce((s, r) => s + r.netSalary, 0);

  const base = `/employees/${employee.id}`;
  const items = [
    { value: "job", label: "Job", href: `${base}?tab=job` },
    { value: "salary", label: "Salary", href: `${base}?tab=salary`, count: employee.salaries.length },
    { value: "attendance", label: "Attendance", href: `${base}?tab=attendance`, count: employee.attendances.length },
    { value: "leave", label: "Leave", href: `${base}?tab=leave`, count: employee.leaves.length },
    { value: "advance", label: "Advance", href: `${base}?tab=advance` },
    { value: "documents", label: "Documents", href: `${base}?tab=documents` },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={employee.name} size="xl" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{employee.name}</p>
              <p className="font-mono text-xs text-fg-muted">{employee.employeeCode}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={employee.status} />
                <Badge>{employee.role}</Badge>
                {employee.area ? <Badge>{employee.area.name}</Badge> : null}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Mini label="Joined" value={formatDate(employee.joiningDate)} />
              <Mini label="Present" value={`${present}/${employee.attendances.length}`} />
              <Mini label="Absent" value={String(absent)} />
              <Mini label="Total Paid" value={formatCurrency(totalPaid)} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Tabs items={items} />

      {tab === "job" ? <JobTab employee={employee} /> : null}
      {tab === "salary" ? <SalaryTab employee={employee} /> : null}
      {tab === "attendance" ? <AttendanceTab employee={employee} /> : null}
      {tab === "leave" ? <LeaveTab employee={employee} /> : null}
      {tab === "advance" ? <AdvanceTab employee={employee} /> : null}
      {tab === "documents" ? <DocumentsTab employee={employee} /> : null}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function JobTab({ employee }: { employee: Employee }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Personal" icon={<User />} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ["Full name", employee.name],
              ["Employee ID", employee.employeeCode],
              ["Mobile", employee.phone],
              ["Email", employee.email ?? "—"],
              ["Address", employee.address ?? "—"],
              ["Status", employee.status],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
                <dd className="mt-0.5 text-sm">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Job" icon={<Briefcase />} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ["Role", employee.role],
              ["Joining date", formatDate(employee.joiningDate)],
              ["Area", employee.area?.name ?? "—"],
              ["Zone", employee.area?.zone?.name ?? "—"],
              ["Assigned tickets", String(employee.tickets.length)],
              ["Leave records", String(employee.leaves.length)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
                <dd className="mt-0.5 text-sm">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      {employee.tickets.length ? (
        <Card className="lg:col-span-2">
          <CardHeader title="Recent tickets" description="Assigned support work" icon={<TicketIcon />} />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--border)]">
              {employee.tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/support/tickets/${t.id}`} className="font-mono text-xs hover:text-brand-600">
                    {t.ticketNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <StatusBadge status={t.status} />
                  <span className="shrink-0 text-xs text-fg-subtle">{formatDate(t.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function SalaryTab({ employee }: { employee: Employee }) {
  const columns: Column<Employee["salaries"][number]>[] = [
    { key: "month", header: "Month", cell: (s) => <span className="font-mono text-xs font-medium">{s.month}</span>, exportValue: (s) => s.month },
    { key: "basic", header: "Basic", align: "right", cell: (s) => <span className="tnum text-xs">{formatCurrency(s.basic)}</span>, exportValue: (s) => s.basic },
    { key: "allowance", header: "Allowance", align: "right", hideBelow: "sm", cell: (s) => <span className="tnum text-xs">{formatCurrency(s.allowance)}</span>, exportValue: (s) => s.allowance },
    { key: "bonus", header: "Bonus", align: "right", hideBelow: "md", cell: (s) => <span className="tnum text-xs">{s.bonus ? formatCurrency(s.bonus) : "—"}</span>, exportValue: (s) => s.bonus },
    { key: "deduction", header: "Deduction", align: "right", hideBelow: "md", cell: (s) => <span className="tnum text-xs">{s.deduction ? formatCurrency(s.deduction) : "—"}</span>, exportValue: (s) => s.deduction },
    { key: "net", header: "Net Salary", align: "right", cell: (s) => <span className="tnum text-xs font-semibold">{formatCurrency(s.netSalary)}</span>, exportValue: (s) => s.netSalary },
    { key: "status", header: "Status", align: "right", cell: (s) => <StatusBadge status={s.status} />, exportValue: (s) => s.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={employee.salaries}
      rowKey={(s) => s.id}
      compact
      empty={<EmptyState icon={<Banknote />} title="No salary records" description="Generate payroll for this employee from the Salary page." />}
    />
  );
}

function AttendanceTab({ employee }: { employee: Employee }) {
  const columns: Column<Employee["attendances"][number]>[] = [
    { key: "date", header: "Date", cell: (a) => <span className="whitespace-nowrap text-xs">{formatDate(a.date)}</span>, exportValue: (a) => formatDate(a.date) },
    { key: "in", header: "Check In", align: "right", cell: (a) => <span className="tnum text-xs">{a.checkIn ? a.checkIn.toISOString().slice(11, 16) : "—"}</span>, exportValue: (a) => (a.checkIn ? a.checkIn.toISOString() : "") },
    { key: "out", header: "Check Out", align: "right", hideBelow: "sm", cell: (a) => <span className="tnum text-xs">{a.checkOut ? a.checkOut.toISOString().slice(11, 16) : "—"}</span>, exportValue: (a) => (a.checkOut ? a.checkOut.toISOString() : "") },
    { key: "status", header: "Status", align: "right", cell: (a) => <StatusBadge status={a.status} />, exportValue: (a) => a.status },
  ];

  const byStatus = ["Present", "Absent", "Late", "Leave"].map((s) => ({
    label: s,
    value: employee.attendances.filter((a) => a.status === s).length,
  }));

  return (
    <div className="space-y-4">
      <StatCardGrid>
        {byStatus.map((b) => (
          <StatCard key={b.label} label={b.label} value={formatNumber(b.value)} tone={b.label === "Present" ? "success" : b.label === "Absent" ? "danger" : "neutral"} />
        ))}
      </StatCardGrid>
      <DataTableShell
        columns={columns}
        rows={employee.attendances}
        rowKey={(a) => a.id}
        compact
        empty={<EmptyState icon={<CalendarCheck />} title="No attendance recorded" />}
      />
    </div>
  );
}

function LeaveTab({ employee }: { employee: Employee }) {
  const columns: Column<Employee["leaves"][number]>[] = [
    { key: "type", header: "Type", cell: (l) => <Badge>{l.leaveType}</Badge>, exportValue: (l) => l.leaveType },
    {
      key: "duration",
      header: "Duration",
      cell: (l) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(l.startDate)} → {formatDate(l.endDate)}
        </span>
      ),
      exportValue: (l) => `${formatDate(l.startDate)} - ${formatDate(l.endDate)}`,
    },
    { key: "reason", header: "Reason", hideBelow: "sm", cell: (l) => <span className="truncate text-xs text-fg-muted">{l.reason ?? "—"}</span>, exportValue: (l) => l.reason ?? "" },
    { key: "status", header: "Status", align: "right", cell: (l) => <StatusBadge status={l.status} />, exportValue: (l) => l.status },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={employee.leaves}
      rowKey={(l) => l.id}
      compact
      empty={<EmptyState icon={<Plane />} title="No leave records" />}
    />
  );
}

function AdvanceTab({ employee }: { employee: Employee }) {
  const total = employee.salaries.reduce((s, r) => s + r.advance, 0);
  return (
    <div className="space-y-4">
      <StatCardGrid>
        <StatCard label="Total Advance" value={formatCurrency(total)} tone={total > 0 ? "warning" : "neutral"} />
        <StatCard label="Months with advance" value={formatNumber(employee.salaries.filter((s) => s.advance > 0).length)} tone="brand" />
      </StatCardGrid>
      <Card>
        <CardHeader title="Advance by month" />
        <CardBody>
          {employee.salaries.length ? (
            <BarChartView
              data={employee.salaries.map((s) => ({ label: s.month, Advance: s.advance }))}
              series={[{ key: "Advance", label: "Advance", color: "#f59e0b" }]}
              stacked={false}
              money
              height={220}
            />
          ) : (
            <p className="py-8 text-center text-sm text-fg-muted">No payroll history yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function DocumentsTab({ employee }: { employee: Employee }) {
  return (
    <Card>
      <CardHeader title="Documents" description="Employee paperwork" icon={<FileText />} />
      <CardBody>
        <EmptyState
          icon={<FileText />}
          title="No documents uploaded"
          description="Attach contracts, NID copies and training certificates from the employee edit form."
        />
        <p className="mt-3 text-center text-xs text-fg-subtle">
          Employee ID: <span className="font-mono">{employee.employeeCode}</span>
        </p>
      </CardBody>
    </Card>
  );
}
