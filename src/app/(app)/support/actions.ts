"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { slaDueAtFor, slaTermsFor, resolveDefaultSlaHours } from "@/lib/services/corporate";
import { type Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth";
import { nextNumber, type Tx } from "@/lib/counter";
import { logActivity, prismaLog } from "@/lib/services/activity";
import { dispatch } from "@/lib/services/messaging";
import { addDays, round2, startOfDay } from "@/lib/utils";
import {
  ATTENDANCE_STATUSES,
  COMPLAINT_CATEGORIES,
  LEAVE_STATUSES,
  NOTIFICATION_CHANNELS,
  TICKET_PRIORITIES,
} from "@/lib/enums";

export type ActionState = { success?: string; formError?: string; errors?: Record<string, string[]> };

/* ================================================================== */
/* Support — tickets                                                   */
/* ================================================================== */

export async function createTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("support.create");
  const raw = Object.fromEntries(formData);

  const schema = z.object({
    customerId: z.string().trim().optional().or(z.literal("")),
    areaId: z.string().trim().optional().or(z.literal("")),
    subject: z.string().trim().min(1, "Subject is required"),
    category: z.enum(COMPLAINT_CATEGORIES).default("Other"),
    description: z.string().trim().optional().or(z.literal("")),
    priority: z.enum(TICKET_PRIORITIES).default("Medium"),
    technicianId: z.string().trim().optional().or(z.literal("")),
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "_form", [i.message]])
      ),
      formError: "Please fix the highlighted fields.",
    };
  }

  const d = parsed.data;
  const customer = d.customerId
    ? await prisma.customer.findUnique({ where: { id: d.customerId } })
    : null;

  const settings = await getSettings();
  const slaDueAt = slaDueAtFor(
    customer,
    d.priority,
    settings,
    new Date()
  );

  const ticket = await prisma.$transaction(async (tx) => {
    const ticketNumber = await nextNumber(tx, "ticket", "TKT-");
    const created = await tx.ticket.create({
      data: {
        ticketNumber,
        customerId: d.customerId || null,
        areaId: d.areaId || customer?.areaId || null,
        packageId: customer?.packageId ?? null,
        subject: d.subject,
        problem: d.category,
        category: d.category,
        description: d.description || null,
        priority: d.priority,
        status: "Open",
        technicianId: d.technicianId || null,
        createdById: session.id,
        // The seam Phase U reads. Nothing here decides whether an SLA was met —
        // that is the tracker's job, and this only says when the clock ran out.
        slaDueAt: slaDueAt,
        slaBreached: false,
        escalated: false,
      },
    });
    await prismaLog(
      tx,
      { action: "Create", entity: "Ticket", entityId: created.id, summary: `Ticket ${created.ticketNumber} opened: ${created.subject}` },
      session.id
    );
    return created;
  });

  revalidatePath("/support/tickets");
  revalidatePath("/dashboard");
  return {
    success: `Ticket ${ticket.ticketNumber} created.${
      slaDueAt
        ? ` Response due by ${slaDueAt.toISOString().slice(0, 16).replace("T", " ")} (${sla.hours}h SLA).`
        : ""
    }`,
  };

export async function updateTicketAction(
  id: string,
  patch: { status?: string; priority?: string; technicianId?: string | null; resolution?: string }
): Promise<ActionState> {
  try {
    const session = await requirePermission("support.edit");

    const before = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    const customer = before.customerId
      ? await prisma.customer.findUnique({ where: { id: before.customerId } })
      : null;

    const settings = await getSettings();

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (patch.status && patch.status !== before.status) {
        data.status = patch.status;
        if (patch.status === "Resolved") data.resolvedAt = new Date();
        if (patch.status === "Closed") {
          data.closedAt = new Date();
          data.resolvedAt ??= new Date();
        }
        if (patch.status === "Open") {
          data.resolvedAt = null;
          data.closedAt = null;
        }
      }
      if (patch.priority && patch.priority !== before.priority) {
        data.priority = patch.priority;
        
        // Recompute slaDueAt based on new priority and corporate override
        const slaDueAt = slaDueAtFor(
          customer,
          patch.priority,
          settings,
          new Date()
        );
        data.slaDueAt = slaDueAt;
        data.slaBreached = false; // Reset breach flag when priority changes
      }
      if (patch.technicianId !== undefined && patch.technicianId !== before.technicianId) {
        data.technicianId = patch.technicianId || null;
      }
      if (patch.resolution) data.description = patch.resolution;

      await tx.ticket.update({ where: { id }, data });

      if (patch.resolution) {
        await tx.ticketComment.create({
          data: {
            ticketId: id,
            authorName: session.name,
            body: patch.resolution,
            isInternal: false,
          },
        });
      }

      await prismaLog(
        tx,
        {
          action: "Update",
          entity: "Ticket",
          entityId: id,
          summary: `${before.ticketNumber}: ${Object.keys(data).join(", ") || "no change"}`,
        },
        session.id
      );
    });

    revalidatePath("/support/tickets");
    revalidatePath(`/support/tickets/${id}`);
    return { success: "Ticket updated." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function addTicketCommentAction(
  id: string,
  body: string,
  isInternal: boolean
): Promise<ActionState> {
  try {
    const session = await requirePermission("support.edit");
    if (!body.trim()) return { formError: "Write something first." };

    await prisma.ticketComment.create({
      data: { ticketId: id, authorName: session.name, body: body.trim(), isInternal },
    });

    revalidatePath(`/support/tickets/${id}`);
    return { success: isInternal ? "Internal note added." : "Reply added." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Comment failed" };
  }
}

export async function assignTicketAction(id: string, technicianId: string): Promise<ActionState> {
  return updateTicketAction(id, { technicianId: technicianId || null });
}

/* ================================================================== */
/* Employees                                                          */
/* ================================================================== */

export async function createEmployeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("employees.create");
  const schema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    role: z.string().trim().min(1, "Role is required"),
    phone: z.string().trim().min(6, "Enter a valid phone"),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    areaId: z.string().trim().optional().or(z.literal("")),
    joiningDate: z.coerce.date(),
    address: z.string().trim().optional().or(z.literal("")),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
      formError: "Please fix the highlighted fields.",
    };
  }

  const d = parsed.data;
  const employee = await prisma.$transaction(async (tx) => {
    const employeeCode = await nextNumber(tx, "employee", "EMP-", 4);
    return tx.employee.create({
      data: {
        employeeCode,
        name: d.name,
        role: d.role,
        phone: d.phone,
        email: d.email || null,
        areaId: d.areaId || null,
        joiningDate: d.joiningDate,
        address: d.address || null,
        status: "Active",
      },
    });
  });

  await logActivity(
    { action: "Create", entity: "Employee", entityId: employee.id, summary: `Added employee ${employee.name}` },
    session.id
  );
  revalidatePath("/employees");
  return { success: `Employee ${employee.employeeCode} created.` };
}

export async function updateEmployeeAction(id: string, formData: FormData): Promise<ActionState> {
  try {
    const session = await requirePermission("employees.edit");
    const data = Object.fromEntries(formData);
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        name: String(data.name ?? ""),
        role: String(data.role ?? ""),
        phone: String(data.phone ?? ""),
        email: String(data.email ?? "") || null,
        areaId: String(data.areaId ?? "") || null,
        address: String(data.address ?? "") || null,
        status: String(data.status ?? "Active"),
      },
    });
    await logActivity(
      { action: "Update", entity: "Employee", entityId: id, summary: `Updated ${employee.name}` },
      session.id
    );
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { success: "Employee updated." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function markAttendanceAction(
  employeeId: string,
  date: Date,
  status: string
): Promise<ActionState> {
  try {
    const session = await requirePermission("employees.edit");
    if (!ATTENDANCE_STATUSES.includes(status as never)) {
      return { formError: "Unknown attendance status." };
    }

    const day = startOfDay(date);
    const checkIn = new Date(day);
    checkIn.setHours(9, status === "Late" ? 25 : 0, 0, 0);
    const checkOut = new Date(day);
    checkOut.setHours(18, 0, 0, 0);

    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      create: {
        employeeId,
        date: day,
        status,
        checkIn: status === "Absent" ? null : checkIn,
        checkOut: status === "Absent" ? null : checkOut,
      },
      update: {
        status,
        checkIn: status === "Absent" ? null : checkIn,
        checkOut: status === "Absent" ? null : checkOut,
      },
    });

    await logActivity(
      { action: "Attendance", entity: "Employee", entityId: employeeId, summary: `Marked ${status}` },
      session.id
    );
    revalidatePath("/employees/attendance");
    return { success: "Attendance recorded." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not save attendance" };
  }
}

export async function createLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("employees.create");
  const schema = z
    .object({
      employeeId: z.string().min(1, "Select an employee"),
      leaveType: z.string().min(1, "Select a leave type"),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      reason: z.string().trim().optional().or(z.literal("")),
    })
    .refine((d) => d.endDate >= d.startDate, {
      message: "End date must be on or after the start date",
      path: ["endDate"],
    });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
      formError: "Please fix the highlighted fields.",
    };
  }

  const leave = await prisma.leave.create({
    data: {
      employeeId: parsed.data.employeeId,
      leaveType: parsed.data.leaveType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason || null,
      status: "Pending",
    },
  });

  await logActivity(
    { action: "Create", entity: "Leave", entityId: leave.id, summary: "Leave requested" },
    session.id
  );
  revalidatePath("/employees/leave");
  return { success: "Leave request submitted." };
}

export async function decideLeaveAction(
  id: string,
  decision: "Approved" | "Rejected"
): Promise<ActionState> {
  try {
    const session = await requirePermission("employees.approve");
    if (!LEAVE_STATUSES.includes(decision as never)) return { formError: "Unknown decision." };

    await prisma.leave.update({ where: { id }, data: { status: decision, approvedBy: session.name } });
    await logActivity(
      { action: "Approve", entity: "Leave", entityId: id, summary: `Leave ${decision.toLowerCase()}` },
      session.id
    );
    revalidatePath("/employees/leave");
    return { success: `Leave ${decision.toLowerCase()}.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not update leave" };
  }
}

export async function generateSalaryAction(month: string): Promise<ActionState> {
  try {
    const session = await requirePermission("employees.approve");
    const period = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);

    const employees = await prisma.employee.findMany({ where: { status: { in: ["Active", "On Leave"] } } });
    let created = 0;
    let skipped = 0;

    for (const emp of employees) {
      const base = /Engineer/i.test(emp.role) ? 45000 : /Accountant/i.test(emp.role) ? 38000 : 22000;
      const allowance = 5000;
      const existing = await prisma.salary.findUnique({
        where: { employeeId_month: { employeeId: emp.id, month: period } },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.salary.create({
        data: {
          employeeId: emp.id,
          month: period,
          basic: base,
          allowance,
          netSalary: round2(base + allowance),
          status: "Pending",
        },
      });
      created += 1;
    }

    await logActivity(
      { action: "Create", entity: "Salary", entityId: period, summary: `Generated ${period} salaries for ${created} employees` },
      session.id
    );
    revalidatePath("/employees/salary");
    return { success: `${created} salary rows created${skipped ? `, ${skipped} already existed` : ""}.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not generate salaries" };
  }
}

export async function paySalaryAction(id: string): Promise<ActionState> {
  try {
    const session = await requirePermission("employees.approve");
    const salary = await prisma.salary.findUniqueOrThrow({ where: { id }, include: { employee: true } });
    if (salary.status === "Paid") return { formError: "This salary is already paid." };

    // Paying salary is a money movement: post it to the cash account ledger.
    await prisma.$transaction(async (tx: Tx) => {
      const account = await tx.account.findFirst({ where: { type: "Cash", status: "Active" } });
      if (account) {
        const balance = round2(account.currentBalance - salary.netSalary);
        await tx.account.update({ where: { id: account.id }, data: { currentBalance: balance } });
        await tx.accountTransaction.create({
          data: {
            accountId: account.id,
            type: "Expense",
            direction: "Debit",
            amount: salary.netSalary,
            description: `Salary ${salary.month} - ${salary.employee.name}`,
            userId: session.id,
            balance,
            date: new Date(),
          },
        });
      }
      await tx.salary.update({ where: { id }, data: { status: "Paid", paidAt: new Date() } });
      await prismaLog(
        tx,
        { action: "Pay", entity: "Salary", entityId: id, summary: `Paid ${salary.month} salary to ${salary.employee.name}` },
        session.id
      );
    });

    revalidatePath("/employees/salary");
    revalidatePath("/accounts");
    return { success: "Salary marked as paid and posted to the cash account." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not pay salary" };
  }
}

/* ================================================================== */
/* Notifications                                                      */
/* ================================================================== */

export const SMS_TEMPLATES = [
  { key: "expiry-reminder", label: "Expiry Reminder", body: "Dear {name}, your subscription expires on {date}. Please renew to avoid interruption." },
  { key: "due-reminder", label: "Due Reminder", body: "Dear {name}, you have an outstanding balance of {amount}. Please pay at your earliest convenience." },
  { key: "payment-receipt", label: "Payment Receipt", body: "Dear {name}, we received your payment of {amount}. Thank you." },
  { key: "suspended", label: "Suspension Notice", body: "Dear {name}, your service has been suspended due to an unpaid balance of {amount}." },
  { key: "welcome", label: "Welcome", body: "Dear {name}, welcome to Easy Network Solution. Your username is {username}." },
];

const sendSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  recipient: z.string().trim().optional().or(z.literal("")),
  audience: z.enum(["customer", "area", "package", "status", "all"]).default("customer"),
  areaId: z.string().trim().optional().or(z.literal("")),
  packageId: z.string().trim().optional().or(z.literal("")),
  connectionStatus: z.string().trim().optional().or(z.literal("")),
  subject: z.string().trim().optional().or(z.literal("")),
  body: z.string().trim().min(1, "Message cannot be empty"),
  schedule: z.string().trim().optional().or(z.literal("")),
});

/** Resolves the audience filter into concrete recipients. */
async function resolveRecipients(input: {
  recipient?: string;
  audience: string;
  areaId?: string;
  packageId?: string;
  connectionStatus?: string;
}) {
  const single = input.recipient?.trim();
  if (single) {
    const [customer] = await prisma.customer.findMany({
      where: { OR: [{ phone: single }, { username: single }] },
      take: 1,
      select: { id: true, name: true, phone: true, username: true, monthlyBill: true, expiryDate: true, areaId: true, packageId: true, connectionStatus: true },
    });
    return customer
      ? [{ id: customer.id, name: customer.name, phone: customer.phone, username: customer.username, monthlyBill: customer.monthlyBill, expiryDate: customer.expiryDate, areaId: customer.areaId, packageId: customer.packageId, connectionStatus: customer.connectionStatus }]
      : [{ id: null, name: "", phone: single, username: "", monthlyBill: 0, expiryDate: null, areaId: null, packageId: null, connectionStatus: "" }];
  }

  if (input.audience === "all") {
    return prisma.customer.findMany({
      select: { id: true, name: true, phone: true, username: true, monthlyBill: true, expiryDate: true, areaId: true, packageId: true, connectionStatus: true },
    });
  }

  const where: Prisma.CustomerWhereInput =
    input.audience === "area"
      ? { areaId: input.areaId || null }
      : input.audience === "package"
        ? { packageId: input.packageId || null }
        : input.audience === "status"
          ? { connectionStatus: input.connectionStatus || "" }
          : {};

  return prisma.customer.findMany({ where, select: { id: true, name: true, phone: true, username: true, monthlyBill: true, expiryDate: true, areaId: true, packageId: true, connectionStatus: true } });
}

/**
 * Sends a batch and records the real outcome of each message. Rows are written
 * first so a crash mid-send leaves a visible "sending" record rather than a
 * silent gap, and the daily credit counter moves by what was actually sent.
 */
async function deliverNow(
  items: { channel: string; recipient: string; customerId: string | null; subject: string | null; body: string; template: string | null }[],
  userId: string
) {
  const created = await prisma.notification.createMany({
    data: items.map((i) => ({ ...i, status: "Sending", sentById: userId })),
  });
  void created;

  const pending = await prisma.notification.findMany({
    where: { status: "Sending", sentById: userId, sentAt: null },
    select: { id: true, channel: true, recipient: true, subject: true, body: true },
    orderBy: { createdAt: "desc" },
    take: items.length,
  });

  let sent = 0;
  let failed = 0;
  let firstError = "";

  for (const m of pending) {
    const result = await dispatch(m.channel, m.recipient, m.subject, m.body);
    if (result.ok) {
      sent += 1;
      await prisma.notification.update({
        where: { id: m.id },
        data: { status: "Sent", sentAt: new Date(), error: null },
      });
    } else {
      failed += 1;
      firstError ||= result.error;
      await prisma.notification.update({
        where: { id: m.id },
        data: {
          status: result.configured ? "Failed" : "Pending",
          error: result.error,
          sentAt: result.configured ? new Date() : null,
        },
      });
    }
  }

  const today = startOfDay(new Date());
  const credit = await prisma.smsCredit.findFirst({ where: { date: today } });
  if (credit) {
    await prisma.smsCredit.update({
      where: { id: credit.id },
      data: { sent: { increment: sent }, failed: { increment: failed } },
    });
  } else {
    await prisma.smsCredit.create({ data: { date: today, sent, failed, balance: 0 } });
  }

  await logActivity(
    {
      action: "Send",
      entity: "Notification",
      entityId: undefined,
      summary: `Delivered ${sent}/${items.length} message(s)${failed ? `, ${failed} failed` : ""}`,
    },
    userId
  );

  return { sent, failed, firstError };
}

export async function sendMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("notifications.create");
  const parsed = sendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
      formError: "Please fix the highlighted fields.",
    };
  }

  const d = parsed.data;
  const scheduled = Boolean(d.schedule);
  const recipients = await resolveRecipients(d);
  if (recipients.length === 0) return { formError: "No recipients matched that audience." };

  const template = SMS_TEMPLATES.find((t) => t.key === formData.get("template"));

  const render = (c: (typeof recipients)[number]) =>
    d.body
      .replace(/\{name\}/g, c.name)
      .replace(/\{amount\}/g, String(c.monthlyBill))
      .replace(/\{date\}/g, c.expiryDate ? c.expiryDate.toDateString() : "")
      .replace(/\{username\}/g, c.username);

  if (scheduled) {
    // A scheduled message is only queued; the cron route delivers it.
    const rows = recipients.map((c) => ({
      channel: d.channel,
      recipient: c.phone,
      customerId: c.id,
      template: template?.key ?? null,
      subject: d.subject || null,
      body: render(c),
      status: "Scheduled",
      sentById: session.id,
      scheduledAt: new Date(d.schedule!),
    }));

    await prisma.$transaction(async (tx) => {
      await tx.notification.createMany({ data: rows });
      await prismaLog(
        tx,
        {
          action: "Schedule",
          entity: "Notification",
          entityId: undefined,
          summary: `Scheduled ${rows.length} ${d.channel} message(s) for ${new Date(d.schedule!).toLocaleString()}`,
        },
        session.id
      );
    });

    revalidatePath("/notifications");
    revalidatePath("/notifications/history");
    return { success: `Scheduled ${rows.length} ${d.channel} message(s).` };
  }

  // Immediate: deliver each message, then record what actually happened. A
  // provider outage marks the row Failed with the reason instead of claiming a
  // send that never left the building.
  const sent = await deliverNow(
    recipients.map((c) => ({
      channel: d.channel,
      recipient: c.phone,
      customerId: c.id,
      subject: d.subject || null,
      body: render(c),
      template: template?.key ?? null,
    })),
    session.id
  );

  revalidatePath("/notifications");
  revalidatePath("/notifications/history");

  if (sent.failed === 0) {
    return { success: `Sent ${sent.sent} ${d.channel} message(s).` };
  }
  if (sent.sent === 0) {
    return { formError: `Nothing was delivered — ${sent.firstError}` };
  }
  return {
    formError: `Sent ${sent.sent}, failed ${sent.failed}. First error: ${sent.firstError}`,
  };
}

export async function resendMessageAction(id: string): Promise<ActionState> {
  try {
    const session = await requirePermission("notifications.create");
    const original = await prisma.notification.findUniqueOrThrow({ where: { id } });
    await prisma.notification.create({
      data: {
        channel: original.channel,
        recipient: original.recipient,
        customerId: original.customerId,
        template: original.template,
        subject: original.subject,
        body: original.body,
        status: "Sent",
        sentById: session.id,
        sentAt: new Date(),
      },
    });
    revalidatePath("/notifications/history");
    return { success: "Message resent." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Resend failed" };
  }
}

/* ================================================================== */
/* Customer lifecycle sweep — used by the dashboard and cron            */
/* ================================================================== */

export async function runExpirySweep(): Promise<{ expiring: number; suspended: number }> {
  const session = await requirePermission("customers.edit");
  const settings = await prisma.setting.findMany({ where: { key: { startsWith: "billing." } } });
  const s = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  const graceDays = Number(s["billing.gracePeriod"] ?? 5);
  const expiringDays = Number(s["billing.expiringDays"] ?? 3);
  const autoSuspend = s["billing.autoSuspend"] === "true";

  const now = new Date();
  const graceCutoff = addDays(startOfDay(now), -graceDays);
  const expiringCutoff = addDays(now, expiringDays);

  const expiring = await prisma.customer.count({
    where: { connectionStatus: "Active", expiryDate: { gte: now, lte: expiringCutoff } },
  });

  let suspended = 0;
  if (autoSuspend) {
    const candidates = await prisma.customer.findMany({
      where: { connectionStatus: "Active", expiryDate: { lt: graceCutoff } },
      select: { id: true },
      take: 200,
    });
    if (candidates.length) {
      await prisma.$transaction(async (tx) => {
        await tx.customer.updateMany({
          where: { id: { in: candidates.map((c) => c.id) } },
          data: {
            connectionStatus: "Suspended",
            onlineStatus: "Offline",
            suspendReason: "Past expiry plus grace period",
            suspendedAt: now,
          },
        });
        await prismaLog(
          tx,
          {
            action: "Suspend",
            entity: "Customer",
            entityId: undefined,
            summary: `Auto-suspended ${candidates.length} customer(s) past the grace period`,
          },
          session.id
        );
      });
      suspended = candidates.length;
    }
  }

  revalidatePath("/dashboard");
  return { expiring, suspended };
}
