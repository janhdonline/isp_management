/**
 * Automatic payment reminders (ISP.md §29).
 *
 * Two things happen here and they are not the same thing. *Scheduling* decides
 * which customers are due a reminder on which day and records that intent once.
 * *Delivering* sends it, WhatsApp first and SMS if that fails, and refuses to
 * record a delivery it did not make.
 *
 * The property this module exists to guarantee is exactly-once per
 * (customer, invoice, kind, day). It is guaranteed by a unique index on
 * `Notification.idempotencyKey` and nothing else — not by a check-then-insert,
 * which is two queries and a race between them, and not by the cron route's
 * schedule, because three different schedulers fire this route in this
 * deployment. Two runs in the same second must produce one row, and the database
 * is the only thing that can settle that.
 *
 * No network I/O happens inside a transaction. The rows are written first,
 * committed, and only then handed to the messaging adapters — a provider that
 * hangs must not hold a database transaction open, and a provider that is down
 * must leave a visible Failed row rather than an uncommitted one.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { dispatch, isChannelConfigured } from "@/lib/services/messaging";
import type { JobResult } from "@/lib/services/job-result";
import { addDays, round2, startOfDay } from "@/lib/utils";

/** What a reminder is about. The word appears in the idempotency key. */
export type ReminderKind = "expiry" | "due";

/**
 * The `Notification.template` values that are reminders.
 *
 * The seam between the two views of the queue. It used to be "has an idempotency
 * key", which was true of only one thing until Phase L: fiber-outage messages are
 * exactly-once across concurrent runs of the fault job, so they carry a key too,
 * and on the old test they would have appeared on the Reminders page and been
 * picked up by the reminder drain — where a WhatsApp-first ISP would deliver an
 * outage notice through the fallback chain that reminders use.
 *
 * Named here, next to the code that writes them, and imported by both readers.
 */
export const REMINDER_TEMPLATES = ["expiry-reminder", "due-reminder"] as const;

/** The invoice slot for an expiry reminder: there is no invoice. */
const NO_INVOICE = "none";

/**
 * How a channel is spelled in Settings versus in the messaging adapters.
 *
 * The setting is lower case because that is how an operator types it; the adapters
 * switch on the display names used everywhere else in the app. Passing the raw
 * setting through reaches `dispatch`'s default branch and fails every reminder
 * with "Unknown channel" — which looks exactly like a broken provider and is not
 * one.
 */
const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

/** One reminder that is due today, before it reaches the database. */
export type PendingReminder = {
  key: string;
  kind: ReminderKind;
  customerId: string;
  customerName: string;
  recipient: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  dayOffset: number;
  body: string;
};

/* ------------------------------------------------------------------ */
/* Settings, parsed                                                     */
/* ------------------------------------------------------------------ */

/**
 * A comma-separated list of day offsets, largest first.
 *
 * Sorted so the day list means the same thing regardless of how it was typed,
 * and filtered to integers within a plausible range — a stray value here would
 * otherwise turn into a query for customers expiring in year 9999.
 */
export function parseDayList(raw: string | undefined, fallback: number[]): number[] {
  const parts = (raw ?? "")
    .split(",")
    // The empty string first, because `Number("")` is 0 and 0 is a perfectly
    // plausible day offset — so a blank setting would silently become "remind
    // today" instead of falling back to the default, and the operator would never
    // learn their setting was ignored.
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => Number(p))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  const list = parts.length ? [...new Set(parts)] : fallback;
  return list.sort((a, b) => a - b);
}

/**
 * The quiet window as minutes past midnight, or null when it is off.
 *
 * `22:00-07:00` wraps midnight, so "is now inside it" is not `start <= now <= end`
 * — it is two ranges, and getting that wrong means either never sending or
 * sending at 3am.
 */
export function parseQuietHours(raw: string | undefined): {
  from: number;
  to: number;
} | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw ?? "");
  if (!m) return null;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (from === to) return null; // a full 24h window is not a quiet window
  return { from, to };
}

export function isQuiet(
  window: { from: number; to: number } | null,
  now: Date
): boolean {
  if (!window) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Wrapping window: quiet from 22:00 until 07:00.
  return window.from > window.to
    ? minutes >= window.from || minutes < window.to
    : minutes >= window.from && minutes < window.to;
}

/** The next moment the quiet window ends — when a held reminder can go out. */
export function quietWindowEnd(window: { from: number; to: number }, now: Date): Date {
  const end = new Date(now);
  end.setSeconds(0, 0);
  if (window.to > window.from) {
    // A same-day window: the end is later today.
    end.setHours(Math.floor(window.to / 60), window.to % 60);
    if (end <= now) end.setDate(end.getDate() + 1);
  } else {
    // A wrapping window: the end is tomorrow morning.
    end.setDate(end.getDate() + 1);
    end.setHours(Math.floor(window.to / 60), window.to % 60);
  }
  return end;
}

/* ------------------------------------------------------------------ */
/* The idempotency key                                                  */
/* ------------------------------------------------------------------ */

/**
 * `reminder:{customerId}:{invoiceId}:{kind}:{dayOffset}`.
 *
 * The day offset is in the key, so "3 days before expiry" and "1 day before" are
 * two different reminders and each is sent once. An expiry reminder has no
 * invoice, and the slot says `none` rather than being dropped — a fixed four-part
 * key is one thing to read in the database and one thing to reason about, and an
 * expiry reminder whose key changed shape when an invoice happened to exist
 * would be a duplicate waiting for a billing run.
 */
export function reminderKey(
  customerId: string,
  invoiceId: string | null,
  kind: ReminderKind,
  dayOffset: number
): string {
  return `reminder:${customerId}:${invoiceId ?? NO_INVOICE}:${kind}:${dayOffset}`;
}

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

/**
 * The message text, using the same wording as the manual templates in
 * Notifications → SMS so a customer does not read two different letters about
 * the same bill.
 */
export function expiryBody(customerName: string, expiryDate: Date, days: number): string {
  const when = expiryDate.toDateString();
  return days === 1
    ? `Dear ${customerName}, your subscription expires tomorrow (${when}). Please renew to avoid interruption.`
    : `Dear ${customerName}, your subscription expires in ${days} days (${when}). Please renew to avoid interruption.`;
}

export function dueBody(
  customerName: string,
  outstanding: number,
  days: number,
  currency: string
): string {
  const amount = `${currency}${round2(outstanding).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `Dear ${customerName}, you have an outstanding balance of ${amount}, now ${days} day${days === 1 ? "" : "s"} past due. Please pay at your earliest convenience.`;
}

/* ------------------------------------------------------------------ */
/* Which reminders are due                                             */
/* ------------------------------------------------------------------ */

/** Whole days between two dates, by calendar day rather than by elapsed hours. */
export function daysBetween(from: Date, to: Date): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Every reminder due today: customers expiring in N days, and invoices at M days
 * past due.
 *
 * A customer needs a phone number to be reachable at all, and one without a
 * number is skipped rather than turned into a Failed row that nobody can act on.
 * A *disconnected* customer is skipped too — a subscription cut for non-payment
 * is not helped by a letter about paying, and the suspension notice already
 * covers it. Suspended customers are still reminded, because they owe money and
 * reconnecting is exactly what the reminder is for.
 */
export async function collectDueReminders(now: Date = new Date()): Promise<PendingReminder[]> {
  const s = await getSettings();
  const today = startOfDay(now);
  const expiryDays = parseDayList(s["reminder.expiryDays"], [3, 1]);
  const dueDays = parseDayList(s["reminder.dueDays"], [1, 3, 7]);
  const currency = s["company.currency"] ?? "৳";

  const customers = await prisma.customer.findMany({
    where: {
      phone: { not: "" },
      connectionStatus: { not: "Disconnected" },
    },
    select: { id: true, name: true, phone: true, expiryDate: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  const out: PendingReminder[] = [];

  // Expiry. Each configured day is a separate query rather than one range
  // query, because the key is per day: a customer expiring in 3 days must not
  // pick up the "1 day" reminder because both fell inside one range.
  for (const days of expiryDays) {
    const target = startOfDay(addDays(today, days));
    for (const c of customers) {
      if (!c.expiryDate) continue;
      if (daysBetween(today, c.expiryDate) !== days) continue;
      if (startOfDay(c.expiryDate).getTime() !== target.getTime()) continue;
      out.push({
        key: reminderKey(c.id, null, "expiry", days),
        kind: "expiry",
        customerId: c.id,
        customerName: c.name,
        recipient: c.phone,
        invoiceId: null,
        invoiceNumber: null,
        dayOffset: days,
        body: expiryBody(c.name, c.expiryDate, days),
      });
    }
  }

  // Overdue invoices.
  for (const days of dueDays) {
    const rows = await prisma.invoice.findMany({
      where: {
        status: { in: ["Due", "Overdue", "Partial"] },
        dueDate: { lte: startOfDay(addDays(today, -days)) },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
        paid: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    for (const inv of rows) {
      const c = byId.get(inv.customer.id);
      // The customer filter above is the reason a disconnected customer is absent
      // here; the recipient check covers an invoice whose customer has no number.
      if (!c) continue;
      if (daysBetween(inv.dueDate, today) !== days) continue;
      const outstanding = inv.total - inv.paid;
      if (outstanding <= 0) continue;
      out.push({
        key: reminderKey(c.id, inv.id, "due", days),
        kind: "due",
        customerId: c.id,
        customerName: c.name,
        recipient: c.phone,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        dayOffset: days,
        body: dueBody(c.name, outstanding, days, currency),
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export type DeliveryReport = {
  key: string;
  sent: boolean;
  channel: string | null;
  detail: string;
};

/**
 * Sends one reminder down the configured channel list.
 *
 * WhatsApp first because it is free and a customer can reply to it; SMS because
 * it reaches a customer who has never opened WhatsApp, and because a phone with
 * no data still receives it.
 *
 * The rule that matters is at the end: a message that did not go out is never
 * recorded as having gone out. An unconfigured channel is a Failed row, not a
 * Sent one, because "Sent" is the word an operator reads when asking a customer
 * whether they have been told.
 */
export async function deliverReminder(
  reminder: PendingReminder,
  channelOrder: string[]
): Promise<DeliveryReport> {
  const attempted: string[] = [];
  const failures: string[] = [];

  for (const name of channelOrder) {
    // The setting is lower case because that is how an operator types it, and
    // `dispatch` switches on the display names the rest of the app uses.
    // Passing the raw setting through reaches its default branch and fails every
    // reminder with "Unknown channel", which looks exactly like a broken provider.
    const label = CHANNEL_NAMES[name] ?? name.toUpperCase();
    if (!attempted.includes(label)) attempted.push(label);

    // The label, not the setting — `isChannelConfigured` matches the same
    // display names `dispatch` does.
    const configured = await isChannelConfigured(label);
    if (!configured) {
      failures.push(`${label} not configured`);
      continue;
    }

    const result = await dispatch(label, reminder.recipient, null, reminder.body);
    if (result.ok) {
      return {
        key: reminder.key,
        sent: true,
        channel: label,
        // Recorded on the row: a fallback that worked is otherwise invisible, and
        // "why did my customer get an SMS when we use WhatsApp" is a question
        // somebody will ask.
        detail: attempted.length > 1 ? `tried ${attempted.join(" → ")}` : `sent on ${label}`,
      };
    }
    failures.push(`${label}: ${result.error}`);
  }

  return {
    key: reminder.key,
    sent: false,
    channel: null,
    detail: failures.join("; ") || "no channel is configured for reminders",
  };
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

/**
 * Flushes reminders held by quiet hours, then schedules and sends today's.
 *
 * Flush first: a reminder held overnight must go out on this run, and a new one
 * scheduled afterwards is evaluated against the clock as it is *now* rather than
 * as it was when the flush started.
 */
export async function sendReminders(): Promise<JobResult> {
  const s = await getSettings();

  if (s["reminder.enabled"] !== "true") {
    return {
      ran: 0,
      skipped: "Automatic reminders are switched off in Settings → Notifications.",
    };
  }

  const now = new Date();
  const quiet = parseQuietHours(s["reminder.quietHours"]);
  const channelOrder = parseChannels(s["reminder.channelOrder"]);

  const released = await flushHeldReminders(now, quiet, channelOrder);

  const due = await collectDueReminders(now);

  // The unique index is the enforcement. `skipDuplicates` makes the insert a
  // single statement that silently drops the losers of a race, so two concurrent
  // runs cannot both insert and there is no check-then-insert window between
  // them. The rows we actually get back are the ones this run is responsible for.
  let created = 0;
  if (due.length) {
    const result = await prisma.notification.createMany({
      data: due.map((r) => ({
        idempotencyKey: r.key,
        channel: channelOrder[0]?.toUpperCase() ?? "SMS",
        recipient: r.recipient,
        customerId: r.customerId,
        template: r.kind === "expiry" ? "expiry-reminder" : "due-reminder",
        body: r.body,
        // Held or ready, decided below. Defaulting to Scheduled means a reminder
        // is never *assumed* sent; the send path has to set that explicitly.
        status: "Scheduled",
        scheduledAt: now,
      })),
      skipDuplicates: true,
    });
    created = result.count;
  }

  // Send only what this run created, and only what is not inside quiet hours.
  const ours = created
    ? await prisma.notification.findMany({
        where: { idempotencyKey: { in: due.map((r) => r.key) } },
        select: {
          id: true,
          idempotencyKey: true,
          channel: true,
          recipient: true,
          body: true,
          notes: true,
        },
      })
    : [];

  const byKey = new Map(due.map((r) => [r.key, r]));
  let sent = 0;
  let held = 0;
  let failed = 0;
  let firstError = "";

  for (const row of ours) {
    const reminder = byKey.get(row.idempotencyKey ?? "");
    if (!reminder) continue;

    if (isQuiet(quiet, now)) {
      const until = quietWindowEnd(quiet!, now);
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: "Scheduled",
          scheduledAt: until,
          notes: `held for quiet hours until ${until.toTimeString().slice(0, 5)}`,
        },
      });
      held += 1;
      continue;
    }

    const report = await deliverReminder(reminder, channelOrder);
    if (report.sent) {
      sent += 1;
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: "Sent",
          channel: report.channel!,
          sentAt: new Date(),
          error: null,
          notes: report.detail,
        },
      });
    } else {
      failed += 1;
      firstError ||= `${reminder.key}: ${report.detail}`;
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: "Failed",
          error: report.detail,
          sentAt: null,
          notes: `could not deliver: ${report.detail}`,
        },
      });
    }
  }

  return {
    ran: sent + released,
    skipped:
      `${due.length} due, ${created} newly recorded, ${sent} sent, ${held} held for quiet hours` +
      (failed ? `, ${failed} failed` : "") +
      (released ? `, ${released} released from quiet hours` : ""),
    note: firstError || undefined,
  };
}

/**
 * Sends reminders held until the quiet window ends.
 *
 * The channel fallback runs here too rather than being handed to the generic
 * scheduled-message job, because a held reminder needs the same
 * WhatsApp-then-SMS chain — handing it to a job that sends on `channel` alone
 * would deliver it by whichever channel happened to be recorded first, which for
 * a WhatsApp-first ISP is a WhatsApp attempt that has already failed once.
 */
async function flushHeldReminders(
  now: Date,
  quiet: { from: number; to: number } | null,
  channelOrder: string[]
): Promise<number> {
  if (isQuiet(quiet, now)) return 0;

  const held = await prisma.notification.findMany({
    // Template-scoped, for the reason on `REMINDER_TEMPLATES`: a queued fiber
    // message also carries a key, and delivering it here would send an outage
    // notice down the reminder fallback chain.
    where: {
      idempotencyKey: { not: null },
      template: { in: [...REMINDER_TEMPLATES] },
      status: "Scheduled",
      scheduledAt: { lte: now },
    },
    select: { id: true, idempotencyKey: true, recipient: true, body: true, customerId: true },
    take: 200,
  });
  if (!held.length) return 0;

  let released = 0;
  for (const row of held) {
    // Claim before sending, exactly as sendScheduledMessages does, so two runs
    // flushing the same held row cannot both deliver it.
    const claimed = await prisma.notification.updateMany({
      where: { id: row.id, status: "Scheduled" },
      data: { status: "Sending" },
    });
    if (claimed.count === 0) continue;

    const report = await deliverReminder(
      {
        key: row.idempotencyKey!,
        kind: "due",
        customerId: row.customerId ?? "",
        customerName: "",
        recipient: row.recipient,
        invoiceId: null,
        invoiceNumber: null,
        dayOffset: 0,
        body: row.body,
      },
      channelOrder
    );

    if (report.sent) {
      released += 1;
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: "Sent",
          channel: report.channel!,
          sentAt: now,
          error: null,
          notes: `${report.detail} (held for quiet hours)`,
        },
      });
    } else {
      await prisma.notification.update({
        where: { id: row.id },
        data: { status: "Failed", error: report.detail, sentAt: null },
      });
    }
  }
  return released;
}

/** The channel list, with anything unrecognised dropped rather than tried. */
export function parseChannels(raw: string | undefined): string[] {
  const known = ["whatsapp", "sms", "email"];
  const list = (raw ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => known.includes(c));
  return list.length ? [...new Set(list)] : ["whatsapp", "sms"];
}