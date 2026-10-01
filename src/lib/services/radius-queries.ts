/**
 * Read-only queries for the RADIUS Live page.
 *
 * Everything the dashboard shows is a read of state the RADIUS process wrote.
 * Nothing here computes a figure the process already recorded — the session count
 * is a count of rows with `stoppedAt: null`, not a tally derived from the log,
 * because the log is pruned and a tally of a pruned log goes quietly wrong.
 */

import { prisma } from "@/lib/prisma";
import { healthSnapshot, type RadiusHealth } from "@/lib/services/radius-health";

export type { RadiusHealth };

/** One line in the terminal. */
export type RadiusLogLine = {
  id: number;
  type: string;
  outcome: string | null;
  username: string | null;
  nasIp: string | null;
  message: string;
  createdAt: Date;
};

export type LiveSessions = {
  total: number;
  rows: {
    username: string;
    acctSessionId: string;
    nasIp: string;
    startedAt: Date;
    lastSeenSec: number;
    inputOctets: bigint;
    outputOctets: number;
    framedIpAddress: string | null;
  }[];
};

/** How many rows a page load pulls. The tail is for reading, not for exporting. */
export const LOG_PAGE_SIZE = 200;

export async function radiusHealth(): Promise<RadiusHealth> {
  const row = await prisma.radiusHealth.findUnique({
    where: { id: "radius" },
    select: { packetsIn: true, packetsOut: true, updatedAt: true, startedAt: true },
  });
  return healthSnapshot(row);
}

/**
 * The most recent log lines.
 *
 * Keyed on `id > after`, which is the whole basis of the SSE cursor: `id` is an
 * autoincrement, so it is strictly increasing and dense, and a client that
 * reconnects with the last id it saw gets exactly the rows that arrived since —
 * no gap, no repeat. Ordering by `id` rather than `createdAt` is deliberate for
 * the same reason: two rows written in the same millisecond have an arbitrary
 * timestamp order but a defined id order.
 */
export async function radiusLogTail(
  after: number,
  opts: { types?: string[]; search?: string; limit?: number } = {}
): Promise<RadiusLogLine[]> {
  return prisma.radiusLog.findMany({
    where: {
      // The cursor and the filters live in the same `where`, and that is
      // deliberate: a filtered-out line has still been *seen* by the server, so it
      // must advance the cursor. If the filter were applied after pagination the
      // cursor would stall on the first line the client is filtering out.
      ...(after > 0 ? { id: { gt: after } } : {}),
      ...(opts.types?.length ? { type: { in: opts.types } } : {}),
      ...(opts.search
        ? {
            OR: [
              { message: { contains: opts.search, mode: "insensitive" as const } },
              { username: { contains: opts.search, mode: "insensitive" as const } },
              { nasIp: { contains: opts.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    // A range filter, not Prisma's `cursor` + `skip`. `cursor` anchors on an
    // existing row, and this table is pruned — a cursor pointing at a deleted id
    // returns nothing at all, which would leave a reconnecting terminal blank
    // forever. `id > after` needs no row to exist.
    orderBy: { id: "asc" },
    take: opts.limit ?? LOG_PAGE_SIZE,
    select: {
      id: true,
      type: true,
      outcome: true,
      username: true,
      nasIp: true,
      message: true,
      createdAt: true,
    },
  });
}

export async function liveRadiusSessions(): Promise<LiveSessions> {
  const rows = await prisma.radiusAccounting.findMany({
    where: { stoppedAt: null },
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      username: true,
      acctSessionId: true,
      nasIp: true,
      startedAt: true,
      updatedAt: true,
      inputOctets: true,
      outputOctets: true,
      framedIpAddress: true,
    },
  });

  const total = await prisma.radiusAccounting.count({ where: { stoppedAt: null } });

  return {
    total,
    rows: rows.map((r) => ({
      username: r.username,
      acctSessionId: r.acctSessionId,
      nasIp: r.nasIp,
      startedAt: r.startedAt,
      lastSeenSec: Math.max(0, Math.round((Date.now() - r.updatedAt.getTime()) / 1000)),
      // BigInt does not cross a server/client boundary, so it is narrowed here
      // rather than at each use. A per-session counter of 2^53 octets is a
      // petabyte; the narrowing loses nothing real.
      inputOctets: r.inputOctets,
      outputOctets: Number(r.outputOctets),
      framedIpAddress: r.framedIpAddress,
    })),
  };
}

/**
 * Counts per event type for the page header.
 *
 * Over the last 24 hours rather than all time: a figure that counts every event
 * since the table was created is dominated by whatever the retention window
 * happens to be, which makes it a poor thing to put next to a live status.
 */
export async function radiusLogSummary(): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.radiusLog.groupBy({
    by: ["type"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.type, r._count._all]));
}
