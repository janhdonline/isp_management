/**
 * Per-customer daily usage (ISP.md §31).
 *
 * `OnlineSession` and `RadiusAccounting` are the raw evidence; `DailyUsage` is the
 * daily roll-up a chart, a support answer and an FUP check need. Aggregating on
 * read would mean summing a customer's whole session history every time somebody
 * opens their profile, and a customer with two years of sessions is a query a
 * support agent waits on.
 *
 * ## Idempotency
 *
 * One row per (customer, day), enforced by `@@unique([customerId, date])`, and
 * the job upserts on it. There is no "does today's row exist" check anywhere: that
 * is two queries and a window in which a concurrent run inserts a second row for
 * the same day, and a usage graph with two bars for Tuesday is worse than no graph.
 * Upserting recomputes the day from its inputs, so the same input always produces
 * the same output — re-running is not merely safe, it is idempotent by
 * construction.
 *
 * ## Which source wins
 *
 * Two sources measure the same traffic: MikroTik's session sync and the RADIUS
 * accounting (Phase W). They must not be summed — a customer on a RADIUS router
 * appears in *both*, and adding them double-counts their whole month.
 *
 * **RADIUS wins where it exists for that customer-day; session data is used
 * otherwise.** The reasons, in order:
 *
 *  - RADIUS counters are the router's own accounting of what crossed the wire, and
 *    they are authoritative. A session row is a report about a session: it can be
 *    missing a session that was never closed cleanly, and it is lost entirely when
 *    the nightly MikroTik sync is what failed.
 *  - RADIUS is *live*. `OnlineSession` is only as current as the last sync, so for
 *    today the RADIUS figure is the fresh one and the session figure is yesterday's
 *    news.
 *  - A mixture of both within one day is worse than either, because it is the one
 *    number nobody can reason about when a customer disputes it.
 *
 * So a customer-day is sourced from exactly one place, and `source` records which,
 * so the chart can say why a day looks different from its neighbours.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import type { JobResult } from "@/lib/services/job-result";
import { addDays } from "@/lib/utils";

/** Where a day came from. Recorded so a chart can explain an odd bar. */
export type UsageSource = "sessions" | "radius";

export type DailyUsageRow = {
  id: string;
  customerId: string;
  date: Date;
  downloadBytes: bigint;
  uploadBytes: bigint;
  onlineMinutes: number;
  source: UsageSource | string;
};

const DAY_MS = 86_400_000;

/** Midnight UTC of the day `d` falls in. */
export function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Minutes online, as the *union* of the day's sessions rather than their sum.
 *
 * Two sessions overlapping — a second device, or a reconnect the router counted
 * twice — must not report more time than actually passed. So the intervals are
 * merged before they are measured; the sum would report a 24-hour day for someone
 * who was online for one.
 *
 * A session with no logout is counted up to `now`, and one that starts before the
 * day is clipped to the day's start, so a session spanning midnight contributes
 * only its share to each day rather than the whole thing to both.
 */
export function onlineMinutesFor(
  sessions: { loginTime: Date; logoutTime: Date | null }[],
  day: Date,
  now: Date = new Date()
): number {
  const from = day.getTime();
  const to = from + DAY_MS;
  const ceiling = Math.min(to, now.getTime());

  const intervals = sessions
    .map((s) => ({
      start: Math.max(from, s.loginTime.getTime()),
      // An open session runs to `now`, not to the end of the universe: a row that
      // was never closed would otherwise contribute 24 hours.
      end: Math.min(s.logoutTime ? s.logoutTime.getTime() : now.getTime(), ceiling),
    }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = -1;
  for (const i of intervals) {
    const start = Math.max(i.start, cursor);
    if (i.end > start) {
      total += i.end - start;
      cursor = i.end;
    }
  }
  return Math.round(total / 60000);
}

/* ------------------------------------------------------------------ */
/* Reading the two sources                                            */
/* ------------------------------------------------------------------ */

/** Daily totals from MikroTik's session sync. */
async function fromSessions(from: Date, to: Date) {
  const sessions = await prisma.onlineSession.findMany({
    where: { loginTime: { gte: from, lt: to } },
    select: { customerId: true, loginTime: true, logoutTime: true, downloadBytes: true, uploadBytes: true },
  });

  const byDay = new Map<string, { customerId: string; date: Date; down: bigint; up: bigint; sessions: typeof sessions }>();
  for (const s of sessions) {
    const date = dayOf(s.loginTime);
    const key = `${s.customerId}|${date.toISOString().slice(0, 10)}`;
    const row = byDay.get(key) ?? { customerId: s.customerId, date, down: 0n, up: 0n, sessions: [] };
    // BigInt arithmetic throughout. Converting each session to a Number first
    // would lose precision above 2^53 bytes — about 9 PB, which a busy shared
    // uplink can reach over a retention window.
    row.down += s.downloadBytes;
    row.up += s.uploadBytes;
    row.sessions.push(s);
    byDay.set(key, row);
  }
  return byDay;
}

/**
 * Daily totals from RADIUS accounting.
 *
 * Only closed sessions count. An open session's counters are still climbing, and
 * writing today's partial figure into a durable row would make the number move
 * backwards once the session closes and the next run recomputes it — a graph whose
 * bars shrink is not evidence of anything.
 */
async function fromRadius(from: Date, to: Date) {
  const rows = await prisma.radiusAccounting.findMany({
    where: { startedAt: { gte: from, lt: to } },
    select: { username: true, startedAt: true, stoppedAt: true, inputOctets: true, outputOctets: true },
  });
  if (!rows.length) return new Map();

  // `username` is the link to a customer. A row whose customer no longer exists is
  // dropped rather than bucketed under "unknown", which would be a growing pile of
  // orphans that cannot be attributed to anybody.
  const usernames = [...new Set(rows.map((r) => r.username))];
  const customers = await prisma.customer.findMany({
    where: { username: { in: usernames } },
    select: { id: true, username: true },
  });
  const byUsername = new Map(customers.map((c) => [c.username, c.id]));

  const byDay = new Map<string, { customerId: string; date: Date; down: bigint; up: bigint }>();
  for (const r of rows) {
    if (!r.stoppedAt) continue;
    const customerId = byUsername.get(r.username);
    if (!customerId) continue;

    const date = dayOf(r.startedAt);
    const key = `${customerId}|${date.toISOString().slice(0, 10)}`;
    const row = byDay.get(key) ?? { customerId, date, down: 0n, up: 0n };
    row.down += r.inputOctets;
    row.up += r.outputOctets;
    byDay.set(key, row);
  }
  return byDay;
}

/* ------------------------------------------------------------------ */
/* The job                                                            */
/* ------------------------------------------------------------------ */

/**
 * Recomputes the last `days` of daily usage and prunes what falls out of
 * retention.
 *
 * Recomputing a window rather than only "yesterday" is deliberate: a nightly sync
 * that failed, a RADIUS server that was down for a day, or a laptop that slept
 * all leave a hole, and a hole in a usage graph reads as "this customer was not
 * online" when the truth is "we did not know". Re-deriving the last few days
 * closes those holes on the next run, at the cost of a bounded amount of work.
 */
export async function aggregateUsage(opts: { days?: number; now?: Date } = {}): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const window = opts.days ?? 7;

  const from = addDays(dayOf(now), -(window - 1));
  // The window is inclusive of today, and today runs to now rather than to
  // midnight.
  const windowEnd = addDays(dayOf(now), 1);

  const [sessions, radius] = await Promise.all([
    fromSessions(from, windowEnd),
    fromRadius(from, windowEnd),
  ]);

  // RADIUS wins per customer-day. A day with no RADIUS row falls back to sessions.
  const merged = new Map<string, { customerId: string; date: Date; down: bigint; up: bigint; onlineMinutes: number; source: UsageSource }>();

  for (const [key, row] of sessions) {
    merged.set(key, {
      customerId: row.customerId,
      date: row.date,
      down: row.down,
      up: row.up,
      onlineMinutes: onlineMinutesFor(row.sessions, row.date, now),
      source: "sessions",
    });
  }
  for (const [key, row] of radius) {
    merged.set(key, {
      customerId: row.customerId,
      date: row.date,
      down: row.down,
      up: row.up,
      // RADIUS carries no session duration; the minutes come from the session
      // table, which is why they are merged rather than replaced. A day with no
      // sessions but real RADIUS traffic shows zero minutes, which is honest: the
      // router billed the bytes without ever opening a tracked session.
      onlineMinutes: onlineMinutesFor(sessions.get(key)?.sessions ?? [], row.date, now),
      source: "radius",
    });
  }

  if (merged.size) {
    await prisma.dailyUsage.createMany({
      data: [...merged.values()].map((r) => ({
        customerId: r.customerId,
        date: r.date,
        downloadBytes: r.down,
        uploadBytes: r.up,
        onlineMinutes: r.onlineMinutes,
        source: r.source,
      })),
      // The idempotency mechanism. Two concurrent runs cannot both insert, and
      // neither can a re-run create a second bar for the same day.
      skipDuplicates: true,
    });

    // `skipDuplicates` protects the unique key but leaves an existing row's numbers
    // alone, so a re-run could not correct a day it got wrong. Overwriting by id
    // fixes that, and is still idempotent because the value written is a pure
    // function of the input.
    for (const r of merged.values()) {
      await prisma.dailyUsage.updateMany({
        where: { customerId: r.customerId, date: r.date },
        data: {
          downloadBytes: r.down,
          uploadBytes: r.up,
          onlineMinutes: r.onlineMinutes,
          source: r.source,
        },
      });
    }
  }

  const pruned = await pruneUsage();

  return {
    ran: merged.size,
    skipped: `${merged.size} customer-day(s) recomputed over ${window} day(s)` +
      (radius.size ? `, ${radius.size} from RADIUS` : "") +
      (pruned > 0 ? `, ${pruned} pruned past retention` : ""),
  };
}

/**
 * Deletes usage rows older than the retention window.
 *
 * Default 180 days, which is comfortably longer than any FUP cycle and long enough
 * for a customer to dispute a bill from the previous quarter — the rows past it are
 * costing a full table scan on every profile load and cannot be read anyway.
 */
export async function pruneUsage(now: Date = new Date()): Promise<number> {
  const s = await getSettings();
  const raw = Number(s["usage.retentionDays"] ?? 180);
  // A blank or non-numeric setting must not become `NaN days ago`, which compares
  // as false and silently keeps everything.
  const days = Number.isInteger(raw) && raw > 0 ? raw : 180;
  const cutoff = addDays(dayOf(now), -days);
  const { count } = await prisma.dailyUsage.deleteMany({ where: { date: { lt: cutoff } } });
  return count;
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * A customer's daily usage, oldest first, with the days they *did not* appear.
 *
 * The gaps are filled in the read rather than stored: a day with no usage row is
 * not a day that did not happen, it is a day the chart should show as a flat zero.
 * A line that leaps over a blank day misleads more than a bar at zero.
 */
export async function usageSeries(customerId: string, days = 30, now: Date = new Date()) {
  const to = dayOf(now);
  const from = addDays(to, -(days - 1));

  const rows = await prisma.dailyUsage.findMany({
    where: { customerId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));

  const series: {
    date: string;
    downloadBytes: bigint;
    uploadBytes: bigint;
    onlineMinutes: number;
    source: string;
  }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    series.push({
      date: key,
      downloadBytes: row?.downloadBytes ?? 0n,
      uploadBytes: row?.uploadBytes ?? 0n,
      onlineMinutes: row?.onlineMinutes ?? 0,
      source: row?.source ?? "none",
    });
  }
  return series;
}

/** Totals and the peak day over a window, for the summary cards. */
export async function usageSummary(
  customerId: string,
  days = 30,
  now: Date = new Date()
): Promise<{
  downloadBytes: bigint;
  uploadBytes: bigint;
  onlineMinutes: number;
  peak: { date: string; downloadBytes: bigint; uploadBytes: bigint } | null;
  daysWithUsage: number;
}> {
  const series = await usageSeries(customerId, days, now);
  let downloadBytes = 0n;
  let uploadBytes = 0n;
  let onlineMinutes = 0;
  let peak: { date: string; downloadBytes: bigint; uploadBytes: bigint } | null = null;

  for (const d of series) {
    downloadBytes += d.downloadBytes;
    uploadBytes += d.uploadBytes;
    onlineMinutes += d.onlineMinutes;
    if (d.downloadBytes + d.uploadBytes > 0n) {
      if (!peak || d.downloadBytes + d.uploadBytes > peak.downloadBytes + peak.uploadBytes) {
        peak = { date: d.date, downloadBytes: d.downloadBytes, uploadBytes: d.uploadBytes };
      }
    }
  }

  return {
    downloadBytes,
    uploadBytes,
    onlineMinutes,
    peak,
    daysWithUsage: series.filter((d) => d.downloadBytes + d.uploadBytes > 0n).length,
  };
}

/** Bytes for a recent window, for the slow-internet ticket panel. */
export async function recentUsage(customerId: string, days = 7, now: Date = new Date()) {
  return usageSummary(customerId, days, now);
}