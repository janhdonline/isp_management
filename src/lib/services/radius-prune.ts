/**
 * Prunes the RADIUS Live log.
 *
 * An RADIUS port reachable from the internet generates packets forever, and the
 * log is a row per packet. Left alone it is not a log, it is a slow disk: the
 * table grows until something fails, and the failure will be an unrelated query
 * that happened to run when the disk did.
 *
 * Idempotent by construction — it deletes by age, so running it twice in a day
 * deletes the same rows once and the second run finds nothing. That matters
 * because this job is reached from the cron endpoint, which Vercel, GitHub
 * Actions and a hand-run curl will each be happy to fire on their own schedule.
 */
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import type { JobResult } from "@/lib/services/job-result";

export async function pruneRadiusLogs(): Promise<JobResult> {
  const s = await getSettings();
  const days = Number(s["radius.logRetentionDays"] ?? 7);

  // A setting of zero or a non-number must not become `NaN days ago`, which
  // compares as false and silently keeps everything. Seven is the documented
  // default, so fall back to it rather than to "no pruning".
  if (!Number.isFinite(days) || days < 1) {
    return {
      ran: 0,
      skipped: `radius.logRetentionDays is "${s["radius.logRetentionDays"]}", which is not a number of days, so nothing was deleted. It defaults to 7.`,
    };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.radiusLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  const remaining = await prisma.radiusLog.count();

  return {
    ran: count,
    skipped:
      count === 0
        ? `nothing older than ${days} day(s); ${remaining} line(s) kept`
        : `${count} line(s) older than ${days} day(s) deleted; ${remaining} kept`,
  };
}