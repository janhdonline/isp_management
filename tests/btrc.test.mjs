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
const MONTH = 5; // June, so it can never be the current month
const MONTH_KEY = `${YEAR}-0${MONTH}`;
const DAY = (d) => new Date(YEAR, MONTH - 1, d, 10, 0, 0);

const createdCustomerIds = [];

let pkgA;
let pkgB;
let areaX;
let areaY;

/** Six customers covering both packages, both areas and all three statuses. */
const SEED = [
  { code: "A1", package: "pkgA", area: "areaX", status: "Active", connected: 3, churned: null },
  { code: "A2", package: "pkgA", area: "areaX", status: "Active", connected: 9, churned: null },
  { code: "A3", package: "pkgB", area: "areaY", status: "Active", connected: 20, churned: null },
  { code: "S1", package: "pkgA", area: "areaX", status: "Suspended", connected: 4, churned: null },
  { code: "D1", package: "pkgB", area: "areaY", status: "Disconnected", connected: 6, churned: 11 },
  { code: "D2", package: "pkgA", area: "areaX", status: "Disconnected", connected: 12, churned: 25 },
  // Connected in the previous month: inside the base counts, outside the month's
  // new-connections figure. Without it the test could not tell the two apart.
  { code: "OLD", package: "pkgA", area: "areaX", status: "Active", connected: null, churned: null },
];

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
        connectionDate: s.connected ? DAY(s.connected) : new Date(YEAR, MONTH - 2, 15),
        disconnectedAt: s.churned ? DAY(s.churned) : null,
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
    assert.equal(range.from.getDate(), 1);
    assert.equal(range.from.getMonth(), MONTH - 1);
    assert.equal(range.to.getDate(), 30, "June has 30 days, and the range must include all of them");
    assert.equal(range.to.getHours(), 23);
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
    const from = new Date(YEAR, MONTH - 1, 1, 0, 0, 0);
    const to = new Date(YEAR, MONTH - 1, 31, 23, 59, 59, 999);

    // Five of the seven seeded rows connect inside the month; one connects in the
    // month before and must not be counted, and one churned and must be.
    const expectedNew = SEED.filter((s) => s.connected).length;
    const expectedChurn = SEED.filter((s) => s.churned).length;

    const [rawNew, rawChurn] = await Promise.all([
      prisma.customer.count({ where: { connectionDate: { gte: from, lte: to } } }),
      prisma.customer.count({ where: { disconnectedAt: { gte: from, lte: to } } }),
    ]);

    assert.equal(report.totals.newConnections, expectedNew);
    assert.equal(report.totals.newConnections, rawNew, "must equal a direct count over the month");
    assert.equal(report.totals.churn, expectedChurn);
    assert.equal(report.totals.churn, rawChurn);
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
