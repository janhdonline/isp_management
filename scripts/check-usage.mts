/**
 * The usage reconciliation guard.
 *
 * Two things, both about the same invariant:
 *
 *   1. **Idempotent.** The job runs twice and every `DailyUsage` row must be
 *      byte-identical afterwards. The unique (customerId, date) key is what makes
 *      that true; this proves it on the real database rather than in a test.
 *   2. **Correct.** Each row equals the sum of the raw rows it came from — the
 *      sessions, or the RADIUS accounting when that won. A usage graph that is
 *      "nearly right" is worse than none, because a support agent will tell a
 *      customer their number is wrong using it.
 *
 * Exits non-zero on any mismatch so `npm run verify` fails rather than scrolls past.
 */
import { prisma } from "../src/lib/prisma";
import { aggregateUsage, dayOf } from "../src/lib/services/usage";

const problems: string[] = [];

try {
  const before = await prisma.dailyUsage.findMany({
    orderBy: [{ customerId: "asc" }, { date: "asc" }],
    select: {
      customerId: true,
      date: true,
      downloadBytes: true,
      uploadBytes: true,
      onlineMinutes: true,
      source: true,
    },
  });
  const fingerprint = (rows: typeof before) =>
    rows
      .map((r) =>
        [
          r.customerId,
          r.date.toISOString(),
          r.downloadBytes.toString(),
          r.uploadBytes.toString(),
          r.onlineMinutes,
          r.source,
        ].join("|")
      )
      .join("\n");

  const beforePrint = fingerprint(before);

  // Run twice: the second run is the one that would double-count if the job were
  // not idempotent.
  await aggregateUsage({ days: 7 });
  await aggregateUsage({ days: 7 });

  const after = await prisma.dailyUsage.findMany({
    orderBy: [{ customerId: "asc" }, { date: "asc" }],
    select: {
      customerId: true,
      date: true,
      downloadBytes: true,
      uploadBytes: true,
      onlineMinutes: true,
      source: true,
    },
  });

  if (fingerprint(after) !== beforePrint) {
    problems.push("two extra aggregation runs changed the stored rows — the job is not idempotent");
  }

  // Every row must equal the raw data for its day, from whichever source won.
  const days = await prisma.dailyUsage.findMany({
    where: { source: { in: ["sessions", "radius"] } },
    select: { customerId: true, date: true, downloadBytes: true, uploadBytes: true, source: true },
  });

  let checked = 0;
  for (const row of days) {
    const from = dayOf(row.date);
    const to = new Date(from.getTime() + 86_400_000);

    const customer = await prisma.customer.findUnique({
      where: { id: row.customerId },
      select: { username: true },
    });
    if (!customer) continue;

    let expectedDown = 0n;
    let expectedUp = 0n;

    if (row.source === "sessions") {
      const agg = await prisma.onlineSession.aggregate({
        where: { customerId: row.customerId, loginTime: { gte: from, lt: to } },
        _sum: { downloadBytes: true, uploadBytes: true },
      });
      expectedDown = agg._sum.downloadBytes ?? 0n;
      expectedUp = agg._sum.uploadBytes ?? 0n;
    } else {
      const radius = await prisma.radiusAccounting.aggregate({
        where: {
          username: customer.username,
          startedAt: { gte: from, lt: to },
          // Open sessions are deliberately excluded; see usage.ts.
          stoppedAt: { not: null },
        },
        _sum: { inputOctets: true, outputOctets: true },
      });
      expectedDown = radius._sum.inputOctets ?? 0n;
      expectedUp = radius._sum.outputOctets ?? 0n;
    }

    if (row.downloadBytes !== expectedDown || row.uploadBytes !== expectedUp) {
      problems.push(
        `${row.customerId} ${row.date.toISOString().slice(0, 10)} (${row.source}): ` +
          `stored ${row.downloadBytes}/${row.uploadBytes}, source says ${expectedDown}/${expectedUp}`
      );
    }
    checked += 1;
  }

  if (problems.length === 0) {
    // The `OK` marker is what verify.mjs asserts on, so it is explicit rather
    // than something inferred from the sentence.
    console.log(`usage OK: ${checked} row(s) match their source; two extra runs changed nothing`);
  } else {
    for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
    if (problems.length > 10) console.error(`  …and ${problems.length - 10} more`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}