/**
 * Cash shifts. The reconciliation is the whole point: a till that quietly
 * corrects itself teaches nobody anything, and a shortfall has to point at one
 * person rather than at the day's takings in general.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { openShift, closeShift, shiftSummary, dayCloseReport } from "../src/lib/services/cash-session.ts";

let account;
let userId;
let shiftId;

const cleanup = async () => {
  if (shiftId) {
    await prisma.cashShift.deleteMany({ where: { id: shiftId } });
  }
  if (account) {
    await prisma.accountTransaction.deleteMany({
      where: { description: { contains: "Cash count" } },
    });
  }
};

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("cash shifts", () => {
  test("a shift opens with a float and refuses a second one", async () => {
    account = await prisma.account.findFirstOrThrow({ where: { type: "Cash" } });
    const user = await prisma.user.findFirstOrThrow({
      where: { email: "manager@isp.com" },
      select: { id: true },
    });
    userId = user.id;

    // Clear any shift left behind by a previous run.
    await prisma.cashShift.deleteMany({ where: { accountId: account.id } });

    const shift = await openShift({ accountId: account.id, openingFloat: 500, userId });
    shiftId = shift.id;

    assert.equal(shift.openingFloat, 500);
    assert.equal(shift.status, "Open");
    assert.match(shift.shiftNumber, /^SHF-\d+$/);

    await assert.rejects(
      () => openShift({ accountId: account.id, openingFloat: 100, userId }),
      /already has an open shift/,
      "two people cannot hold the same till"
    );
  });

  test("the summary shows the float before any money moves", async () => {
    const s = await shiftSummary(shiftId);
    assert.equal(s.taken, 0);
    assert.equal(s.paidOut, 0);
    assert.equal(s.expected, 500, "expected equals the float when nothing has happened");
  });

  test("a balanced count closes with no variance and no ledger entry", async () => {
    const before = await prisma.accountTransaction.count({
      where: { description: { contains: "Cash count" } },
    });

    const closed = await closeShift({ shiftId, countedCash: 500, userId });

    assert.equal(closed.status, "Closed");
    assert.equal(closed.variance, 0);
    assert.equal(closed.countedCash, 500);
    assert.ok(closed.closedAt, "a closed shift needs a timestamp");

    const after = await prisma.accountTransaction.count({
      where: { description: { contains: "Cash count" } },
    });
    assert.equal(after, before, "a balanced close should not touch the ledger");
  });

  test("a short count is recorded and posted to the ledger", async () => {
    // A second shift, so this exercises the money-moving path.
    await prisma.cashShift.deleteMany({ where: { accountId: account.id } });
    const shift = await openShift({ accountId: account.id, openingFloat: 1000, userId });
    shiftId = shift.id;

    const accBefore = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).currentBalance;

    const closed = await closeShift({ shiftId: shift.id, countedCash: 970, userId });

    assert.equal(closed.variance, -30, "30 counted short");
    assert.equal(closed.expected, 1000);

    const accAfter = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).currentBalance;
    assert.ok(
      Math.abs(accBefore - 30 - accAfter) < 0.01,
      `account should drop by 30: ${accBefore} -> ${accAfter}`
    );

    const entry = await prisma.accountTransaction.findFirst({
      where: { reference: closed.shiftNumber },
      select: { type: true, direction: true, amount: true, description: true },
    });
    assert.ok(entry, "the variance must be written to the ledger");
    assert.equal(entry.type, "Adjustment");
    assert.equal(entry.direction, "Debit");
    assert.equal(entry.amount, 30);
    assert.match(entry.description, /short by 30/);

    // Restore the balance so later runs are unaffected.
    await prisma.account.update({ where: { id: account.id }, data: { currentBalance: accBefore } });
    await prisma.accountTransaction.deleteMany({ where: { reference: closed.shiftNumber } });
  });

  test("a closed shift cannot be closed again", async () => {
    await assert.rejects(
      () => closeShift({ shiftId, countedCash: 500, userId }),
      /already closed/
    );
  });

  test("the day report totals every branch's cash position", async () => {
    const report = await dayCloseReport();
    assert.ok(report.rows.length > 0, "there should be at least one cash account");
    assert.equal(typeof report.metrics.taken, "number");
    assert.equal(typeof report.metrics.variance, "number");
    for (const row of report.rows) {
      assert.ok(row.account.name, "each row names its account");
      assert.ok(Array.isArray(row.shifts));
    }
  });

  test("a non-cash account cannot hold a shift", async () => {
    const bank = await prisma.account.findFirst({ where: { type: { not: "Cash" } } });
    if (!bank) return;
    await assert.rejects(
      () => openShift({ accountId: bank.id, openingFloat: 100, userId }),
      /only meaningful for a cash account/
    );
  });

  test("a negative float is refused", async () => {
    await prisma.cashShift.deleteMany({ where: { accountId: account.id } });
    await assert.rejects(
      () => openShift({ accountId: account.id, openingFloat: -50, userId }),
      /cannot be negative/
    );
  });
});
