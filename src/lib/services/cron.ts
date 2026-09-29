import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { nextNumber } from "@/lib/counter";
import { dispatch } from "@/lib/services/messaging";
import { createBackup } from "@/lib/services/backup";
import { round2, startOfDay, addDays } from "@/lib/utils";
import { prismaLog } from "@/lib/services/activity";
import type { Tx } from "@/lib/counter";

/**
 * The recurring work. Kept out of the request path so it can be driven by
 * `vercel.json`, a systemd timer, a GitHub Action, or curl:
 *
 *   curl -X POST https://your-host/api/cron -H "authorization: Bearer $CRON_SECRET"
 *
 * Every job is idempotent, so running the route twice in a day does not
 * double-bill or double-send: each step first checks whether it has already
 * done its work for the period it is being asked about.
 */

export type JobResult = { ran: number; skipped: string; note?: string };

/* ------------------------------------------------------------------ */
/* 1. Monthly invoice generation                                       */
/* ------------------------------------------------------------------ */

/**
 * Raises the subscription invoice for every active customer who does not
 * already have one for this billing month.
 */
export async function generateMonthlyInvoices(): Promise<JobResult> {
  const s = await getSettings();
  if (s["billing.autoInvoice"] !== "true") {
    return {
      ran: 0,
      skipped: "Auto invoice is switched off in Settings → Billing.",
    };
  }

  const cycle = (s["billing.cycle"] ?? "Monthly").toLowerCase();
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const prefix = s["billing.invoicePrefix"] || "INV-";
  const taxRate = Number(s["billing.tax"] ?? 0) / 100;

  const customers = await prisma.customer.findMany({
    where: { connectionStatus: "Active" },
    select: {
      id: true,
      name: true,
      monthlyBill: true,
      package: {
        select: {
          id: true,
          name: true,
          monthlyPrice: true,
          validityDays: true,
          billingCycle: true,
        },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const c of customers) {
    // The customer's own cycle decides whether they are due this month.
    const custCycle = (c.package?.billingCycle ?? "Monthly").toLowerCase();
    if (custCycle !== cycle) continue;

    // "Already invoiced this period" means an invoice dated inside this
    // calendar month. Checking only the 1st would let a second run bill again.
    const exists = await prisma.invoice.findFirst({
      where: {
        customerId: c.id,
        issueDate: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true },
    });
    if (exists) {
      skipped += 1;
      continue;
    }

    const amount = round2(c.package?.monthlyPrice ?? c.monthlyBill);
    const vat = round2(amount * taxRate);
    const total = round2(amount + vat);
    const validity = c.package?.validityDays ?? 30;
    const dueDate = addDays(now, Number(s["billing.dueDays"] ?? 7));

    await prisma.$transaction(async (tx: Tx) => {
      const invoiceNumber = await nextNumber(tx, "invoice", prefix);
      await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: c.id,
          packageId: c.package?.id ?? null,
          billingFrom: now,
          billingTo: addDays(now, validity),
          issueDate: now,
          dueDate,
          amount,
          discount: 0,
          vat,
          total,
          paid: 0,
          status: "Due",
          note: `Automatic ${cycle} billing for ${periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
        },
      });
      await tx.customer.update({
        where: { id: c.id },
        data: { previousDue: { increment: total } },
      });
    });

    created += 1;
  }

  await prismaLog(prisma, {
    action: "Create",
    entity: "Invoice",
    entityId: undefined,
    summary: `Monthly run: raised ${created} invoice(s), ${skipped} already existed`,
  });

  return {
    ran: created,
    skipped: `${skipped} customer(s) already invoiced for this month`,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Expiry and suspension sweep (ISP.md §21 lifecycle)               */
/* ------------------------------------------------------------------ */

export async function sweepExpiry(): Promise<JobResult> {
  const s = await getSettings();
  const graceDays = Number(s["billing.gracePeriod"] ?? 5);
  const expiringDays = Number(s["billing.expiringDays"] ?? 3);
  const autoSuspend = s["billing.autoSuspend"] === "true";

  const now = new Date();
  const today = startOfDay(now);

  const expiring = await prisma.customer.count({
    where: {
      connectionStatus: "Active",
      expiryDate: { gte: now, lte: addDays(now, expiringDays) },
    },
  });

  const expired = await prisma.customer.count({
    where: { connectionStatus: "Active", expiryDate: { lt: today } },
  });

  let suspended = 0;
  if (autoSuspend) {
    const past = await prisma.customer.findMany({
      where: {
        connectionStatus: "Active",
        expiryDate: { lt: addDays(today, -graceDays) },
      },
      select: { id: true },
      take: 500,
    });

    if (past.length) {
      await prisma.$transaction(async (tx) => {
        await tx.customer.updateMany({
          where: { id: { in: past.map((c) => c.id) } },
          data: {
            connectionStatus: "Suspended",
            onlineStatus: "Offline",
            suspendReason: `Past expiry plus ${graceDays}-day grace period`,
            suspendedAt: now,
          },
        });
        await prismaLog(tx, {
          action: "Suspend",
          entity: "Customer",
          entityId: undefined,
          summary: `Auto-suspended ${past.length} customer(s) past the grace period`,
        });
      });
      suspended = past.length;
    }
  }

  return {
    ran: suspended,
    skipped: `${expiring} expiring, ${expired} expired`,
    note: autoSuspend
      ? undefined
      : "Auto suspension is off, so nothing was suspended — see Settings → Billing.",
  };
}

/* ------------------------------------------------------------------ */
/* 3. Scheduled messages                                               */
/* ------------------------------------------------------------------ */

export async function sendScheduledMessages(): Promise<JobResult> {
  const due = await prisma.notification.findMany({
    where: { status: "Scheduled", scheduledAt: { lte: new Date() } },
    select: {
      id: true,
      channel: true,
      recipient: true,
      subject: true,
      body: true,
    },
    take: 200,
  });

  if (due.length === 0) return { ran: 0, skipped: "nothing queued" };

  let sent = 0;
  let failed = 0;
  let firstError = "";

  for (const m of due) {
    // Claim the row first so a second run cannot send it twice.
    const claimed = await prisma.notification.updateMany({
      where: { id: m.id, status: "Scheduled" },
      data: { status: "Sending" },
    });
    if (claimed.count === 0) continue;

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

  return {
    ran: sent,
    skipped: `${failed} failed`,
    note: firstError || undefined,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Automatic collection                                            */
/* ------------------------------------------------------------------ */

export async function collectPayments(): Promise<JobResult> {
  const { collectAutomaticPayments } = await import("@/lib/services/auto-collection");
  const r = await collectAutomaticPayments();

  // The run is only interesting when something went wrong. A clean run is
  // already visible on the dashboard, and a summary that shouts every day
  // stops being read.
  if (r.failed === 0) {
    return { ran: r.collected, skipped: `${r.skipped} had nothing to pay` };
  }
  return {
    ran: r.collected,
    skipped: `${r.failed} failed, ${r.skipped} skipped`,
    note: r.lines
      .filter((l) => l.outcome === "failed")
      .slice(0, 5)
      .map((l) => `${l.customer}: ${l.detail}`)
      .join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Network sync                                                    */
/* ------------------------------------------------------------------ */

export async function syncNetwork(): Promise<JobResult> {
  const { syncRouters } = await import("@/lib/services/network-sync");
  const result = await syncRouters();

  // Every unreachable router is worth saying out loud: the dashboard keeps
  // showing the last known state, and an operator should know it is stale.
  const down = result.routers.filter((r) => !r.ok);
  return {
    ran: result.markedOnline,
    skipped:
      `${result.markedOffline} went offline` +
      (result.unmatched ? `, ${result.unmatched} session(s) had no matching customer` : "") +
      (down.length
        ? ` — ${down.length} router(s) unreachable: ${down.map((r) => r.name).join(", ")}`
        : ""),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Backup schedule (Settings → Backup)                              */
/* ------------------------------------------------------------------ */

export async function runScheduledBackup(): Promise<JobResult> {
  const s = await getSettings();
  const schedule = s["backup.schedule"] ?? "Manual";
  if (schedule === "Manual")
    return { ran: 0, skipped: "Schedule is set to Manual." };

  const at = s["backup.time"] ?? "02:00";
  const [hour, minute] = at.split(":").map(Number);
  const now = new Date();
  const today = startOfDay(now);
  const scheduledFor = new Date(today);
  scheduledFor.setHours(
    Number.isFinite(hour) ? hour : 2,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  );

  if (now < scheduledFor) {
    return { ran: 0, skipped: `Not due yet — runs at ${at}.` };
  }

  // One automatic backup per day, whichever schedule is chosen.
  const already = await prisma.backup.findFirst({
    where: { type: "Auto", createdAt: { gte: today } },
    select: { id: true },
  });
  if (already)
    return { ran: 0, skipped: "Today's automatic backup already exists." };

  const result = await createBackup("Auto");
  return {
    ran: result.ok ? 1 : 0,
    skipped: result.ok
      ? `${result.fileName} (${result.sizeLabel})`
      : result.error,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runAllJobs() {
  const started = Date.now();
  const results: Record<string, JobResult | { error: string }> = {};

  for (const [name, job] of Object.entries({
    invoices: generateMonthlyInvoices,
    expiry: sweepExpiry,
    messages: sendScheduledMessages,
    collection: collectPayments,
    network: syncNetwork,
    backup: runScheduledBackup,
  })) {
    try {
      results[name] = await job();
    } catch (e) {
      results[name] = { error: e instanceof Error ? e.message : "Job failed" };
    }
  }

  return { ms: Date.now() - started, results };
}
