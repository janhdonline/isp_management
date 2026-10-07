import { getSettings } from "@/lib/settings";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  COMPLAINT_CATEGORIES,
  ATTENDANCE_STATUSES,
  EMPLOYEE_STATUSES,
  LEAVE_STATUSES,
} from "@/lib/enums";
import { round2, startOfDay, addDays } from "@/lib/utils";

const ticketInclude = {
  customer: { select: { id: true, name: true, username: true, customerCode: true, phone: true } },
  technician: { select: { id: true, name: true, phone: true } },
  area: { select: { id: true, name: true } },
  slaDueAt: true,
  slaBreached: true,
} satisfies Prisma.TicketInclude;

export type TicketRow = {
  id: string;
  ticketNumber: string;
  subject: string;
  problem: string;
  category: string;
  description: string | null;
  priority: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  customer: { id: string; name: string; username: string; customerCode: string; phone: string } | null;
  technician: { id: string; name: string; phone: string } | null;
  area: { id: string; name: string } | null;
  slaDueAt: Date | null;
  slaBreached: boolean;
  _count: { comments: number };
};

/**
 * Flags open tickets whose SLA deadline has passed, and un-flags any that no
 * longer warrant it.
 *
 * Idempotent and cheap: one update per direction, run when the queue is read.
 *
 * `escalated: true` means "the ticket's priority was auto-bumped once and should not be bumped again".
 * The flag is cleared when the ticket is closed, has no deadline, or is still inside its deadline.
 */
/** The statuses a ticket is still "outstanding" in. */
const OPEN_TICKET_STATUSES = ["Open", "Pending", "In Progress"];

export async function slaEscalate(now: Date = new Date()): Promise<number> {
  const escalated = await prisma.ticket.updateMany({
    where: {
      status: { in: OPEN_TICKET_STATUSES },
      slaDueAt: { not: null, lte: now },
      escalated: false,
    },
    data: { escalated: true },
  });
  // Clear the flag once it no longer describes anything outstanding: the ticket
  // is closed, has no deadline, or is still inside its deadline. A ticket closed
  // *after* breaching was late, but it is not an open escalation — leaving it
  // flagged would keep a resolved incident in the queue for ever.
  await prisma.ticket.updateMany({
    where: {
      escalated: true,
      OR: [
        { status: { notIn: OPEN_TICKET_STATUSES } },
        { slaDueAt: null },
        { slaDueAt: { gt: now } },
      ],
    },
    data: { escalated: false },
  });
  return escalated.count;
}

export async function slaWatch(now: Date = new Date()): Promise<number> {
  const settings = await getSettings();
  const autoEscalate = settings["sla.autoEscalate"] === "true";
  const alertChannel = settings["sla.alertChannel"] || "";
  const alertRecipients = settings["sla.alertRecipients"] || "";
  
  const openStatuses = ["Open", "Pending", "In Progress"];
  
  const breachedTickets = await prisma.ticket.findMany({
    where: {
      status: { in: openStatuses },
      slaDueAt: { not: null, lte: now },
      slaBreached: false,
    },
    select: {
      id: true,
      ticketNumber: true,
      priority: true,
      status: true,
      slaDueAt: true,
      escalated: true,
      technician: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  });

  let notifiedCount = 0;
  let escalatedCount = 0;

  for (const ticket of breachedTickets) {
    // Mark as breached
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { slaBreached: true },
    });

    notifiedCount++;

    // Send notifications if channel configured
    if (alertChannel && alertRecipients) {
      const recipientList = alertRecipients.split(",").map(r => r.trim()).filter(r => r);
      
      // Notify assignee if exists
      if (ticket.technician?.phone) {
        await dispatch(alertChannel, ticket.technician.phone, 
          `SLA Breach: Ticket ${ticket.ticketNumber}`, 
          `Your ticket "${ticket.ticketNumber}" is past its SLA due date (${ticket.slaDueAt?.toISOString().slice(0, 10)}). Priority has been auto-escalated.`);
      }
      
      // Notify manager if exists (for now, use same notification)
      if (ticket.customer?.phone) {
        await dispatch(alertChannel, ticket.customer.phone,
          `SLA Breach: Ticket ${ticket.ticketNumber} assigned to ${ticket.technician?.name || 'Unknown'}`, 
          `Ticket ${ticket.ticketNumber} is past SLA. Assignee: ${ticket.technician?.name || 'Unknown'}. Due: ${ticket.slaDueAt?.toISOString().slice(0, 10)}.`);
      }
    }

    // Auto-escalate if enabled and not already escalated
    if (autoEscalate && !ticket.escalated) {
      // Bump priority one level
      const priorityOrder = ["Low", "Medium", "High", "Critical"];
      const currentPriorityIndex = priorityOrder.indexOf(ticket.priority);
      if (currentPriorityIndex < priorityOrder.length - 1) {
        const nextPriority = priorityOrder[currentPriorityIndex + 1];
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            priority: nextPriority,
            priorityRaisedAt: now,
            escalated: true, // Mark that priority was auto-bumped
          },
        });

        escalatedCount++;
      }
    }
  }

  return notifiedCount + escalatedCount;
}

export async function listTickets(p: ListParams = {}): Promise<ListResult<TicketRow>> {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;

  const and: Prisma.TicketWhereInput[] = [];
  if (p.status) and.push({ status: p.status });
  if (p.priority) and.push({ priority: p.priority });
  if (p.technicianId) and.push({ technicianId: p.technicianId });
  if (p.areaId) and.push({ areaId: p.areaId });
  if (p.q?.trim()) {
    const term = p.q.trim();
    and.push({
      OR: [
        { ticketNumber: { contains: term } },
        { subject: { contains: term } },
        { problem: { contains: term } },
        { customer: { name: { contains: term } } },
        { technician: { name: { contains: term } } },
      ],
    });
  }
  if (p.from || p.to) {
    const range: Prisma.DateTimeFilter = {};
    if (p.from) range.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    and.push({ createdAt: range });
  }

  const where: Prisma.TicketWhereInput = and.length ? { AND: and } : {};

  // Mark anything whose contractual response time has already run out. Done here
  // rather than at insert so a ticket that sat open overnight is flagged by the
  // next person who opens the queue, without needing a job to notice.
  //
  // Only open tickets, and the flag is cleared by `slaEscalate()` when a ticket
  // closes — recomputing "overdue" from the timestamp alone would call a ticket
  // closed after breaching escalated for ever.
  await slaEscalate();

  const [total, rows, byStatus, byPriority] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: { ...ticketInclude, _count: { select: { comments: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: p.dir ?? "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], where, _count: { _all: true } }),
  ]);

  const count = (list: typeof byStatus, key: string) =>
    list.find((r) => r[key as keyof typeof r] === key)?._count._all ?? 0;

  return {
    rows: rows as unknown as TicketRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: Object.fromEntries(
      [...TICKET_STATUSES, ...TICKET_PRIORITIES].map((s) => [
        s,
        count([...byStatus, ...byPriority] as never, s),
      ])
    ),
    csv: {
      headers: ["Ticket", "Subject", "Customer", "Category", "Priority", "Technician", "Status", "Created"],
      filename: "tickets.csv",
      rows: rows.map((t) => [
        t.ticketNumber,
        t.subject,
        t.customer?.name ?? "",
        t.category,
        t.priority,
        t.technician?.name ?? "",
        t.status,
        t.createdAt.toISOString().slice(0, 10),
      ]),
    },
  };
}

export async function ticketMetrics() {
  const now = new Date();
  const weekAgo = addDays(now, -7);
  
  const settings = await getSettings();
  const hours = {
    critical: Number(settings["sla.hours.critical"] ?? "4"),
    high: Number(settings["sla.hours.high"] ?? "24"),
    medium: Number(settings["sla.hours.medium"] ?? "72"),
    low: Number(settings["sla.hours.low"] ?? "168"),
  };

  const [open, pending, inProgress, resolved, closed, slaBreached, oldest] = await Promise.all([
    prisma.ticket.count({ where: { status: "Open" } }),
    prisma.ticket.count({ where: { status: "Pending" } }),
    prisma.ticket.count({ where: { status: "In Progress" } }),
    prisma.ticket.count({ where: { status: "Resolved" } }),
    prisma.ticket.count({ where: { status: "Closed" } }),
    prisma.ticket.count({
      where: {
        OR: [
          { status: "Open", priority: "Critical", slaDueAt: { not: null, lte: now } },
          { status: "Pending", priority: "Critical", slaDueAt: { not: null, lte: now } },
          { status: "In Progress", priority: "Critical", slaDueAt: { not: null, lte: now } },
          { status: "Open", priority: "High", slaDueAt: { not: null, lte: addDays(now, hours.high) } },
          { status: "Pending", priority: "High", slaDueAt: { not: null, lte: addDays(now, hours.high) } },
          { status: "In Progress", priority: "High", slaDueAt: { not: null, lte: addDays(now, hours.high) } },
          { status: "Open", priority: "Medium", slaDueAt: { not: null, lte: addDays(now, hours.medium) } },
          { status: "Pending", priority: "Medium", slaDueAt: { not: null, lte: addDays(now, hours.medium) } },
          { status: "In Progress", priority: "Medium", slaDueAt: { not: null, lte: addDays(now, hours.medium) } },
          { status: "Open", priority: "Low", slaDueAt: { not: null, lte: addDays(now, hours.low) } },
          { status: "Pending", priority: "Low", slaDueAt: { not: null, lte: addDays(now, hours.low) } },
          { status: "In Progress", priority: "Low", slaDueAt: { not: null, lte: addDays(now, hours.low) } },
        ],
      },
    }),
    prisma.ticket.findFirst({
      where: { status: { in: ["Open", "Pending", "In Progress"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, ticketNumber: true },
    }),
  ]);

  return {
    open,
    pending,
    inProgress,
    resolved,
    closed,
    slaBreached,
    active: open + pending + inProgress,
    resolvedThisWeek: await prisma.ticket.count({ where: { resolvedAt: { gte: weekAgo } } }),
    oldestAge: oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 86400000)) : 0,
  };
}

export async function getTicketFull(id: string) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: { include: { area: true, package: true, router: true } },
      technician: true,
      area: true,
      package: true,
      createdBy: { select: { name: true } },
      comments: { orderBy: { createdAt: "asc" } },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Technicians                                                        */
/* ------------------------------------------------------------------ */

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
  open: number;
};

export async function listTechnicians() {
  const employees = await prisma.employee.findMany({
    where: { role: { contains: "Technician" } },
    include: { area: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const tickets = await prisma.ticket.groupBy({
    by: ["technicianId", "status"],
    _count: { _all: true },
  });

  const forTech = (id: string, statuses: string[]) =>
    tickets
      .filter((t) => t.technicianId === id && statuses.includes(t.status))
      .reduce((s, t) => s + t._count._all, 0);

  const todayAttendance = await prisma.attendance.findMany({
    where: { date: { gte: startOfDay(new Date()) } },
    select: { employeeId: true, status: true },
  });

  const rows: TechnicianRow[] = employees.map((e) => {
    const open = forTech(e.id, ["Open", "Pending", "In Progress"]);
    return {
      id: e.id,
      employeeCode: e.employeeCode,
      name: e.name,
      role: e.role,
      phone: e.phone,
      area: e.area,
      status: e.status,
      assigned: open,
      pending: forTech(e.id, ["Pending"]),
      completed: forTech(e.id, ["Resolved", "Closed"]),
      open,
    };
  });

  const available = rows.filter((r) => r.open === 0).length;

  return {
    rows,
    metrics: {
      total: rows.length,
      available,
      busy: rows.length - available,
      jobsToday: todayAttendance.length,
      openTickets: rows.reduce((s, r) => s + r.open, 0),
    },
    csv: {
      headers: ["Code", "Technician", "Role", "Phone", "Area", "Assigned", "Pending", "Completed", "Status"],
      filename: "technicians.csv",
      rows: rows.map((r) => [
        r.employeeCode,
        r.name,
        r.role,
        r.phone,
        r.area?.name ?? "",
        r.assigned,
        r.pending,
        r.completed,
        r.status,
      ]),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Complaints (a ticket filtered by category)                          */
/* ------------------------------------------------------------------ */

export async function listComplaints(p: ListParams = {}) {
  const result = await listTickets({
    ...p,
    q: p.q,
  });
  return {
    ...result,
    rows: result.rows.map((t) => ({ ...t, problem: t.category })),
  };
}

export async function complaintMetrics() {
  const rows = await prisma.ticket.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });
  const open = await prisma.ticket.count({
    where: { status: { in: ["Open", "Pending", "In Progress"] } },
  });
  return {
    total: rows.reduce((s, r) => s + r._count._all, 0),
    open,
    categories: rows.map((r) => ({ label: r.category, value: r._count._all })),
    byStatus: Object.fromEntries(
      COMPLAINT_CATEGORIES.map((c) => [c, rows.find((r) => r.category === c)?._count._all ?? 0])
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Employees                                                          */
/* ------------------------------------------------------------------ */

const employeeInclude = {
  area: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeInclude;

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

export async function listEmployees(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const and: Prisma.EmployeeWhereInput[] = [];
  if (p.status) and.push({ status: p.status });
  if (p.areaId) and.push({ areaId: p.areaId });
  if (p.q?.trim()) {
    const term = p.q.trim();
    and.push({
      OR: [
        { name: { contains: term } },
        { employeeCode: { contains: term } },
        { phone: { contains: term } },
        { role: { contains: term } },
      ],
    });
  }
  const where: Prisma.EmployeeWhereInput = and.length ? { AND: and } : {};

  const [total, rows, byStatus, roleGroups] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      include: { ...employeeInclude, _count: { select: { tickets: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.employee.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["role"], where, _count: { _all: true } }),
  ]);

  return {
    rows: rows as unknown as EmployeeRow[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      total,
      active: byStatus.find((r) => r.status === "Active")?._count._all ?? 0,
      onLeave: byStatus.find((r) => r.status === "On Leave")?._count._all ?? 0,
      technicians: roleGroups
        .filter((r) => r.role.includes("Technician"))
        .reduce((s, r) => s + r._count._all, 0),
    },
    csv: {
      headers: ["Employee ID", "Name", "Role", "Phone", "Area", "Joining Date", "Status"],
      filename: "employees.csv",
      rows: rows.map((e) => [
        e.employeeCode,
        e.name,
        e.role,
        e.phone,
        e.area?.name ?? "",
        e.joiningDate.toISOString().slice(0, 10),
        e.status,
      ]),
    },
  };
}

export async function getEmployeeFull(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    include: {
      area: { include: { zone: { select: { name: true } } } },
      attendances: { orderBy: { date: "desc" }, take: 60 },
      leaves: { orderBy: { startDate: "desc" } },
      salaries: { orderBy: { month: "desc" } },
      tickets: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { attendances: true, leaves: true, salaries: true, tickets: true } },
    },
  });
}

export async function employeeMetrics() {
  const [total, active, onLeave, technicians, pendingSalary] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { status: "Active" } }),
    prisma.employee.count({ where: { status: "On Leave" } }),
    prisma.employee.count({ where: { role: { contains: "Technician" } } }),
    prisma.salary.aggregate({ where: { status: "Pending" }, _sum: { netSalary: true }, _count: { _all: true } }),
  ]);
  return {
    total,
    active,
    onLeave,
    technicians,
    pendingSalaryAmount: round2(pendingSalary._sum.netSalary ?? 0),
    pendingSalaryCount: pendingSalary._count._all,
  };
}

/* ------------------------------------------------------------------ */
/* Attendance                                                         */
/* ------------------------------------------------------------------ */

export async function attendanceReport(p: ListParams = {}) {
  const date = p.from ? startOfDay(new Date(p.from)) : startOfDay(new Date());
  const rows = await prisma.attendance.findMany({
    where: { date },
    include: { employee: { select: { id: true, name: true, employeeCode: true, role: true, area: { select: { name: true } } } } },
    orderBy: { employee: { name: "asc" } },
  });

  const byStatus = ATTENDANCE_STATUSES.map((s) => ({
    label: s,
    value: rows.filter((r) => r.status === s).length,
  }));

  return {
    rows,
    date,
    metrics: {
      present: rows.filter((r) => r.status === "Present").length,
      absent: rows.filter((r) => r.status === "Absent").length,
      late: rows.filter((r) => r.status === "Late").length,
      onLeave: rows.filter((r) => r.status === "Leave").length,
      total: rows.length,
    },
    byStatus,
    csv: {
      headers: ["Employee", "Date", "Check In", "Check Out", "Status", "Note"],
      filename: "attendance.csv",
      rows: rows.map((r) => [
        r.employee.name,
        r.date.toISOString().slice(0, 10),
        r.checkIn?.toISOString() ?? "",
        r.checkOut?.toISOString() ?? "",
        r.status,
        r.note ?? "",
      ]),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Leave                                                              */
/* ------------------------------------------------------------------ */

export async function listLeaves(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const where: Prisma.LeaveWhereInput = {};
  if (p.status) where.status = p.status;
  if (p.q?.trim()) {
    const term = p.q.trim();
    where.employee = { name: { contains: term } };
  }

  const [total, rows, byStatus] = await Promise.all([
    prisma.leave.count({ where }),
    prisma.leave.findMany({
      where,
      include: { employee: { select: { id: true, name: true, employeeCode: true, role: true } } },
      orderBy: { startDate: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.leave.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: Object.fromEntries(
      LEAVE_STATUSES.map((s) => [s, byStatus.find((r) => r.status === s)?._count._all ?? 0])
    ),
    csv: {
      headers: ["Employee", "Leave Type", "From", "To", "Days", "Reason", "Status", "Approved By"],
      filename: "leave.csv",
      rows: rows.map((l) => [
        l.employee.name,
        l.leaveType,
        l.startDate.toISOString().slice(0, 10),
        l.endDate.toISOString().slice(0, 10),
        Math.max(1, Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1),
        l.reason ?? "",
        l.status,
        l.approvedBy ?? "",
      ]),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Salary                                                             */
/* ------------------------------------------------------------------ */

export async function salaryReport(p: ListParams = {}) {
  const month = p.from?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
  const rows = await prisma.salary.findMany({
    where: { month },
    include: { employee: { select: { id: true, name: true, employeeCode: true, role: true } } },
    orderBy: { netSalary: "desc" },
  });

  const paid = rows.filter((r) => r.status === "Paid");
  const pending = rows.filter((r) => r.status !== "Paid");

  return {
    rows,
    month,
    metrics: {
      total: round2(rows.reduce((s, r) => s + r.netSalary, 0)),
      paid: round2(paid.reduce((s, r) => s + r.netSalary, 0)),
      pending: round2(pending.reduce((s, r) => s + r.netSalary, 0)),
      advance: round2(rows.reduce((s, r) => s + r.advance, 0)),
      count: rows.length,
    },
    csv: {
      headers: ["Employee", "Month", "Basic", "Allowance", "Bonus", "Deduction", "Advance", "Net Salary", "Status"],
      filename: "salary.csv",
      rows: rows.map((r) => [
        r.employee.name,
        r.month,
        r.basic,
        r.allowance,
        r.bonus,
        r.deduction,
        r.advance,
        r.netSalary,
        r.status,
      ]),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

export async function listMessages(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;
  const and: Prisma.NotificationWhereInput[] = [];
  if (p.status) and.push({ status: p.status });
  if (p.channel) and.push({ channel: p.channel });
  if (p.q?.trim()) {
    const term = p.q.trim();
    and.push({
      OR: [
        { recipient: { contains: term } },
        { body: { contains: term } },
        { customer: { name: { contains: term } } },
      ],
    });
  }
  if (p.from || p.to) {
    const range: Prisma.DateTimeFilter = {};
    if (p.from) range.gte = startOfDay(new Date(p.from));
    if (p.to) {
      const t = new Date(p.to);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    and.push({ createdAt: range });
  }
  const where: Prisma.NotificationWhereInput = and.length ? { AND: and } : {};

  const [total, rows, byStatus, byChannel, credit] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      include: { customer: { select: { id: true, name: true, username: true } } },
      orderBy: { createdAt: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.notification.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["channel"], where, _count: { _all: true } }),
    prisma.smsCredit.findFirst({ orderBy: { date: "desc" } }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      balance: credit?.balance ?? 0,
      sent: byStatus.find((r) => r.status === "Sent")?._count._all ?? 0,
      failed: byStatus.find((r) => r.status === "Failed")?._count._all ?? 0,
      scheduled: byStatus.find((r) => r.status === "Scheduled")?._count._all ?? 0,
      byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c._count._all])),
    },
    csv: {
      headers: ["Date", "Recipient", "Channel", "Message", "Status", "Sent By"],
      filename: "messages.csv",
      rows: rows.map((n) => [
        n.createdAt.toISOString(),
        n.recipient,
        n.channel,
        n.body,
        n.status,
        n.sentById ?? "",
      ]),
    },
  };
}

export async function messageMetrics() {
  const [credit, sent, failed, today, byChannel] = await Promise.all([
    prisma.smsCredit.findFirst({ orderBy: { date: "desc" } }),
    prisma.notification.count({ where: { status: "Sent" } }),
    prisma.notification.count({ where: { status: "Failed" } }),
    prisma.notification.count({ where: { createdAt: { gte: startOfDay(new Date()) } } }),
    prisma.notification.groupBy({ by: ["channel"], _count: { _all: true } }),
  ]);
  return {
    balance: credit?.balance ?? 0,
    sent,
    failed,
    today,
    byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c._count._all])),
  };
}

export const enumOptions = {
  ticketStatus: TICKET_STATUSES,
  ticketPriority: TICKET_PRIORITIES,
  complaintCategory: COMPLAINT_CATEGORIES,
  attendance: ATTENDANCE_STATUSES,
  employeeStatus: EMPLOYEE_STATUSES,
  leaveStatus: LEAVE_STATUSES,
};
