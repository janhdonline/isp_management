import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { nextNumber } from "@/lib/counter";
import { dispatch } from "@/lib/services/messaging";
import { createBackup } from "@/lib/services/backup";
import { customerCycleUsage } from "@/lib/services/fup";
import { round2, startOfDay, addDays } from "@/lib/utils";
import { prismaLog } from "@/lib/services/activity";
import { enforceSetProfile } from "@/lib/services/network-enforcement";
import type { Tx } from "@/lib/counter";
import type { JobResult } from "@/lib/services/job-result";

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

export type { JobResult };

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
      const invoice = await tx.invoice.create({
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

      // A customer who paid in advance has already paid this month's bill, and
      // billing them for it only to have the wallet claw it straight back would
      // show a customer as overdue in the gap between the two writes. So the
      // wallet settles the invoice here, in the same transaction that raised it.
      const { consumeForInvoice } = await import("@/lib/services/wallet");
      const consumed = await consumeForInvoice(tx, {
        invoiceId: invoice.id,
        customerId: c.id,
      });

      if (consumed.consumed > 0) {
        const { recomputeInvoiceStatus, recomputeCustomerBilling } = await import(
          "@/lib/services/billing"
        );
        await recomputeInvoiceStatus(tx, invoice.id);
        // Recomputed from the invoices rather than incremented: the wallet paid
        // part of it, and an `increment` would leave the customer looking arrears
        // for money they have already handed over.
        await recomputeCustomerBilling(tx, c.id);
      } else {
        await tx.customer.update({
          where: { id: c.id },
          data: { previousDue: { increment: total } },
        });
      }
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
      // The router work is queued, not done here. A cron request that made 300
      // sequential router calls would take minutes, hit the platform timeout,
      // and then re-run and do it all again — and a router that is down would
      // stall the whole sweep, leaving paying customers suspended and nobody
      // enforcing it. One row per customer means the retry job can work through
      // them at whatever pace the network allows.
      const withRouters = await prisma.customer.findMany({
        where: {
          id: { in: past.map((c) => c.id) },
          routerId: { not: null },
        },
        select: { id: true, username: true, routerId: true },
      });

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

        if (withRouters.length) {
          await tx.networkAction.createMany({
            data: withRouters.map((c) => ({
              customerId: c.id,
              routerId: c.routerId,
              username: c.username,
              action: "suspend",
              status: "Pending",
            })),
          });
        }

        await prismaLog(tx, {
          action: "Suspend",
          entity: "Customer",
          entityId: undefined,
          summary:
            `Auto-suspended ${past.length} customer(s) past the grace period; ` +
            `${withRouters.length} queued for router enforcement`,
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
    // `idempotencyKey: null` is a reminder row, and reminders are deliberately
    // excluded. A held reminder needs the WhatsApp-then-SMS fallback chain that
    // `sendReminders` runs; this job sends on the one channel recorded at
    // scheduling time, which for a WhatsApp-first ISP is the channel that has
    // already failed once tonight. Letting it pick them up would deliver some
    // reminders through a different route than the rest, for no reason.
    where: { idempotencyKey: null, status: "Scheduled", scheduledAt: { lte: new Date() } },
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
/* 4. Router enforcement retries                                       */
/* ------------------------------------------------------------------ */

export async function retryNetworkActions(): Promise<JobResult> {
  const { retryPendingNetworkActions, pendingEnforcementCount } = await import(
    "@/lib/services/network-enforcement"
  );
  const stats = await retryPendingNetworkActions();

  const stillPending = await pendingEnforcementCount();
  return {
    ran: stats.done,
    skipped: `${stats.retried} retried, ${stats.failed} failed`,
    note:
      stillPending > 0
        ? `${stillPending} router action(s) still waiting — a router is probably unreachable. The database is correct either way; the network will catch up.`
        : stats.givenUp > 0
          ? `${stats.givenUp} action(s) given up after too many attempts — check Network → Enforcement.`
          : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* 5. Automatic collection                                            */
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

/* ------------------------------------------------------------------ */
/* 7. Fair Usage Policy enforcement                                    */
/* ------------------------------------------------------------------ */

/**
 * Applies the package's Fair Usage Policy.
 *
 * What it does is narrow on purpose. A customer who has used their allowance
 * gets their router profile swapped for a slower one, and gets it swapped back
 * when the next cycle starts. Nothing is disconnected, nothing is suspended, and
 * no money moves — suspension is a billing decision and is handled by the expiry
 * sweep, several jobs up.
 *
 * Three rules shape this:
 *
 *  - **Throttling is sticky within a cycle.** The flag is set once and the
 *    profile is not re-applied on every run, so a customer crossing the limit
 *    does not generate a queue of identical router writes, and a router that is
 *    briefly unreachable is not written to a hundred times.
 *  - **A package with no throttled profile cannot be throttled.** Notifying the
 *    customer is still right, and saying the package has no throttle profile is
 *    more use than silently doing nothing.
 *  - **A hotspot router is never throttled.** There is no PPP secret to point at
 *    a different profile, so the only honest action is to tell the customer.
 */
export async function enforceFup(): Promise<JobResult> {
  const s = await getSettings();
  const action = s["network.fupAction"] ?? "off";

  if (action === "off") {
    return {
      ran: 0,
      skipped: "FUP enforcement is off",
      note: "Set network.fupAction to notify or throttle in Settings → Network.",
    };
  }

  const customers = await prisma.customer.findMany({
    where: {
      // Suspension is a billing decision made by the expiry sweep; it takes
      // precedence, so a suspended customer is left exactly as they are.
      connectionStatus: "Active",
      package: { fupLimit: { not: null } },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      username: true,
      fupThrottled: true,
      router: { select: { id: true, name: true, sessionSource: true } },
      package: {
        select: { name: true, fupLimit: true, fupProfile: true, mikrotikProfile: true },
      },
    },
  });

  let throttled = 0;
  let restored = 0;
  let notified = 0;
  const problems: string[] = [];

  for (const row of customers) {
    // The query filter guarantees both of these, but the type cannot know that
    // and a null here would compare as 0 and throttle everybody. Narrowed once,
    // at the top, so a null package cannot be dereferenced further down either.
    const pkg = row.package;
    if (!pkg) continue;
    const limit = pkg.fupLimit;
    if (limit === null || limit <= 0) continue;
    const c = { ...row, package: pkg };

    const usage = await customerCycleUsage(c.id);

    if (usage.exceeded) {
      // Already throttled: nothing to do. Re-applying the profile on every run
      // would be a queue of identical writes for no change in the outcome.
      if (c.fupThrottled) continue;

      // Hotspot has no secret, so there is nothing to repoint. Notify only.
      if (c.router?.sessionSource === "hotspot") {
        await notifyFupExceeded(c, usage, "no secret to change on a hotspot router");
        notified += 1;
        problems.push(`${c.username}: hotspot router, notified only`);
        continue;
      }

      if (action === "notify") {
        await notifyFupExceeded(c, usage);
        notified += 1;
        continue;
      }

      // action === "throttle"
      if (!c.package.fupProfile) {
        // The honest outcome: the customer is over their limit and the package
        // has nothing to slow them down with. Notify, and say why in the log so
        // the ISP can fix the package.
        await notifyFupExceeded(c, usage, "the package has no throttled profile configured");
        notified += 1;
        problems.push(`${c.username}: over limit, ${c.package.name} has no throttled profile`);
        continue;
      }

      const applied = await enforceSetProfile(c.id, c.package.fupProfile);
      // `skipped` is not success. enforceSetProfile reports "skipped" for a
      // router with auto-provisioning switched off, and treating that as applied
      // would set fupThrottled on a customer the router never touched — the flag
      // would then suppress every future attempt, and the ISP's own view would
      // say a throttle is in force that is not.
      if (!applied.ok || applied.skipped) {
        // A failure is queued by enforceSetProfile and the retry job finishes it.
        // A skip is queued by nobody, because nothing was wanted — so the flag
        // stays unset either way and the next run tries again.
        problems.push(
          applied.skipped
            ? `${c.username}: throttle skipped, ${applied.detail}`
            : `${c.username}: ${applied.detail}`
        );
        continue;
      }

      await prisma.customer.update({
        where: { id: c.id },
        data: { fupThrottled: true, fupThrottledAt: new Date() },
      });
      await prismaLog(prisma, {
        action: "Throttle",
        entity: "Customer",
        entityId: c.id,
        summary:
          `${c.name} (${c.username}) used ${usage.gb.toFixed(1)} GB of their ` +
          `${limit} GB allowance on ${c.package.name}; moved to profile ${c.package.fupProfile}`,
      });
      throttled += 1;
      continue;
    }

    // Under the limit again — a new cycle has started, so undo the throttle.
    if (!c.fupThrottled) continue;

    const restoreTo = c.package.mikrotikProfile ?? "";
    if (!restoreTo) {
      // Nothing to restore to. The flag is still cleared, because the throttle
      // genuinely no longer applies — and a customer left on the slow profile
      // forever is worse than one left on the package default.
      await prisma.customer.update({
        where: { id: c.id },
        data: { fupThrottled: false, fupThrottledAt: null },
      });
      await prismaLog(prisma, {
        action: "Restore",
        entity: "Customer",
        entityId: c.id,
        summary: `${c.name} (${c.username}) is back inside their allowance; no profile on ${c.package.name} to restore, so the router default stands`,
      });
      restored += 1;
      continue;
    }

    const restoredResult = await enforceSetProfile(c.id, restoreTo);
    // Same rule as the throttle: a skip means the router was left alone, so
    // clearing the flag would record a restore that never happened.
    if (!restoredResult.ok || restoredResult.skipped) {
      problems.push(
        restoredResult.skipped
          ? `${c.username}: restore skipped, ${restoredResult.detail}`
          : `${c.username}: ${restoredResult.detail}`
      );
      continue;
    }

    await prisma.customer.update({
      where: { id: c.id },
      data: { fupThrottled: false, fupThrottledAt: null },
    });
    await prismaLog(prisma, {
      action: "Restore",
      entity: "Customer",
      entityId: c.id,
      summary: `${c.name} (${c.username}) is back inside their allowance; restored profile ${restoreTo}`,
    });
    restored += 1;
  }

  return {
    ran: throttled + restored,
    skipped: `${notified} notified, ${customers.length} with a limit checked`,
    note: problems.length ? problems.slice(0, 5).join("; ") : undefined,
  };
}

/**
 * Tells a customer they have used their allowance.
 *
 * The wording avoids "penalty" and "punished", because it is not one: they paid
 * for a package with a limit on it and they have reached it. It also says what
 * happens next, since a customer who finds out their internet is slow and has no
 * idea why will assume the ISP broke something.
 */
async function notifyFupExceeded(
  customer: { id: string; name: string; phone: string; username: string; package: { name: string } },
  usage: { gb: number; limitGb: number | null },
  because?: string
) {
  const one = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const limit = usage.limitGb === null ? "your allowance" : `${one(usage.limitGb)} GB`;

  const body =
    `Dear ${customer.name}, you have used ${one(usage.gb)} GB of ${limit} included with ` +
    `${customer.package.name} this cycle` +
    (because ? `. ${because}.` : ". ") +
    `Your speed returns to normal at the start of the next billing cycle. Thank you.`;

  try {
    const outcome = await dispatch("SMS", customer.phone, "Data limit reached", body);

    await prisma.notification.create({
      data: {
        channel: "SMS",
        recipient: customer.phone,
        customerId: customer.id,
        template: "fup-exceeded",
        subject: "Data limit reached",
        body,
        // The recorded status is the gateway's, not "sent" — a customer who was
        // never actually told must not appear to have been.
        status: outcome.ok ? "Sent" : "Failed",
        error: outcome.ok ? null : outcome.error ?? "Not sent",
        sentAt: outcome.ok ? new Date() : null,
      },
    });
  } catch (e) {
    // A notification failure must not stop the run: the other customers still
    // need their allowance checked.
    await prismaLog(prisma, {
      action: "Notify",
      entity: "Customer",
      entityId: customer.id,
      summary: `Could not tell ${customer.name} (${customer.username}) they reached their data limit: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    });
  }
}

/**
 * Watches network hardware for a change worth waking somebody for (Phase I).
 *
 * Runs after `syncNetwork` in the job list, so it compares against the status
 * that sync just wrote rather than racing it.
 */
export async function deviceHealthWatchJob(): Promise<JobResult> {
  const { deviceHealthWatch } = await import("@/lib/services/device-alerts");
  return deviceHealthWatch();
}

/**
 * Recomputes per-customer daily usage (Phase H).
 *
 * Runs over a trailing window rather than just yesterday, so a night the sync
 * failed or a RADIUS server was down leaves a hole that closes on the next run
 * instead of becoming a permanent blank on a customer's chart.
 */
export async function aggregateDailyUsage(): Promise<JobResult> {
  const { aggregateUsage } = await import("@/lib/services/usage");
  return aggregateUsage();
}

/**
 * Queues and sends the day's payment reminders (Phase F).
 *
 * Separate from `sendScheduledMessages` because the two have different rules:
 * reminders are exactly-once per day and fall back between channels, while a
 * manually scheduled message is sent once on the channel its author chose.
 */
export async function sendPaymentReminders(): Promise<JobResult> {
  const { sendReminders } = await import("@/lib/services/reminders");
  return sendReminders();
}

/**
 * Prunes the RADIUS Live log (Phase W).
 *
 * Not written inline below because it is the one job that can be expensive, and
 * keeping it in its own module makes it obvious that it deletes rows rather than
 * writing them.
 */
export async function pruneRadiusLogs(): Promise<JobResult> {
  const { pruneRadiusLogs: run } = await import("@/lib/services/radius-prune");
  return run();
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
    reminders: sendPaymentReminders,
    enforcement: retryNetworkActions,
    collection: collectPayments,
    network: syncNetwork,
    devices: deviceHealthWatchJob,
    usage: aggregateDailyUsage,
    fup: enforceFup,
    backup: runScheduledBackup,
    radiusLogs: pruneRadiusLogs,
  })) {
    try {
      results[name] = await job();
    } catch (e) {
      results[name] = { error: e instanceof Error ? e.message : "Job failed" };
    }
  }

  return { ms: Date.now() - started, results };
}
