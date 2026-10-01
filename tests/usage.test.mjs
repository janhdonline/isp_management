/**
 * Per-customer daily usage.
 *
 * The properties under test are the two that make a usage graph worth anything:
 * the numbers are exactly what the raw rows say, and asking twice produces the same
 * answer. A graph that is *nearly* right is worse than none, because a support
 * agent will tell a customer their number is wrong using it.
 *
 * The precedence between the two sources is tested by giving one customer-day
 * both and asserting RADIUS wins, and another with only sessions and asserting
 * sessions are used — because "which one won" is the question a disputed bill
 * actually turns on.
 */
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import {
  aggregateUsage,
  pruneUsage,
  usageSeries,
  usageSummary,
  onlineMinutesFor,
  dayOf,
} from "../src/lib/services/usage.ts";
import { addDays } from "../src/lib/utils.ts";

const stamp = Date.now();
const customerIds = [];
let pkg;
let area;

const MB = 1024 * 1024;
const GB = 1024 * MB;

async function makeCustomer(over = {}) {
  const n = customerIds.length + 1;
  const row = await prisma.customer.create({
    data: {
      customerCode: `USAGE-${stamp}-${n}`,
      name: `Usage Test ${n}`,
      username: `usage${stamp}${n}`,
      phone: `016${String(10000000 + n)}`,
      connectionStatus: "Active",
      packageId: pkg.id,
      areaId: area.id,
      connectionDate: new Date(),
      ...over,
    },
    select: { id: true, username: true },
  });
  customerIds.push(row.id);
  return row;
}

/**
 * A day relative to "now", at local noon so no rounding lands it in another day.
 * `setHours` returns a timestamp, not a Date — the wrapper is what makes this a
 * Date, and without it every `logoutTime` below is an integer.
 */
function day(offset) {
  const d = addDays(new Date(), offset);
  d.setHours(12, 0, 0, 0);
  return d;
}

before(async () => {
  pkg = await prisma.package.create({
    data: {
      name: `Usage Test Package ${stamp}`,
      downloadSpeed: 10,
      uploadSpeed: 5,
      monthlyPrice: 500,
      billingCycle: "Monthly",
      validityDays: 30,
      status: "Active",
    },
    select: { id: true },
  });
  area = await prisma.area.create({
    data: { name: `Usage Test Area ${stamp}`, code: `UT${stamp % 100000}`, status: "Active" },
    select: { id: true },
  });
});

beforeEach(async () => {
  const ids = customerIds;
  if (ids.length) {
    await prisma.dailyUsage.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.onlineSession.deleteMany({ where: { customerId: { in: ids } } });
    // RadiusAccounting is keyed by username, not customerId.
    await prisma.radiusAccounting.deleteMany({ where: { username: { startsWith: "usage" + stamp } } });
  }
  await saveSettings([{ key: "usage.retentionDays", value: "180" }]);
});

after(async () => {
  if (customerIds.length) {
    await prisma.dailyUsage.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.onlineSession.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.radiusAccounting.deleteMany({ where: { username: { startsWith: "usage" + stamp } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (area) await prisma.area.deleteMany({ where: { id: area.id } });
  if (pkg) await prisma.package.deleteMany({ where: { id: pkg.id } });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("daily totals", () => {
  test("two sessions on one day produce one row with the exact sums", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.createMany({
      data: [
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at - 2 * 3600_000),
          logoutTime: new Date(at - 3600_000),
          downloadBytes: BigInt(3 * GB),
          uploadBytes: BigInt(500 * MB),
        },
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at + 3600_000),
          logoutTime: new Date(at + 3 * 3600_000),
          downloadBytes: BigInt(2 * GB),
          uploadBytes: BigInt(250 * MB),
        },
      ],
    });

    await aggregateUsage({ days: 7 });

    const rows = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });
    const dayRow = rows.find((r) => dayOf(r.date).toISOString() === dayOf(new Date(at)).toISOString());
    assert.ok(dayRow, "the day must have a row");
    assert.equal(dayRow.downloadBytes, BigInt(5 * GB), "3 GB + 2 GB, exactly");
    assert.equal(dayRow.uploadBytes, BigInt(750 * MB), "500 MB + 250 MB, exactly");
    assert.equal(dayRow.source, "sessions");
  });

  test("big counters keep their precision", async () => {
    // Above 2^53 a Number loses units. 8 PB is reachable on a busy shared uplink
    // over a 180-day retention, so the arithmetic has to stay in BigInt.
    const c = await makeCustomer();
    const at = day(-1);
    const huge = 8n * 1024n ** 4n; // 8 PB
    await prisma.onlineSession.createMany({
      data: [
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at - 3600_000),
          logoutTime: new Date(at),
          downloadBytes: huge,
          uploadBytes: huge,
        },
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at + 3600_000),
          logoutTime: new Date(at + 7200_000),
          // Adds 1 byte: if anything round-tripped through a Number this is where
          // it would show up.
          downloadBytes: 1n,
          uploadBytes: 1n,
        },
      ],
    });

    await aggregateUsage({ days: 7 });
    const row = await prisma.dailyUsage.findFirstOrThrow({
      where: { customerId: c.id, downloadBytes: { gt: huge / 2n } },
    });
    assert.equal(row.downloadBytes, huge + 1n, "the last byte survives");
    assert.equal(row.uploadBytes, huge + 1n);
  });
});

/* ------------------------------------------------------------------ */

describe("idempotency", () => {
  test("running the aggregation twice leaves one row with the same numbers", async () => {
    const c = await makeCustomer();
    const at = day(-3);
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 3600_000),
        logoutTime: new Date(at),
        downloadBytes: BigInt(4 * GB),
        uploadBytes: BigInt(1 * GB),
      },
    });

    await aggregateUsage({ days: 7 });
    const first = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });

    await aggregateUsage({ days: 7 });
    await aggregateUsage({ days: 7 });
    const third = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });

    assert.equal(first.length, 1);
    assert.equal(third.length, 1, "three runs, one row — never two bars for a day");
    assert.deepEqual(
      third.map((r) => [r.date.toISOString(), r.downloadBytes.toString(), r.uploadBytes.toString()]),
      first.map((r) => [r.date.toISOString(), r.downloadBytes.toString(), r.uploadBytes.toString()]),
      "and the numbers did not grow"
    );
    assert.equal(third[0].downloadBytes, BigInt(4 * GB));
  });

  test("a concurrent double-run still leaves one row", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.createMany({
      data: [0, 1].map((i) => ({
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - (i + 1) * 3600_000),
        logoutTime: new Date(at - i * 3600_000),
        downloadBytes: BigInt(1 * GB),
        uploadBytes: BigInt(100 * MB),
      })),
    });

    await Promise.all([aggregateUsage({ days: 7 }), aggregateUsage({ days: 7 })]);

    const rows = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });
    assert.equal(rows.length, 1, "the unique key settles the race, not a check-then-insert");
    assert.equal(rows[0].downloadBytes, BigInt(2 * GB));
  });

  test("re-running corrects a day rather than leaving the first answer", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 3600_000),
        logoutTime: new Date(at),
        downloadBytes: BigInt(1 * GB),
        uploadBytes: BigInt(100 * MB),
      },
    });
    await aggregateUsage({ days: 7 });

    // A session that arrives late — the nightly sync catching up — for a day
    // already aggregated.
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 1800_000),
        logoutTime: new Date(at),
        downloadBytes: BigInt(2 * GB),
        uploadBytes: BigInt(50 * MB),
      },
    });
    await aggregateUsage({ days: 7 });

    const row = await prisma.dailyUsage.findFirstOrThrow({ where: { customerId: c.id } });
    assert.equal(row.downloadBytes, BigInt(3 * GB), "the day was recomputed, not left stale");
  });
});

/* ------------------------------------------------------------------ */

describe("which source wins", () => {
  test("RADIUS wins for a customer-day where both exist", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 3600_000),
        logoutTime: new Date(at),
        downloadBytes: BigInt(9 * GB),
        uploadBytes: BigInt(1 * GB),
      },
    });
    await prisma.radiusAccounting.create({
      data: {
        username: c.username,
        acctSessionId: `acct-${stamp}-1`,
        nasIp: "10.0.0.9",
        startedAt: new Date(at - 3600_000),
        stoppedAt: at,
        inputOctets: BigInt(2 * GB),
        outputOctets: BigInt(200 * MB),
      },
    });

    await aggregateUsage({ days: 7 });

    const row = await prisma.dailyUsage.findFirstOrThrow({ where: { customerId: c.id } });
    assert.equal(row.source, "radius", "the router's own count wins over a session report");
    assert.equal(row.downloadBytes, BigInt(2 * GB), "and the session's 9 GB is not added to it");
    assert.equal(row.uploadBytes, BigInt(200 * MB));
  });

  test("sessions are used when no RADIUS row exists", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 3600_000),
        logoutTime: at,
        downloadBytes: BigInt(3 * GB),
        uploadBytes: BigInt(300 * MB),
      },
    });

    await aggregateUsage({ days: 7 });
    const row = await prisma.dailyUsage.findFirstOrThrow({ where: { customerId: c.id } });
    assert.equal(row.source, "sessions");
    assert.equal(row.downloadBytes, BigInt(3 * GB));
  });

  test("an open RADIUS session is not written — its counters are still climbing", async () => {
    // Writing today's partial figure would make the bar shrink once the session
    // closes and the next run recomputes the day.
    const c = await makeCustomer();
    const at = day(-1);
    await prisma.radiusAccounting.create({
      data: {
        username: c.username,
        acctSessionId: `acct-${stamp}-open`,
        nasIp: "10.0.0.9",
        startedAt: new Date(at),
        stoppedAt: null,
        inputOctets: BigInt(7 * GB),
        outputOctets: BigInt(1 * GB),
      },
    });

    await aggregateUsage({ days: 7 });
    const rows = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });
    assert.equal(rows.length, 0, "an unclosed session is not evidence yet");
  });

  test("RADIUS rows for an unknown username are ignored, not bucketed", async () => {
    await prisma.radiusAccounting.create({
      data: {
        username: "a-customer-who-left",
        acctSessionId: `acct-${stamp}-ghost`,
        nasIp: "10.0.0.9",
        startedAt: day(-1),
        stoppedAt: day(0),
        inputOctets: BigInt(1 * GB),
        outputOctets: 0n,
      },
    });
    const before = await prisma.dailyUsage.count();
    await aggregateUsage({ days: 7 });
    assert.equal(await prisma.dailyUsage.count(), before, "an orphan row belongs to nobody");
  });
});

/* ------------------------------------------------------------------ */

describe("online minutes", () => {
  const d = (h, m = 0) => new Date(Date.UTC(2026, 0, 5, h, m));

  test("overlapping sessions are counted once", () => {
    // Two devices, or a reconnect the router counted twice, must not report more
    // time than passed.
    const minutes = onlineMinutesFor(
      [
        { loginTime: d(10), logoutTime: d(12) },
        { loginTime: d(11), logoutTime: d(13) },
      ],
      new Date(Date.UTC(2026, 0, 5)),
      d(14)
    );
    assert.equal(minutes, 180, "10:00 to 13:00 is three hours, not four");
  });

  test("touching sessions are merged, not counted twice", () => {
    const minutes = onlineMinutesFor(
      [
        { loginTime: d(10), logoutTime: d(11) },
        { loginTime: d(11), logoutTime: d(12) },
      ],
      new Date(Date.UTC(2026, 0, 5)),
      d(14)
    );
    assert.equal(minutes, 120);
  });

  test("an open session runs to now, not to the end of the day", () => {
    const minutes = onlineMinutesFor(
      [{ loginTime: d(10), logoutTime: null }],
      new Date(Date.UTC(2026, 0, 5)),
      d(11, 30)
    );
    assert.equal(minutes, 90, "a row that was never closed must not contribute 24 hours");
  });

  test("a session spanning midnight is clipped to each day", () => {
    // 22:00 on the 5th through 02:00 on the 6th. Built with an explicit date
    // rather than `d(2, 0)`, which is 02:00 on the *fifth* — a session that starts
    // at 22:00 and ends four hours earlier.
    const spanning = {
      loginTime: d(22),
      logoutTime: new Date(Date.UTC(2026, 0, 6, 2, 0)),
    };
    // Each day is measured as of the end of *that* day; measuring the second day
    // with a "now" on the first would clip its whole span away.
    const first = onlineMinutesFor(
      [spanning],
      new Date(Date.UTC(2026, 0, 5)),
      new Date(Date.UTC(2026, 0, 5, 23, 59))
    );
    const second = onlineMinutesFor(
      [spanning],
      new Date(Date.UTC(2026, 0, 6)),
      new Date(Date.UTC(2026, 0, 6, 23, 59))
    );
    assert.equal(first, 119, "22:00–23:59 on the first day, and not a second more");
    assert.equal(second, 120, "00:00–02:00 on the second");
  });

  test("zero or negative-length sessions contribute nothing", () => {
    const y = new Date(Date.UTC(2026, 0, 5));
    assert.equal(onlineMinutesFor([{ loginTime: d(10), logoutTime: d(10) }], y, d(14)), 0);
    assert.equal(onlineMinutesFor([], y, d(14)), 0);
  });

  test("the union is written to the row", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.createMany({
      data: [
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at - 4 * 3600_000),
          logoutTime: new Date(at - 3600_000),
          downloadBytes: 1n,
          uploadBytes: 1n,
        },
        {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at - 2 * 3600_000),
          logoutTime: at,
          downloadBytes: 1n,
          uploadBytes: 1n,
        },
      ],
    });
    await aggregateUsage({ days: 7 });
    const row = await prisma.dailyUsage.findFirstOrThrow({ where: { customerId: c.id } });
    // 08:00–11:00 and 10:00–12:00. Summing gives five hours; the union is four,
    // because 10:00–11:00 was not time the customer spent online twice.
    assert.equal(row.onlineMinutes, 240, "the union of the two, not their sum");
  });
});

/* ------------------------------------------------------------------ */

describe("retention", () => {
  test("rows past the retention are deleted and recent ones kept", async () => {
    await saveSettings([{ key: "usage.retentionDays", value: "30" }]);
    const c = await makeCustomer();
    const old = day(-40);
    const fresh = day(-5);

    await prisma.dailyUsage.createMany({
      data: [
        { customerId: c.id, date: new Date(old), downloadBytes: 1n, uploadBytes: 1n },
        { customerId: c.id, date: new Date(fresh), downloadBytes: 1n, uploadBytes: 1n },
      ],
    });

    const pruned = await pruneUsage();
    assert.ok(pruned >= 1, "the 40-day-old row went");

    const left = await prisma.dailyUsage.findMany({ where: { customerId: c.id } });
    assert.equal(left.length, 1);
    assert.equal(dayOf(left[0].date).getTime(), dayOf(new Date(fresh)).getTime());
  });

  test("a nonsense retention falls back to the default rather than to zero", async () => {
    // The dangerous failure is a setting that reads as "keep nothing" or "delete
    // everything". A broken value falls back to the documented 180 days, so a
    // recent row is safe — which is the property that matters.
    await saveSettings([{ key: "usage.retentionDays", value: "not-a-number" }]);
    const c = await makeCustomer();
    await prisma.dailyUsage.create({
      data: { customerId: c.id, date: new Date(day(-10)), downloadBytes: 1n, uploadBytes: 1n },
    });

    await pruneUsage();
    assert.equal(
      await prisma.dailyUsage.count({ where: { customerId: c.id } }),
      1,
      "a broken setting must not wipe recent history"
    );

    // And it really is the 180-day default, not "keep everything".
    await prisma.dailyUsage.create({
      data: { customerId: c.id, date: new Date(day(-400)), downloadBytes: 1n, uploadBytes: 1n },
    });
    await pruneUsage();
    assert.equal(
      await prisma.dailyUsage.count({ where: { customerId: c.id } }),
      1,
      "400 days is past the default and goes"
    );
  });

  test("aggregation runs the prune itself", async () => {
    await saveSettings([{ key: "usage.retentionDays", value: "30" }]);
    const c = await makeCustomer();
    await prisma.dailyUsage.create({
      data: { customerId: c.id, date: new Date(day(-45)), downloadBytes: 1n, uploadBytes: 1n },
    });

    const result = await aggregateUsage({ days: 7 });
    assert.match(result.skipped, /pruned|past retention/);
    assert.equal(await prisma.dailyUsage.count({ where: { customerId: c.id } }), 0);
  });
});

/* ------------------------------------------------------------------ */

describe("reading the series back", () => {
  test("the series has one point per day, gaps filled with zero", async () => {
    // A day with no usage row is not a day that did not happen; a chart that leaps
    // over a blank misleads more than a bar at zero.
    const c = await makeCustomer();
    const at = day(-2);
    await prisma.onlineSession.create({
      data: {
        customerId: c.id,
        username: c.username,
        loginTime: new Date(at - 3600_000),
        logoutTime: at,
        downloadBytes: BigInt(6 * GB),
        uploadBytes: BigInt(2 * GB),
      },
    });
    await aggregateUsage({ days: 7 });

    const series = await usageSeries(c.id, 7);
    assert.equal(series.length, 7, "seven points, not two");
    const withUsage = series.filter((d) => d.downloadBytes > 0n);
    assert.equal(withUsage.length, 1);
    assert.equal(withUsage[0].downloadBytes, BigInt(6 * GB));
  });

  test("the chart numbers equal the raw session sums", async () => {
    const c = await makeCustomer();
    const at = day(-2);
    const sessions = [
      { d: 5 * GB, u: 1 * GB },
      { d: 3 * GB, u: 500 * MB },
    ];
    for (const [i, s] of sessions.entries()) {
      await prisma.onlineSession.create({
        data: {
          customerId: c.id,
          username: c.username,
          loginTime: new Date(at + i * 3600_000),
          logoutTime: new Date(at + (i + 1) * 3600_000),
          downloadBytes: BigInt(s.d),
          uploadBytes: BigInt(s.u),
        },
      });
    }
    await aggregateUsage({ days: 7 });

    const raw = await prisma.onlineSession.aggregate({
      where: { customerId: c.id },
      _sum: { downloadBytes: true, uploadBytes: true },
    });
    const totals = await usageSummary(c.id, 7);
    assert.equal(totals.downloadBytes, raw._sum.downloadBytes, "the card equals the raw sum");
    assert.equal(totals.uploadBytes, raw._sum.uploadBytes);
    assert.equal(
      totals.peak?.downloadBytes,
      BigInt(8 * GB),
      "the peak is the day's total (5 + 3 GB), not the largest single session"
    );
  });

  test("a customer with no usage reads as zeroes, not an error", async () => {
    const c = await makeCustomer();
    const totals = await usageSummary(c.id, 7);
    assert.equal(totals.downloadBytes, 0n);
    assert.equal(totals.peak, null);
    assert.equal((await usageSeries(c.id, 7)).length, 7);
  });
});