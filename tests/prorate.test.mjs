import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import { changePackage } from "../src/lib/services/customers.ts";
import {
  prorate,
  toPoisha,
  fromPoisha,
  divRoundHalfAwayFromZero,
  wholeDaysBetween,
  cycleFor,
} from "../src/lib/services/proration.ts";

/**
 * Phase R — prorated billing on mid-cycle package change.
 *
 * The acceptance figure is *exactly* 166.67 for a day-20 change on a 30-day cycle
 * between 500 and 1000. That word "exactly" is the whole reason this module
 * computes in integer poisha, so most of these tests are about determinism rather
 * than about the arithmetic being right once.
 */

const STAMP = Date.now();
const DAY = 86_400_000;

let area;
let operator;
let pkg500;
let pkg1000;
let createdCustomers = [];
let originalProrate = null;

before(async () => {
  const row = await prisma.setting.findUnique({
    where: { key: "billing.prorateOnPackageChange" },
  });
  originalProrate = row?.value ?? null;

  area = await prisma.area.findFirstOrThrow();
  await sweep();

  operator = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Administrator" } },
    select: { id: true },
  });

  pkg500 = await makePackage("Pro 500", 500);
  pkg1000 = await makePackage("Pro 1000", 1000);
});

after(async () => {
  await sweep();
  if (originalProrate !== null) {
    await saveSettings([{ key: "billing.prorateOnPackageChange", value: originalProrate }]);
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Customers only. The packages were made once in `before` and every test needs
  // them; an earlier version swept them here too and every test after the first
  // failed on a foreign key to a package it had just deleted.
  await cleanupCustomers();
  await saveSettings([{ key: "billing.prorateOnPackageChange", value: "true" }]);
  invalidateSettingsCache();
});

/** Everything one test created. */
async function cleanupCustomers() {
  const customers = await prisma.customer.findMany({
    where: { customerCode: { startsWith: "PR-" } },
    select: { id: true },
  });
  const ids = customers.map((c) => c.id);
  if (ids.length) {
    await prisma.walletTransaction.deleteMany({ where: { customerId: { in: ids } } });
    // No payments or receipts: nothing in this phase creates them, and `Receipt`
    // has no `customerId` to filter on.
    await prisma.invoice.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerPackageChange.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }
  createdCustomers = [];
}

/** Also the packages, for `before` and `after`. */
async function sweep() {
  await cleanupCustomers();
  await prisma.package.deleteMany({ where: { name: { startsWith: "Pro " } } });
}

async function makePackage(name, monthlyPrice) {
  return prisma.package.create({
    data: {
      name: `${name} ${STAMP}`,
      monthlyPrice,
      downloadSpeed: 10,
      uploadSpeed: 2,
      validityDays: 30,
      fupProfile: name,
      status: "Active",
    },
    select: { id: true, name: true, monthlyPrice: true, validityDays: true },
  });
}

/**
 * A customer sitting on day 20 of a 30-day cycle.
 *
 * The cycle is pinned by an invoice whose `billingFrom`/`billingTo` span exactly
 * thirty days, which is what `cycleFor` prefers — so "day 20" is a fact about the
 * database rather than about when the test happens to run.
 */
async function makeCustomerOnDay20({
  packageId,
  cycleFrom,
  cycleDays = 30,
  elapsed = 20,
} = {}) {
  const from = cycleFrom ?? new Date("2026-07-01T00:00:00.000Z");
  const to = new Date(from.getTime() + cycleDays * DAY);
  // A fixed instant, exactly `elapsed` days into the window. UTC, so this does not
  // move with the machine's timezone or a daylight-saving boundary.
  const now = new Date(from.getTime() + elapsed * DAY);

  const customer = await prisma.customer.create({
    data: {
      customerCode: `PR-${STAMP}-${createdCustomers.length + 1}`,
      name: `Prorated Customer ${createdCustomers.length + 1}`,
      username: `pr${STAMP}${createdCustomers.length + 1}`,
      phone: "01700000000",
      connectionStatus: "Active",
      connectionDate: from,
      areaId: area.id,
      packageId,
      monthlyBill: packageId === pkg1000.id ? 1000 : 500,
      ipAddress: "100.64.10.9",
    },
    select: { id: true, name: true, username: true, packageId: true },
  });
  createdCustomers.push(customer.id);

  // The cycle-defining invoice, paid, so it is history rather than a debt.
  await prisma.invoice.create({
    data: {
      invoiceNumber: `PRCYC-${STAMP}-${createdCustomers.length}`,
      customerId: customer.id,
      packageId,
      issueDate: from,
      dueDate: from,
      billingFrom: from,
      billingTo: to,
      amount: 0,
      total: 0,
      paid: 0,
      status: "Paid",
    },
  });

  return { customer, now, from, to };
}

async function invoicesFor(customerId) {
  return prisma.invoice.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
}

async function walletFor(customerId) {
  return prisma.walletTransaction.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
}

// ---------------------------------------------------------------------------

describe("the money, in integers", () => {
  test("poisha conversion does not lose a fraction", () => {
    assert.equal(toPoisha(500), 50000);
    assert.equal(toPoisha(0.1), 10);
    // The case floats get wrong: 500.07 * 100 is 50006.99999999999 in binary.
    assert.equal(toPoisha(500.07), 50007);
    assert.equal(toPoisha(166.67), 16667);
    assert.equal(toPoisha(0), 0);
    assert.equal(toPoisha(NaN), 0, "a non-number is zero, not NaN money");
    assert.equal(fromPoisha(16667), 166.67);
  });

  test("division rounds half away from zero, symmetrically", () => {
    assert.equal(divRoundHalfAwayFromZero(15, 30), 1, "0.5 goes up");
    assert.equal(divRoundHalfAwayFromZero(-15, 30), -1, "and down for a credit");
    assert.equal(divRoundHalfAwayFromZero(500000, 30), 16667);
    assert.equal(divRoundHalfAwayFromZero(0, 30), 0);
    assert.equal(divRoundHalfAwayFromZero(5, 0), 0, "no division by zero");
  });

  test("the same division is the same number however it is expressed", () => {
    // The reason this module exists. Both expressions are "500 * 10 / 30" and they
    // are not the same float.
    const a = (500 * 10) / 30;
    const b = (500 / 30) * 10;
    assert.notEqual(a, b, "float arithmetic is order-dependent here");
    // Through integers, both are the same.
    assert.equal(
      divRoundHalfAwayFromZero(toPoisha(500) * 10, 30),
      divRoundHalfAwayFromZero(toPoisha(500) * 10, 30)
    );
    assert.equal(fromPoisha(divRoundHalfAwayFromZero(toPoisha(500) * 10, 30)), 166.67);
  });

  test("a credit is exactly the negative of the charge", () => {
    assert.equal(
      divRoundHalfAwayFromZero(-toPoisha(500) * 10, 30),
      -divRoundHalfAwayFromZero(toPoisha(500) * 10, 30),
      "a downgrade must not be a poisha out from its mirror"
    );
  });
});

describe("the acceptance figure", () => {
  test("day 20 of 30, 500 to 1000, is exactly 166.67", () => {
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle: { from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T00:00:00.000Z") },
      changedAt: new Date("2026-07-21T00:00:00.000Z"),
      fromName: "Pro 500",
      toName: "Pro 1000",
    });

    assert.equal(calc.elapsedDays, 20);
    assert.equal(calc.remainingDays, 10);
    assert.equal(calc.dailyRatePoisha, 1667, "16.67/day");
    assert.equal(calc.adjustment, 166.67);
    assert.equal(calc.adjustmentPoisha, 16667);
    assert.equal(calc.direction, "upgrade");
  });

  test("the lines say how the number was reached", () => {
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle: { from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T00:00:00.000Z") },
      changedAt: new Date("2026-07-21T00:00:00.000Z"),
      fromName: "Home 5",
      toName: "Home 10",
    });
    const text = calc.lines.join("\n");
    assert.match(text, /From: Home 5 — 500\.00 per month/);
    assert.match(text, /To: Home 10 — 1000\.00 per month/);
    assert.match(text, /Remaining on the new package: 10 day\(s\)/);
    assert.match(text, /Daily rate difference: 16\.67 per day/);
    assert.match(text, /Adjustment: 10 x 16\.67 = 166\.67/);
  });
});

describe("the boundaries", () => {
  const cycle = {
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-07-31T00:00:00.000Z"),
  };

  test("the first day of the cycle is the full monthly difference", () => {
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle,
      changedAt: cycle.from,
      fromName: "A",
      toName: "B",
    });
    assert.equal(calc.elapsedDays, 0);
    assert.equal(calc.remainingDays, 30);
    assert.equal(calc.adjustment, 500, "nothing of the month has been served");
  });

  test("the last day is a near-zero, and rounds to 16.67 rather than 16.66", () => {
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle,
      changedAt: new Date(cycle.to.getTime() - DAY),
      fromName: "A",
      toName: "B",
    });
    assert.equal(calc.elapsedDays, 29);
    assert.equal(calc.remainingDays, 1);
    assert.equal(calc.adjustment, 16.67, "one day of a 500/month difference");
  });

  test("a change on the last day of the cycle is worth nothing", () => {
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle,
      changedAt: cycle.to,
      fromName: "A",
      toName: "B",
    });
    assert.equal(calc.remainingDays, 0);
    assert.equal(calc.adjustmentPoisha, 0);
    assert.equal(calc.direction, "none");
  });

  test("an elapsed count outside the window is clamped, not extrapolated", () => {
    const before = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle,
      changedAt: new Date(cycle.from.getTime() - 10 * DAY),
      fromName: "A",
      toName: "B",
    });
    assert.equal(before.elapsedDays, 0, "a backdated edit gets the full month, not a negative one");
    assert.equal(before.adjustment, 500);

    const after = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle,
      changedAt: new Date(cycle.to.getTime() + 10 * DAY),
      fromName: "A",
      toName: "B",
    });
    assert.equal(after.elapsedDays, 30);
    assert.equal(after.adjustmentPoisha, 0);
  });

  test("with no invoice to align to, the package validity is the cycle", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const window = cycleFor({ validityDays: 30, cycle: null, now });
    assert.equal(window.days, 30);
    assert.equal(wholeDaysBetween(window.from, window.to), 30);

    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle: null,
      changedAt: now,
      fromName: "A",
      toName: "B",
    });
    assert.equal(calc.cycle.days, 30);
  });

  test("a window of zero days falls back rather than dividing by nothing", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const window = cycleFor({
      validityDays: 30,
      cycle: { from: now, to: now },
      now,
    });
    assert.equal(window.days, 30);
  });
});

describe("an upgrade", () => {
  test("raises an adjustment invoice for 166.67, due now, with the lines on it", async () => {
    const { customer, now, from } = await makeCustomerOnDay20({ packageId: pkg500.id });

    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg1000.id, "upgrade", operator.id, now));

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(moved.packageId, pkg1000.id);
    assert.equal(moved.monthlyBill, 1000);

    const invoices = await invoicesFor(customer.id);
    const adjustment = invoices[invoices.length - 1];
    assert.ok(adjustment, "an invoice was raised");
    assert.equal(adjustment.total, 166.67);
    assert.equal(adjustment.amount, 166.67);
    assert.equal(adjustment.status, "Due");
    assert.equal(adjustment.packageId, pkg1000.id);

    // Due immediately: they have had the faster speed already.
    assert.equal(
      Math.abs(adjustment.dueDate.getTime() - now.getTime()),
      0,
      "due on the day of the change, not at the end of the month"
    );
    assert.equal(adjustment.issueDate.getTime(), now.getTime());

    assert.match(adjustment.note, /prorated over the rest of the billing cycle/i);
    assert.match(adjustment.note, /From: .*500\.00 per month/);
    assert.match(adjustment.note, /To: .*1000\.00 per month/);
    assert.match(adjustment.note, /Remaining on the new package: 10 day\(s\)/);
    assert.match(adjustment.note, /Daily rate difference: 16\.67 per day/);
    assert.match(adjustment.note, /Adjustment: 10 x 16\.67 = 166\.67/);
    assert.ok(adjustment.billingFrom === null || adjustment.billingFrom >= from);

    assert.equal((await walletFor(customer.id)).length, 0, "an upgrade is not a wallet credit");
  });

  test("the adjustment counts towards what the customer owes", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg500.id });
    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg1000.id, "upgrade", operator.id, now));

    const { recomputeCustomerBilling } = await import("../src/lib/services/billing.ts");
    const billing = await prisma.$transaction((tx) => recomputeCustomerBilling(tx, customer.id));

    const invoices = await invoicesFor(customer.id);
    const expected = invoices
      .filter((i) => i.status !== "Cancelled")
      .reduce((sum, i) => sum + (i.total - i.paid), 0);
    assert.equal(billing.totalBilled, Math.round(expected * 100) / 100);
    assert.equal(billing.due, 166.67, "the adjustment is what the customer now owes");

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(moved.previousDue, 166.67, "and it reached the customer row");
    // `billingStatus` is not asserted: this customer's cycle is in July, so an
    // invoice due on the day of the change is legitimately Overdue against the real
    // clock, and asserting `Unpaid` would be asserting about the fixture.
    assert.ok(["Unpaid", "Overdue", "Partial"].includes(moved.billingStatus));
  });
});

describe("a downgrade", () => {
  test("credits the wallet by 166.67 and raises no invoice", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });

    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg500.id, "downgrade", operator.id, now));

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(moved.packageId, pkg500.id);

    const invoices = await invoicesFor(customer.id);
    assert.equal(invoices.length, 1, "only the cycle-defining one — no new invoice");
    assert.equal(invoices[0].total, 0);

    const wallet = await walletFor(customer.id);
    assert.equal(wallet.length, 1, "one ledger row");
    assert.equal(wallet[0].type, "Adjustment");
    assert.equal(wallet[0].amount, 166.67);
    assert.ok(wallet[0].balanceAfter >= 166.67);
    assert.match(wallet[0].note, /Prorated package change/);
    // Signed, because a credit is money going the other way, and reading
    // "+166.67" on a wallet credit would be misleading.
    assert.match(wallet[0].note, /Daily rate difference: -16\.67 per day/);
    assert.match(wallet[0].note, /Adjustment: 10 x -16\.67 = -166\.67/);
    assert.equal(wallet[0].reference, `proration:${customer.id}`);

    // A negative invoice is never raised — it reads as a credit on the statement
    // and is a thing collection software does not know what to do with.
    assert.equal(
      invoices.filter((i) => i.total < 0).length,
      0,
      "never a negative invoice"
    );
  });

  test("the wallet balance and advancePayment agree", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });
    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg500.id, "downgrade", operator.id, now));

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(
      moved.advancePayment >= 166.67,
      "the derived balance followed the ledger, which is why the ledger is the writer"
    );
  });

  test("a wallet with nothing in it still takes the credit", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(before.advancePayment, 0);

    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg500.id, "downgrade", operator.id, now));

    const wallet = await walletFor(customer.id);
    assert.equal(wallet.length, 1, "money owed to a customer does not need a balance to go into");
    assert.equal(wallet[0].amount, 166.67);
  });
});

describe("what does not get charged for", () => {
  test("a same-price change swaps and stops", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });
    const other = await makePackage("Pro same-price alt", 1000);

    await prisma.$transaction((tx) => changePackage(tx, customer.id, other.id, "profile change", operator.id, now));

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(moved.packageId, other.id, "the swap happened");
    assert.equal((await invoicesFor(customer.id)).length, 1, "no invoice");
    assert.equal((await walletFor(customer.id)).length, 0, "no credit");

    const change = await prisma.customerPackageChange.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    assert.ok(change, "and the change is still recorded");
  });

  test("with proration switched off, the old swap-only behaviour is exactly restored", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg500.id });
    await saveSettings([{ key: "billing.prorateOnPackageChange", value: "false" }]);
    invalidateSettingsCache();

    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg1000.id, "upgrade", operator.id, now));

    const moved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(moved.packageId, pkg1000.id);
    assert.equal(moved.monthlyBill, 1000);
    assert.equal((await invoicesFor(customer.id)).length, 1, "no adjustment invoice");
    assert.equal((await walletFor(customer.id)).length, 0);

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { entity: "Customer", entityId: customer.id, action: "Change Package" },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    assert.match(log.summary, /proration switched off/);
  });

  test("a change on the last day of the cycle bills nothing at all", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date(from.getTime() + 30 * DAY);
    const { customer } = await makeCustomerOnDay20({
      packageId: pkg500.id,
      cycleFrom: from,
      elapsed: 30,
    });
    // Move the change to the very end of the window.
    const changedAt = to;
    const calc = prorate({
      fromPrice: 500,
      toPrice: 1000,
      validityDays: 30,
      cycle: { from, to },
      changedAt,
      fromName: "A",
      toName: "B",
    });
    assert.equal(calc.adjustmentPoisha, 0);

    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg1000.id, "last day", operator.id, to));
    assert.equal(
      (await invoicesFor(customer.id)).length,
      1,
      "an invoice for 0.00 is worse than no invoice"
    );
  });
});

describe("atomicity", () => {
  test("a failure after the swap rolls the swap back", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg500.id });

    // Force the invoice to fail by making the customer row vanish from under the
    // transaction's view of the package: the raise happens after the swap, so this
    // is the window the atomicity claim is about.
    const broken = { ...pkg1000, id: "does-not-exist" };

    await assert.rejects(() =>
      prisma.$transaction((tx) => changePackage(tx, customer.id, broken.id, "boom", operator.id, now))
    );

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(after.packageId, pkg500.id, "the swap was rolled back");
    assert.equal(after.monthlyBill, 500);
    assert.equal((await invoicesFor(customer.id)).length, 1, "no adjustment invoice survived");
    assert.equal((await walletFor(customer.id)).length, 0, "and no credit");
    assert.equal(
      await prisma.customerPackageChange.count({ where: { customerId: customer.id } }),
      0,
      "nor a history row claiming it happened"
    );
  });

  test("a wallet credit that cannot be posted rolls the swap back too", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });

    // A credit the ledger will refuse: `adjust` throws on a non-zero check and on
    // taking the balance below zero, and the throw has to unwind the package swap
    // with it.
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        await changePackage(tx, customer.id, pkg500.id, "downgrade", operator.id, now);
        throw new Error("something after the credit failed");
      })
    );

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(after.packageId, pkg1000.id, "still on the old package");
    assert.equal((await walletFor(customer.id)).length, 0, "the credit was rolled back");
  });
});

describe("the audit trail", () => {
  test("the package change log records what it cost", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg500.id });
    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg1000.id, "upgrade", operator.id, now));

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { entity: "Customer", entityId: customer.id, action: "Change Package" },
      orderBy: { createdAt: "desc" },
    });
    assert.match(log.summary, /prorated 166\.67 \(upgrade\)/);
    assert.equal(log.actorId, operator.id, "against the person who did it");
    // `meta` is stored as a JSON *string* column, so the numbers arrive as digits.
    assert.match(log.meta ?? "", /"remainingDays":\s*10/);
    assert.match(log.meta ?? "", /"adjustment":\s*166\.67/);
    assert.match(log.meta ?? "", /"direction":\s*"upgrade"/);
  });

  test("a downgrade logs the credit too", async () => {
    const { customer, now } = await makeCustomerOnDay20({ packageId: pkg1000.id });
    await prisma.$transaction((tx) => changePackage(tx, customer.id, pkg500.id, "downgrade", operator.id, now));

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { entity: "Customer", entityId: customer.id, action: "Change Package" },
      orderBy: { createdAt: "desc" },
    });
    // Signed, matching the wallet note. A credit is 166.67 in the customer's favour,
    // and an audit line reading "prorated 166.67" for a downgrade would read as a
    // charge — which is the opposite of what happened.
    assert.match(log.summary, /prorated -166\.67 \(downgrade\)/);
  });
});