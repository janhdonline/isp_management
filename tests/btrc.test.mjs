/**
 * BTRC subscriber reporting.
 *
 * The property under test is reconciliation: a return filed with a regulator has
 * to agree with the operator's own screens, because a disagreement is not a
 * rounding difference — it is a submission that gets queried. So this file does
 * not check the report against itself. It checks it against the *other* code
 * paths the same figures are shown on:
 *
 *   - the per-status columns, against `customerStatusMetrics` (the dashboard
 *     cards) and against `listCustomers` (the customer list) for the same filters
 *   - new connections and churn, against a raw count over the same month
 *
 * A test that compared the report to a copy of its own query would pass while the
 * report drifted away from the dashboard, which is the failure that matters.
 *
 * Everything it creates is removed afterwards, and generating a report writes
 * nothing — asserted at the end rather than assumed.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.ts";
import {
  BTRC_COLUMNS,
  btrcCsv,
  btrcReport,
  currentMonth,
  monthLabel,
  monthRange,
} from "../src/lib/services/btrc.ts";
import { customerStatusMetrics, listCustomers } from "../src/lib/services/customers.ts";

/* ------------------------------------------------------------------ */
/* A seeded month, entirely inside this one                             */
/* ------------------------------------------------------------------ */

const stamp = Date.now();
const YEAR = 2031;
// MONTH is 1-based, as the "05" in a YYYY-MM key is. A future year, so this
// month can never be the current one and the figures stay stable as time passes.
const MONTH = 5; // May
const MONTH_KEY = `${YEAR}-0${MONTH}`;

// `new Date`'s month argument is 0-based, so the 0-based index of this month is
// MONTH - 1 and of the *next* month is exactly MONTH. Those two off-by-one traps
// are the reason the bounds below are named rather than inlined.

// The instant a millisecond *before* a month starts is the last instant of the
// month before it. Written as a subtraction from a Date, because that is what it
// is — but re-wrapped in `new Date`, since a bare subtraction yields a number and
// Prisma will not take one.
const lastInstantBefore = (d) => new Date(d.getTime() - 1);

const MAY_START = new Date(YEAR, MONTH - 1, 1, 0, 0, 0);
const MAY_END = lastInstantBefore(new Date(YEAR, MONTH, 1, 0, 0, 0));
const NEXT_START = new Date(YEAR, MONTH, 1, 0, 0, 0);
const NEXT_END = lastInstantBefore(new Date(YEAR, MONTH + 1, 1, 0, 0, 0));

/** Mid-morning on a day of the reported month, so no row sits on a boundary. */
const DAY = (d) => new Date(YEAR, MONTH - 1, d, 10, 0, 0);
/** The month before and the month after — the two ends a range can leak into. */
const PREV_DAY = (d) => new Date(YEAR, MONTH - 2, d, 10, 0, 0);
const NEXT_DAY = (d) => new Date(YEAR, MONTH, d, 10, 0, 0);

const createdCustomerIds = [];

let pkgA;
let pkgB;
let areaX;
let areaY;

/** Nine customers: both packages, both areas, all three statuses, events on
 *  either side of the reported month. */
const SEED = [
  { code: "A1", package: "pkgA", area: "areaX", status: "Active", connected: DAY(3), churned: null },
  { code: "A2", package: "pkgA", area: "areaX", status: "Active", connected: DAY(9), churned: null },
  { code: "A3", package: "pkgB", area: "areaY", status: "Active", connected: DAY(20), churned: null },
  { code: "S1", package: "pkgA", area: "areaX", status: "Suspended", connected: DAY(4), churned: null },
  { code: "D1", package: "pkgB", area: "areaY", status: "Disconnected", connected: DAY(6), churned: DAY(11) },
  { code: "D2", package: "pkgA", area: "areaX", status: "Disconnected", connected: DAY(12), churned: DAY(25) },
  // Connected in the *previous* month: inside the base counts, outside the month's
  // new-connections figure. A row on only one side of the month is not enough —
  // a range that is a month too wide leaks in one way and a month too narrow
  // leaks in the other, so the seed has to straddle both ends to catch either.
  { code: "OLD", package: "pkgA", area: "areaX", status: "Active", connected: PREV_DAY(15), churned: null },
  // Connected in the *next* month, and one that disconnects in it. Both are in
  // the base snapshot, and neither may appear in May's connections or churn.
  // Connected in the *next* month, and one that disconnects in it. Both sit in
  // the base snapshot, and neither may appear in May's connections or churn.
  { code: "NEXT", package: "pkgA", area: "areaX", status: "Active", connected: NEXT_DAY(4), churned: null },
  { code: "LATER", package: "pkgB", area: "areaY", status: "Disconnected", connected: NEXT_DAY(6), churned: NEXT_DAY(8) },
];

/**
 * The figures May is expected to report, derived from the seed's own dates.
 * Deliberately not hand-written numbers: a hardcoded "6" would keep passing after
 * a row is added to the seed, and a range that quietly widens would go unnoticed
 * if the expectation moved with it.
 */
const IN_MONTH_NEW = SEED.filter(
  (s) => s.connected >= MAY_START && s.connected <= MAY_END
).length;
const IN_MONTH_CHURN = SEED.filter(
  (s) => s.churned != null && s.churned >= MAY_START && s.churned <= MAY_END
).length;

async function seed() {
  pkgA = await prisma.package.create({
    data: {
      name: `BTRC Test Package A ${stamp}`,
      downloadSpeed: 10,
      uploadSpeed: 5,
      monthlyPrice: 500,
      billingCycle: "Monthly",
      status: "Active",
    },
    select: { id: true, name: true },
  });
  pkgB = await prisma.package.create({
    data: {
      name: `BTRC Test Package B ${stamp}`,
      downloadSpeed: 20,
      uploadSpeed: 10,
      monthlyPrice: 900,
      billingCycle: "Monthly",
      status: "Active",
    },
    select: { id: true, name: true },
  });
  areaX = await prisma.area.create({
    data: { name: `BTRC Test Area X ${stamp}`, code: `BX${stamp % 100000}`, status: "Active" },
    select: { id: true, name: true },
  });
  areaY = await prisma.area.create({
    data: { name: `BTRC Test Area Y ${stamp}`, code: `BY${stamp % 100000}`, status: "Active" },
    select: { id: true, name: true },
  });

  for (const s of SEED) {
    const row = await prisma.customer.create({
      data: {
        customerCode: `BTRC-${s.code}-${stamp}`,
        name: `BTRC Test ${s.code}`,
        username: `btrc${s.code.toLowerCase()}${stamp}`,
        phone: `018${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        password: "ppp-test",
        connectionStatus: s.status,
        billingStatus: "Paid",
        packageId: s.package === "pkgA" ? pkgA.id : pkgB.id,
        areaId: s.area === "areaX" ? areaX.id : areaY.id,
        connectionDate: s.connected ?? PREV_DAY(15),
        disconnectedAt: s.churned,
      },
      select: { id: true },
    });
    createdCustomerIds.push(row.id);
  }
}

async function cleanup() {
  if (createdCustomerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  }
  for (const a of [areaX, areaY].filter(Boolean)) {
    await prisma.area.deleteMany({ where: { id: a.id } });
  }
  for (const p of [pkgA, pkgB].filter(Boolean)) {
    await prisma.package.deleteMany({ where: { id: p.id } });
  }
}

before(async () => {
  await cleanup();
  await seed();
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("the month it reports on", () => {
  test("a month string becomes the first and last instant of that month", () => {
    const range = monthRange(MONTH_KEY);
    assert.ok(range);
    assert.equal(range.from.getFullYear(), YEAR);
    assert.equal(range.from.getMonth(), MONTH - 1, "May is 0-based month 4");
    assert.equal(range.from.getDate(), 1, "the month must start on the 1st");
    assert.equal(range.from.getHours(), 0);

    // May has 31 days. An upper bound of "the 30th" would silently drop a
    // customer connected on the 31st, and one reading as 0-based June would run
    // a whole month into July.
    assert.equal(range.to.getMonth(), MONTH - 1, "the last day must still be in May");
    assert.equal(range.to.getDate(), 31, "May has 31 days, and the range must include all of them");
    assert.equal(range.to.getHours(), 23);
    assert.equal(range.to.getMinutes(), 59);
    assert.equal(range.to.getSeconds(), 59);
    assert.equal(range.to.getMilliseconds(), 999);
  });

  test("the range stops at the end of the month, not the end of the next one", () => {
    // The regression guard for a bound computed as "next month" with the wrong
    // 0-based index. Every month is checked, because the bug only shows on some
    // of them if the seed happens to line up.
    for (let m = 1; m <= 12; m++) {
      const key = `${YEAR}-${String(m).padStart(2, "0")}`;
      const range = monthRange(key);
      assert.ok(range, key);
      const lastDay = new Date(YEAR, m, 0).getDate();

      assert.equal(range.from.getMonth(), m - 1, `${key} should start in its own month`);
      assert.equal(range.to.getMonth(), m - 1, `${key} must not run into the following month`);
      assert.equal(range.to.getDate(), lastDay, `${key} should end on its own last day`);
      assert.equal(range.to.getFullYear(), YEAR, `${key} should not roll the year over early`);
    }
  });

  test("December rolls the year correctly", () => {
    const range = monthRange(`${YEAR}-12`);
    assert.ok(range);
    assert.equal(range.from.getFullYear(), YEAR);
    assert.equal(range.from.getMonth(), 11);
    assert.equal(range.to.getFullYear(), YEAR, "the 31st of December is still this year");
    assert.equal(range.to.getMonth(), 11);
    assert.equal(range.to.getDate(), 31);
  });

  test("the range excludes the first instant of the following month", () => {
    const range = monthRange(MONTH_KEY);
    assert.ok(range);
    const firstOfJune = new Date(YEAR, MONTH, 1, 0, 0, 0);
    assert.ok(
      range.to.getTime() < firstOfJune.getTime(),
      "June 1 must fall outside a May report"
    );
    const lastOfMay = new Date(YEAR, MONTH - 1, 31, 23, 59, 59, 999);
    assert.ok(range.to.getTime() >= lastOfMay.getTime(), "and May 31 must fall inside it");
  });

  test("an unusable month is empty, not an error", () => {
    // A month picker that has been cleared is a normal state. Throwing here
    // would turn "nothing chosen yet" into a 500 on a compliance tab.
    for (const bad of [null, undefined, "", "not-a-month", "2026-13", "2026-00", "2026-5"]) {
      assert.equal(monthRange(bad), null, `"${bad}" should not resolve to a month`);
    }
  });

  test("the picker defaults to the current month", () => {
    assert.match(currentMonth(), /^\d{4}-\d{2}$/);
    assert.equal(currentMonth(new Date(2026, 8, 15)), "2026-09");
    assert.equal(monthLabel("2026-09"), "September 2026");
  });
});

/* ------------------------------------------------------------------ */

describe("the report reconciles with the dashboard and the customer list", () => {
  test("the status totals equal customerStatusMetrics, the function behind the cards", async () => {
    const report = await btrcReport(MONTH_KEY);
    const metrics = await customerStatusMetrics();

    assert.equal(report.totals.active, metrics.active, "Active must equal the dashboard card");
    assert.equal(report.totals.suspended, metrics.suspended);
    assert.equal(report.totals.disconnected, metrics.disconnected);
    assert.equal(
      report.totals.total,
      metrics.active + metrics.suspended + metrics.disconnected,
      "the report covers exactly the three statuses it is filed for"
    );
  });

  test("the status totals equal the customer list for the same filters", async () => {
    const report = await btrcReport(MONTH_KEY);

    for (const status of ["Active", "Suspended", "Disconnected"]) {
      const { total } = await listCustomers({ status, perPage: 1 });
      assert.equal(
        report.totals[status.toLowerCase()],
        total,
        `${status} must equal what the Customers list shows for that status`
      );
    }
  });

  test("every cell equals the count behind the matching filter", async () => {
    const report = await btrcReport(MONTH_KEY);

    // Not a spot check. Every row of the return is recomputed here through the
    // customer list's own filter builder, so one wrong cell cannot hide behind a
    // correct total.
    for (const row of report.rows) {
      for (const status of ["Active", "Suspended", "Disconnected"]) {
        const { total } = await listCustomers({
          status,
          areaId: row.areaId ?? undefined,
          packageId: row.packageId ?? undefined,
          perPage: 1,
        });
        assert.equal(
          row[status.toLowerCase()],
          total,
          `${row.package} / ${row.area} / ${status} must match the filtered customer count`
        );
      }
      assert.equal(
        row.total,
        row.active + row.suspended + row.disconnected,
        "a row's total is the sum of its own status columns, not a fourth count"
      );
    }
  });

  test("the row figures add up to the totals", async () => {
    const report = await btrcReport(MONTH_KEY);
    const sum = (pick) => report.rows.reduce((s, r) => s + pick(r), 0);

    assert.equal(sum((r) => r.active), report.totals.active);
    assert.equal(sum((r) => r.suspended), report.totals.suspended);
    assert.equal(sum((r) => r.disconnected), report.totals.disconnected);
    assert.equal(sum((r) => r.total), report.totals.total);
    assert.equal(sum((r) => r.newConnections), report.totals.newConnections);
    assert.equal(sum((r) => r.churn), report.totals.churn);
    assert.equal(
      report.totals.netChange,
      report.totals.newConnections - report.totals.churn,
      "net change is the difference of the two figures shown beside it"
    );
  });

  test("new connections and churn are the month's own events", async () => {
    const report = await btrcReport(MONTH_KEY);

    // The bounds are the ones named at the top of the file, not a second
    // expression of the same arithmetic — re-deriving the month's end here is how
    // a test ends up agreeing with the very bug it is meant to catch.
    const [rawNew, rawChurn] = await Promise.all([
      prisma.customer.count({ where: { connectionDate: { gte: MAY_START, lte: MAY_END } } }),
      prisma.customer.count({ where: { disconnectedAt: { gte: MAY_START, lte: MAY_END } } }),
    ]);

    assert.equal(
      report.totals.newConnections,
      IN_MONTH_NEW,
      `only the ${IN_MONTH_NEW} rows connected inside May may be counted`
    );
    assert.equal(report.totals.newConnections, rawNew, "must equal a direct count over the month");
    assert.equal(report.totals.churn, IN_MONTH_CHURN);
    assert.equal(report.totals.churn, rawChurn);
  });

  test("next month's events are excluded from this month's figures", async () => {
    // The bug this file exists to prevent. An upper bound computed as "the next
    // month" with a 0-based index applied to a 1-based month reaches two months
    // on, and every number still looks like a subscriber count — so a filing for
    // May quietly carries June's connections and June's churn.
    //
    // The seed puts a connection and a disconnection in the month *after* the one
    // reported, precisely so a bound that is too wide has something to swallow.
    const report = await btrcReport(MONTH_KEY);

    const inJune = await prisma.customer.count({
      where: { connectionDate: { gte: NEXT_START, lte: NEXT_END } },
    });
    const churnedInJune = await prisma.customer.count({
      where: { disconnectedAt: { gte: NEXT_START, lte: NEXT_END } },
    });
    assert.ok(inJune > 0, "the seed must have a connection in the following month");
    assert.ok(churnedInJune > 0, "and a disconnection in it");

    assert.equal(
      report.totals.newConnections,
      IN_MONTH_NEW,
      `May's return must not include June's ${inJune} connection(s)`
    );
    assert.equal(
      report.totals.churn,
      IN_MONTH_CHURN,
      `May's return must not include June's ${churnedInJune} disconnection(s)`
    );

    // Per row, not just in total: a row is what gets read off a filing, and a
    // total that happens to be right can still come from rows that are not.
    for (const row of report.rows) {
      const params = { areaId: row.areaId ?? undefined, packageId: row.packageId ?? undefined };
      const [rowNew, rowChurn] = await Promise.all([
        prisma.customer.count({ where: { ...params, connectionDate: { gte: MAY_START, lte: MAY_END } } }),
        prisma.customer.count({ where: { ...params, disconnectedAt: { gte: MAY_START, lte: MAY_END } } }),
      ]);
      assert.equal(
        row.newConnections,
        rowNew,
        `${row.package} / ${row.area}: only May connections belong in the New column`
      );
      assert.equal(
        row.churn,
        rowChurn,
        `${row.package} / ${row.area}: only May disconnections belong in the Churn column`
      );
    }
  });

  test("the previous month's events are excluded too", async () => {
    // The other end. The seed has a connection the month before, and it must not
    // leak in — otherwise a wide range on both ends would still reconcile.
    const report = await btrcReport(MONTH_KEY);
    const before = await prisma.customer.count({
      where: { connectionDate: { lt: MAY_START } },
    });
    assert.ok(before > 0, "the seed must have a connection before the reported month");
    assert.equal(
      report.totals.newConnections,
      IN_MONTH_NEW,
      "a connection last month is not a connection this month"
    );
  });

  test("a month with nothing in it reports zero rather than last month's figures", async () => {
    const empty = await btrcReport("1999-01");
    assert.equal(empty.month, "1999-01");
    assert.equal(empty.totals.newConnections, 0);
    assert.equal(empty.totals.churn, 0);
    // The base counts are a snapshot, so they are still the live base — only the
    // period figures belong to the month.
    const metrics = await customerStatusMetrics();
    assert.equal(
      empty.totals.total,
      metrics.active + metrics.suspended + metrics.disconnected
    );
  });
});

/* ------------------------------------------------------------------ */

describe("empty months are safe", () => {
  test("no month gives an empty table and a header-only file", async () => {
    const report = await btrcReport("");
    assert.equal(report.month, null);
    assert.equal(report.rows.length, 0);
    assert.deepEqual(report.csv.rows, []);
    assert.deepEqual(report.totals, {
      active: 0,
      suspended: 0,
      disconnected: 0,
      total: 0,
      newConnections: 0,
      churn: 0,
      netChange: 0,
    });

    const lines = btrcCsv(report).split("\n");
    assert.equal(lines.length, 1, "a header and nothing else");
    assert.deepEqual(lines[0].split(","), [...BTRC_COLUMNS]);
  });

  test("the export filename carries the month", async () => {
    const report = await btrcReport(MONTH_KEY);
    assert.equal(report.csv.filename, `btrc-subscriber-report-${MONTH_KEY}.csv`);
  });
});

/* ------------------------------------------------------------------ */

describe("the CSV layout", () => {
  test("the header is exactly BTRC_COLUMNS", async () => {
    const report = await btrcReport(MONTH_KEY);
    assert.deepEqual(report.csv.headers, [...BTRC_COLUMNS]);
    assert.deepEqual(btrcCsv(report).split("\n")[0].split(","), [...BTRC_COLUMNS]);
  });

  test("every row has a value for every column", async () => {
    const report = await btrcReport(MONTH_KEY);
    assert.ok(report.csv.rows.length > 0, "the seeded month should produce rows");

    for (const row of report.csv.rows) {
      assert.equal(row.length, BTRC_COLUMNS.length, "a short row silently shifts every later column");
      for (const v of row) assert.notEqual(v, undefined);
    }
  });

  test("the documented layout matches the constant", async () => {
    // The doc and the constant have to agree, or the doc is the thing that gets
    // quoted to a regulator while the file says something else.
    const doc = readFileSync("docs/BTRC_REPORT.md", "utf8");
    const documented = [...doc.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => m[1]);
    assert.ok(documented.length > 0, "docs/BTRC_REPORT.md must document the columns in a table");
    assert.deepEqual(documented, [...BTRC_COLUMNS]);
  });

  test("the doc keeps the warning about the prescribed format", async () => {
    const doc = readFileSync("docs/BTRC_REPORT.md", "utf8");
    assert.match(
      doc,
      /prescribed/i,
      "the doc must say the layout has to be confirmed against BTRC's prescribed format"
    );
    assert.match(doc, /before (the )?first (real )?submission/i);
  });
});

/* ------------------------------------------------------------------ */

describe("reporting is read-only", () => {
  test("generating and exporting writes nothing", async () => {
    const before = {
      customers: await prisma.customer.count(),
      packages: await prisma.package.count(),
      areas: await prisma.area.count(),
    };

    await btrcReport(MONTH_KEY);
    btrcCsv(await btrcReport(MONTH_KEY));

    assert.equal(await prisma.customer.count(), before.customers);
    assert.equal(await prisma.package.count(), before.packages);
    assert.equal(await prisma.area.count(), before.areas);
  });
});
