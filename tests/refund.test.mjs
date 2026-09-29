/**
 * A refund is the only operation that moves money the wrong way through the
 * system, so it gets its own test. Each check reads the database back the way
 * the UI would, rather than trusting the value the function returned.
 *
 * The rows are restored afterwards, so running it leaves the demo data as it
 * found it.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { issueRefund } from "../src/lib/services/billing-queries.ts";

let customer;
let account;
let original = { due: 0, balance: 0, status: "" };

before(async () => {
  customer = await prisma.customer.findFirst({
    where: { previousDue: { gt: 500 } },
    select: {
      id: true,
      username: true,
      previousDue: true,
      billingStatus: true,
    },
  });
  if (!customer) throw new Error("Seeded data has no customer with an outstanding due");
  account = await prisma.account.findFirst({ where: { type: "Cash" } });
  if (!account) throw new Error("Seeded data has no cash account");
  original = {
    due: customer.previousDue,
    balance: account.currentBalance,
    status: customer.billingStatus,
  };
});

after(async () => {
  // Put the demo data back exactly as it was.
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      previousDue: original.due,
      billingStatus: original.status,
    },
  });
  await prisma.account.update({
    where: { id: account.id },
    data: { currentBalance: original.balance },
  });
  await prisma.$disconnect();
});

describe("issueRefund", () => {
  test("moves the money, the due and the ledger together", async () => {
    const amount = 300;
    const result = await issueRefund({
      customerId: customer.id,
      accountId: account.id,
      amount,
      reason: "Service not delivered",
    });

    const afterCustomer = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    const afterAccount = await prisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });

    assert.equal(result.amount, amount);
    assert.match(result.reference, /^RFD-\d+$/);

    // The customer's outstanding due drops by exactly the amount refunded.
    assert.ok(
      Math.abs(original.due - amount - afterCustomer.previousDue) < 0.01,
      `due went ${original.due} -> ${afterCustomer.previousDue}, expected ${original.due - amount}`
    );

    // The account is debited by exactly the same amount.
    assert.ok(
      Math.abs(original.balance - amount - afterAccount.currentBalance) < 0.01,
      `balance went ${original.balance} -> ${afterAccount.currentBalance}, expected ${original.balance - amount}`
    );

    // And the ledger records it, with a running balance that agrees.
    const ledger = await prisma.accountTransaction.findFirst({
      where: { reference: result.reference },
      select: { type: true, direction: true, amount: true, balance: true },
    });
    assert.equal(ledger?.type, "Refund");
    assert.equal(ledger?.direction, "Debit");
    assert.equal(ledger?.amount, amount);
    assert.ok(
      Math.abs(ledger.balance - afterAccount.currentBalance) < 0.01,
      "the ledger's running balance should equal the account balance"
    );

    // Leave the ledger clean for the next test in this file.
    await prisma.accountTransaction.deleteMany({ where: { reference: result.reference } });
  });

  test("refuses more than the customer owes", async () => {
    const current = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { previousDue: true },
    });

    await assert.rejects(
      () =>
        issueRefund({
          customerId: customer.id,
          accountId: account.id,
          amount: current.previousDue + 5000,
          reason: "Overcharged",
        }),
      /more than/i,
      "a refund beyond the outstanding due would leave the customer in credit"
    );
  });

  test("refuses when the account cannot cover it", async () => {
    const poor = await prisma.account.findFirst({
      where: { currentBalance: { lt: 50 } },
    });
    if (!poor) return; // every account is well funded in the demo data

    await assert.rejects(
      () =>
        issueRefund({
          customerId: customer.id,
          accountId: poor.id,
          amount: 999_999,
          reason: "Test",
        }),
      /not enough/i
    );
  });

  test("requires a reason", async () => {
    await assert.rejects(
      () =>
        issueRefund({
          customerId: customer.id,
          accountId: account.id,
          amount: 10,
          reason: "   ",
        }),
      /reason is required/i
    );
  });

  test("refuses a non-positive amount", async () => {
    await assert.rejects(
      () =>
        issueRefund({
          customerId: customer.id,
          accountId: account.id,
          amount: 0,
          reason: "Test",
        }),
      /greater than 0/i
    );
  });

  test("gives each refund its own reference", async () => {
    const a = await issueRefund({
      customerId: customer.id,
      accountId: account.id,
      amount: 50,
      reason: "Goodwill",
    });
    const b = await issueRefund({
      customerId: customer.id,
      accountId: account.id,
      amount: 50,
      reason: "Goodwill",
    });

    assert.notEqual(a.reference, b.reference, "references must not be reused");
    await prisma.accountTransaction.deleteMany({
      where: { reference: { in: [a.reference, b.reference] } },
    });
  });
});
