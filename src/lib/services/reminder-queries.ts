/**
 * Reads for the RADIUS-style reminder history: the Reminders page and a
 * customer's own reminder trail on their profile.
 *
 * Separate from `listMessages` because a reminder is not just a message with a
 * status — the questions an operator asks of it are "which channel actually went
 * out", "was it a fallback" and "which day of the sequence was this", and none of
 * those are answerable from the message table alone.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { REMINDER_TEMPLATES } from "@/lib/services/reminders";
import { DEFAULT_PER_PAGE, type ListParams } from "@/lib/query";
import { startOfDay } from "@/lib/utils";

export type ReminderRow = {
  id: string;
  idempotencyKey: string | null;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  recipient: string;
  channel: string;
  status: string;
  body: string;
  template: string | null;
  notes: string | null;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
  scheduledAt: Date | null;
};

/** `reminder:{customerId}:{invoiceId}:{kind}:{dayOffset}` → its parts. */
export function describeKey(key: string | null): {
  kind: "expiry" | "due" | null;
  dayOffset: number | null;
  invoiceId: string | null;
} {
  if (!key?.startsWith("reminder:")) return { kind: null, dayOffset: null, invoiceId: null };
  const [, , invoiceId, kind, day] = key.split(":");
  const n = Number(day);
  return {
    kind: kind === "expiry" || kind === "due" ? kind : null,
    dayOffset: Number.isInteger(n) ? n : null,
    invoiceId: invoiceId && invoiceId !== "none" ? invoiceId : null,
  };
}

export async function listReminders(p: ListParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? DEFAULT_PER_PAGE;

  const and: Prisma.NotificationWhereInput[] = [
    // Scoped by template, not by "carries an idempotency key". Both were true of
    // reminders alone until Phase L added fiber-outage messages, which are
    // exactly-once too — so a key no longer means "reminder", and filtering on it
    // put outage notices on this page. Named in the scheduler that writes them, so
    // the two cannot drift apart.
    { template: { in: [...REMINDER_TEMPLATES] } },
  ];
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
  const where: Prisma.NotificationWhereInput = { AND: and };

  const [total, rows, byStatus, byChannel, byKind] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { createdAt: p.dir ?? "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.notification.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["channel"], where, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["template"], where, _count: { _all: true } }),
  ]);

  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    metrics: {
      sent: byStatus.find((r) => r.status === "Sent")?._count._all ?? 0,
      failed: byStatus.find((r) => r.status === "Failed")?._count._all ?? 0,
      scheduled: byStatus.find((r) => r.status === "Scheduled")?._count._all ?? 0,
      byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c._count._all])),
      expiry: byKind.find((r) => r.template === "expiry-reminder")?._count._all ?? 0,
      due: byKind.find((r) => r.template === "due-reminder")?._count._all ?? 0,
    },
  };
}

/** One customer's reminder trail, newest first. */
export async function customerReminders(customerId: string, take = 20) {
  return prisma.notification.findMany({
    where: { customerId, idempotencyKey: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      idempotencyKey: true,
      channel: true,
      status: true,
      template: true,
      body: true,
      notes: true,
      error: true,
      createdAt: true,
      sentAt: true,
    },
  });
}
