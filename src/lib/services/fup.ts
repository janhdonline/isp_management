import { prisma } from "@/lib/prisma";

/**
 * Fair Usage Policy — how much of a package a subscriber has actually used.
 *
 * A package limit is a number on an invoice until something acts on it. This
 * module is the "how much have they used" half; the enforcement half lives in the
 * cron so it can run without a browser.
 *
 * The cycle is taken from the customer's most recent invoice window, because
 * that is the period the invoice is charging for. Falling back to "the last N
 * days" would measure something different from what the customer was billed, and
 * a customer throttled for exceeding a period they were not charged for has no
 * answer when they ask about it.
 */

const BYTES_PER_GB = 1024 ** 3;

export type CycleUsage = {
  /** Exact figure, kept as a BigInt so nothing is lost on the way to a display. */
  bytes: bigint;
  /** The same figure in GB, for a limit comparison and for a progress bar. */
  gb: number;
  /** Null when the package has no limit — unlimited, not zero. */
  limitGb: number | null;
  /** Percentage of the limit used. Null when there is no limit. */
  percent: number | null;
  from: Date;
  to: Date;
  /** True once the limit has been reached. `>=`, not `>`: a limit is a ceiling. */
  exceeded: boolean;
};

/**
 * The window usage is measured over.
 *
 * Prefers the latest invoice's `billingFrom`/`billingTo`. Without an invoice
 * there is nothing to align to, so it uses the package's validity period ending
 * today — the same shape a customer's first cycle would have.
 */
export async function cycleWindow(
  customerId: string
): Promise<{ from: Date; to: Date }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      package: { select: { validityDays: true } },
    },
  });

  const latest = await prisma.invoice.findFirst({
    where: { customerId },
    orderBy: { billingTo: "desc" },
    select: { billingFrom: true, billingTo: true },
  });

  if (latest?.billingFrom && latest?.billingTo) {
    return { from: latest.billingFrom, to: latest.billingTo };
  }

  // A window whose `to` is in the past would exclude the current usage
  // entirely, so it is pinned to now and only the start moves.
  const days = customer?.package?.validityDays ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

/**
 * Total bytes transferred by a customer inside their current cycle.
 *
 * `network-sync` keeps the larger of the stored and reported figures for an open
 * session, so a router counter reset does not make usage appear to drop. That
 * makes the sum of session rows the cycle total, with no double counting.
 *
 * A session is counted whole, not split across windows. Pro-rating it would need
 * per-window byte sampling that a snapshot sync does not have, and over-counting
 * towards the limit is the direction that costs the ISP nothing.
 *
 * ## Known limitation
 *
 * If a session drops between one router sync and the next, the transfer made in
 * that gap is not recorded anywhere — the row is closed with whatever the last
 * sync saw. Under-reporting is the safe direction to be wrong in here: a
 * customer is never throttled for traffic we failed to see. Phase W's RADIUS
 * accounting closes the gap properly, because an Interim-Update carries the
 * authoritative counter rather than a snapshot we might have missed.
 */
export async function customerCycleUsage(
  customerId: string
): Promise<CycleUsage> {
  const { from, to } = await cycleWindow(customerId);

  const [agg, limit] = await Promise.all([
    prisma.onlineSession.aggregate({
      where: {
        customerId,
        // Both ends of the window, not just the start. Bounding only the start
        // lets a session from *next* cycle count against this one's allowance —
        // which is how a customer on a 50 GB package gets throttled for having
        // used 30 GB in the window plus whatever they did in April.
        loginTime: { gte: from, lte: to },
      },
      _sum: { downloadBytes: true, uploadBytes: true },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { package: { select: { fupLimit: true } } },
    }),
  ]);

  const down = agg._sum.downloadBytes ?? 0n;
  const up = agg._sum.uploadBytes ?? 0n;
  // BigInt arithmetic, then one conversion at the end. Converting each session
  // to a number and adding would lose precision above 2^53 bytes — about 9 PB,
  // which is reachable by a busy shared uplink over a long cycle.
  const bytes = down + up;

  // Number() is applied once. A BigInt beyond 2^53 would lose precision, but the
  // limit is a GB figure in the same order of magnitude, so an approximation at
  // that scale cannot change whether the limit was crossed.
  const gb = Number(bytes) / BYTES_PER_GB;

  const limitGb = limit?.package?.fupLimit ?? null;
  const exceeded = limitGb !== null && gb >= limitGb;
  const percent =
    limitGb !== null && limitGb > 0
      ? Math.round((gb / limitGb) * 1000) / 10
      : null;

  return { bytes, gb, limitGb, percent, from, to, exceeded };
}

/** A short line for a message: "12.4 of 50 GB" rather than a raw byte count. */
export function describeUsage(usage: CycleUsage): string {
  const one = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  return `${one(usage.gb)} of ${usage.limitGb === null ? "unlimited" : `${one(usage.limitGb)} GB`}`;
}
