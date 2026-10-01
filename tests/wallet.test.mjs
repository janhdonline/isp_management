/**
 * The customer wallet.
 *
 * The property that matters is not any individual movement — it is that the ledger
 * and the cached balance can never disagree, under concurrency or after a
 * failure. Everything else here is in service of proving that:
 *
 *   - a top-up is one transaction, so it is all-or-nothing rather than "the cash
 *     was taken and the ledger row was not";
 *   - the ledger sums to `advancePayment` for every customer, which is what makes
 *     the cached number auditable rather than authoritative-by-fiat;
 *   - parallel top-ups serialise on the customer row instead of overwriting each
 *     other, which is how money goes missing without any error.
 */
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import {
  post,
  topUp,
  adjust,
  refundOut,
  consumeForInvoice,
  walletHistory,
  walletDrift,
} from "../src/lib/services/wallet.ts";
import { createInvoice } from "../src/lib/services/billing.ts";
import { round2 } from "../src/lib/utils.ts";
import { nextNumber } from "../src/lib/counter.ts";

const stamp = Date.now();
const customerIds = [];
let pkg;
let area;
let account;

async function makeCustomer(over = {}) {
  const n = customerIds.length + 1;
  const row = await prisma.customer.create({
    data: {
      customerCode: `WALLET-${stamp}-${n}`,
      name: `Wallet Test ${n}`,
      username: `wallet${stamp}${n}`,
      phone: `018${String(10000000 + n)}`,
      connectionStatus: "Active",
      packageId: pkg.id,
      areaId: area.id,
      connectionDate: new Date(),
      monthlyBill: 500,
      advancePayment: 0,
      ...over,
    },
    select: { id: true, name: true, advancePayment: true },
  });
  customerIds.push(row.id);
  return row;
}

async function makePayment(customerId, amount = 100) {
  return prisma.$transaction(async (tx) => {
    const paymentId = await nextNumber(tx, `wallet-test-payment-${stamp}`, `WAL-PAY-${stamp}-`);
    return tx.payment.create({
      data: { paymentId, customerId, amount, method: "Cash", accountId: account.id },
      select: { id: true, paymentId: true, amount: true },
    });
  });
}

const balanceOf = async (id) =>
  round2((await prisma.customer.findUniqueOrThrow({ where: { id }, select: { advancePayment: true } })).advancePayment ?? 0);

const ledgerSum = async (id) =>
  round2(
    (
      await prisma.walletTransaction.aggregate({
        where: { customerId: id },
        _sum: { amount: true },
      })
    )._sum.amount ?? 0
  );

before(async () => {
  pkg = await prisma.package.create({
    data: {
      name: `Wallet Test Package ${stamp}`,
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
    data: { name: `Wallet Test Area ${stamp}`, code: `WT${stamp % 100000}`, status: "Active" },
    select: { id: true },
  });
  account = await prisma.account.create({
    data: {
      name: `Wallet Test Account ${stamp}`,
      type: "Cash",
      accountNumber: `WT${stamp % 10000}`,
      currentBalance: 0,
    },
    select: { id: true },
  });
});

beforeEach(async () => {
  if (customerIds.length) {
    await prisma.walletTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({
      where: { id: { in: customerIds } },
      data: { advancePayment: 0 },
    });
  }
});

after(async () => {
  if (customerIds.length) {
    await prisma.walletTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (account) await prisma.account.deleteMany({ where: { id: account.id } });
  if (area) await prisma.area.deleteMany({ where: { id: area.id } });
  if (pkg) await prisma.package.deleteMany({ where: { id: pkg.id } });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("top-ups", () => {
  test("1000 in gives a 1000 balance and one TopUp row", async () => {
    const c = await makeCustomer();
    const payment = await makePayment(c.id, 1000);

    const result = await prisma.$transaction((tx) =>
      topUp(tx, {
        customerId: c.id,
        amount: 1000,
        paymentId: payment.id,
        note: "Paying ahead",
        reference: payment.paymentId,
      })
    );

    assert.equal(result.balance, 1000);
    assert.equal(result.transaction.type, "TopUp");
    assert.equal(result.transaction.amount, 1000);
    assert.equal(result.transaction.balanceAfter, 1000, "the running snapshot, not the delta");
    assert.equal(await balanceOf(c.id), 1000);

    const rows = await walletHistory(c.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].paymentId, payment.id, "a top-up is always tied to its payment");
  });

  test("top-ups accumulate and the snapshot reads as a running balance", async () => {
    const c = await makeCustomer();
    for (const amount of [100, 250, 50]) {
      const payment = await makePayment(c.id, amount);
      await prisma.$transaction((tx) =>
        topUp(tx, { customerId: c.id, amount, paymentId: payment.id })
      );
    }

    assert.equal(await balanceOf(c.id), 400);
    const rows = (await walletHistory(c.id, { take: 10 })).reverse();
    assert.deepEqual(
      rows.map((r) => r.balanceAfter),
      [100, 350, 400],
      "each row shows the balance immediately after it"
    );
  });

  test("a top-up of zero or less is refused", async () => {
    const c = await makeCustomer();
    const payment = await makePayment(c.id);
    for (const amount of [0, -50]) {
      await assert.rejects(
        prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount, paymentId: payment.id })),
        /greater than zero/
      );
    }
    assert.equal(await balanceOf(c.id), 0);
  });

  test("a failure part-way through leaves neither the ledger row nor the balance", async () => {
    // All-or-nothing, demonstrated rather than asserted: a payload that blows up
    // after the ledger row is written must roll the whole thing back, and the
    // alternative — writing the row, then the balance, then finding out — is the
    // bug this transaction exists to make impossible.
    const c = await makeCustomer();
    const payment = await makePayment(c.id, 500);

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await topUp(tx, { customerId: c.id, amount: 500, paymentId: payment.id });
        throw new Error("the rest of the top-up failed");
      }),
      /the rest of the top-up failed/
    );

    assert.equal(await balanceOf(c.id), 0, "the balance rolled back with the row");
    assert.equal(await prisma.walletTransaction.count({ where: { customerId: c.id } }), 0);
  });
});

/* ------------------------------------------------------------------ */

describe("parallel top-ups", () => {
  test("ten at once: every one is recorded and the balance is the sum", async () => {
    // Without the row lock each of these reads the same balance and each writes
    // the same result, so nine payments' worth of money vanishes and the ledger
    // has ten rows that claim the same balance.
    const c = await makeCustomer();
    const payments = await Promise.all(
      Array.from({ length: 10 }, () => makePayment(c.id, 100))
    );

    const results = await Promise.all(
      payments.map((p) =>
        prisma.$transaction((tx) =>
          topUp(tx, { customerId: c.id, amount: 100, paymentId: p.id })
        )
      )
    );

    assert.equal(await balanceOf(c.id), 1000, "the balance is the sum of all ten");
    assert.equal(await prisma.walletTransaction.count({ where: { customerId: c.id } }), 10);

    const snapshots = results.map((r) => r.balance).sort((a, b) => a - b);
    assert.deepEqual(
      snapshots,
      [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
      "each transaction saw a distinct balance, so none overwrote another"
    );
    assert.equal(await ledgerSum(c.id), 1000, "and the ledger still sums to it");
  });

  test("mixed movements in parallel still reconcile", async () => {
    const c = await makeCustomer();
    const ops = [
      { kind: "topup", amount: 500 },
      { kind: "topup", amount: 500 },
      { kind: "topup", amount: 500 },
      { kind: "refund", amount: 200 },
      { kind: "topup", amount: 500 },
    ];

    await Promise.all(
      ops.map((op) =>
        prisma.$transaction(async (tx) => {
          const p = await makePayment(c.id, op.amount);
          if (op.kind === "topup") {
            return topUp(tx, { customerId: c.id, amount: op.amount, paymentId: p.id });
          }
          return refundOut(tx, {
            customerId: c.id,
            amount: op.amount,
            reason: "parallel test",
          });
        })
      )
    );

    assert.equal(await balanceOf(c.id), 1800);
    assert.equal(await ledgerSum(c.id), 1800);
  });
});

/* ------------------------------------------------------------------ */

describe("invoice consumption", () => {
  test("a wallet of 1000 settles a 500 bill and keeps 500", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 1000);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 1000, paymentId: p.id }));

    const invoice = await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
      })
    );

    assert.equal(invoice.paid, 500, "the invoice was raised already settled");
    assert.equal(invoice.status, "Paid");
    assert.equal(await balanceOf(c.id), 500);

    const consume = await prisma.walletTransaction.findFirstOrThrow({
      where: { customerId: c.id, type: "InvoiceConsume" },
    });
    assert.equal(consume.amount, -500);
    assert.equal(consume.balanceAfter, 500);
    assert.equal(consume.invoiceId, invoice.id);
  });

  test("a wallet smaller than the bill is capped at the balance", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 300);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 300, paymentId: p.id }));

    const invoice = await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
      })
    );

    assert.equal(invoice.paid, 300, "never more than the wallet holds");
    assert.equal(invoice.status, "Partial");
    assert.equal(await balanceOf(c.id), 0, "and the wallet is emptied, not overdrawn");
  });

  test("an empty wallet changes nothing", async () => {
    const c = await makeCustomer();
    const invoice = await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
      })
    );
    assert.equal(invoice.paid, 0);
    assert.equal(await balanceOf(c.id), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { customerId: c.id } }), 0);
  });

  test("a second bill is covered by what is left", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 1000);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 1000, paymentId: p.id }));

    await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
      })
    );
    const second = await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
      })
    );

    assert.equal(second.paid, 500);
    assert.equal(await balanceOf(c.id), 0);
    assert.equal((await prisma.walletTransaction.count({ where: { customerId: c.id, type: "InvoiceConsume" } })), 2);
  });

  test("consumption never drives the balance negative", async () => {
    const c = await makeCustomer();
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `WAL-CONS-${stamp}-1`,
        customerId: c.id,
        dueDate: new Date(),
        amount: 900,
        total: 900,
        paid: 0,
        status: "Due",
      },
      select: { id: true },
    });
    const p = await makePayment(c.id, 250);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 250, paymentId: p.id }));

    const r = await prisma.$transaction((tx) =>
      consumeForInvoice(tx, { invoiceId: invoice.id, customerId: c.id })
    );
    assert.equal(r.consumed, 250);
    assert.equal(r.balance, 0);
    assert.ok(r.balance >= 0);
  });

  test("an already-paid invoice is not consumed from again", async () => {
    const c = await makeCustomer();
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `WAL-PAID-${stamp}-1`,
        customerId: c.id,
        dueDate: new Date(),
        amount: 500,
        total: 500,
        paid: 500,
        status: "Paid",
      },
      select: { id: true },
    });
    const p = await makePayment(c.id, 400);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 400, paymentId: p.id }));

    const r = await prisma.$transaction((tx) =>
      consumeForInvoice(tx, { invoiceId: invoice.id, customerId: c.id })
    );
    assert.equal(r.consumed, 0, "outstanding is zero, so there is nothing to take");
    assert.equal(await balanceOf(c.id), 400);
  });
});

/* ------------------------------------------------------------------ */

describe("adjustments", () => {
  test("one with a reason moves the balance and leaves a row", async () => {
    const c = await makeCustomer();
    const r = await prisma.$transaction((tx) =>
      adjust(tx, { customerId: c.id, amount: 250, reason: "Drawer counted short on 12 Oct" })
    );
    assert.equal(r.balance, 250);
    assert.equal(r.transaction.type, "Adjustment");
    assert.match(r.transaction.note, /Drawer counted short/);
    assert.equal(await ledgerSum(c.id), 250);
  });

  test("one without a reason is refused, and leaves nothing behind", async () => {
    const c = await makeCustomer();
    for (const reason of ["", "   ", "\n\t "]) {
      await assert.rejects(
        prisma.$transaction((tx) => adjust(tx, { customerId: c.id, amount: 100, reason })),
        /needs a reason/
      );
    }
    assert.equal(await balanceOf(c.id), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { customerId: c.id } }), 0);
  });

  test("one of zero is refused", async () => {
    const c = await makeCustomer();
    await assert.rejects(
      prisma.$transaction((tx) => adjust(tx, { customerId: c.id, amount: 0, reason: "typo" })),
      /non-zero/
    );
  });

  test("one cannot take the wallet below zero", async () => {
    const c = await makeCustomer();
    await assert.rejects(
      prisma.$transaction((tx) => adjust(tx, { customerId: c.id, amount: -50, reason: "oops" })),
      /below zero/
    );
    assert.equal(await balanceOf(c.id), 0);
  });
});

/* ------------------------------------------------------------------ */

describe("refunds", () => {
  test("a refund reduces the balance", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 800);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 800, paymentId: p.id }));

    const r = await prisma.$transaction((tx) =>
      refundOut(tx, { customerId: c.id, amount: 300, reason: "Moved house" })
    );
    assert.equal(r.balance, 500);
    assert.equal(r.transaction.amount, -300);
    assert.equal(await ledgerSum(c.id), 500);
  });

  test("a refund larger than the balance stops at zero rather than going negative", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 200);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 200, paymentId: p.id }));

    const r = await prisma.$transaction((tx) =>
      refundOut(tx, { customerId: c.id, amount: 500, reason: "Customer asked for it all back" })
    );
    assert.equal(r.balance, 0, "never below zero");
    assert.equal(r.transaction.amount, -200, "the row records what was actually taken");
    assert.equal(await ledgerSum(c.id), 0, "and the ledger still reconciles");
  });

  test("a refund of zero or less is refused", async () => {
    const c = await makeCustomer();
    for (const amount of [0, -10]) {
      await assert.rejects(
        prisma.$transaction((tx) =>
          refundOut(tx, { customerId: c.id, amount, reason: "x" })
        ),
        /greater than zero/
      );
    }
  });
});

/* ------------------------------------------------------------------ */

describe("reconciliation", () => {
  test("the ledger sums to the balance across a pile of mixed operations", async () => {
    const c = await makeCustomer();
    const p = await makePayment(c.id, 5000);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 5000, paymentId: p.id }));

    await prisma.$transaction((tx) =>
      createInvoice(tx, {
        customerId: c.id,
        packageId: pkg.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 1200,
      })
    );
    await prisma.$transaction((tx) =>
      adjust(tx, { customerId: c.id, amount: -17.5, reason: "rounding correction" })
    );
    await prisma.$transaction((tx) =>
      refundOut(tx, { customerId: c.id, amount: 100, reason: "goodwill" })
    );
    const p2 = await makePayment(c.id, 60.25);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 60.25, paymentId: p2.id }));

    assert.equal(await ledgerSum(c.id), 3742.75);
    assert.equal(await balanceOf(c.id), 3742.75);
    assert.deepEqual(await walletDrift(), [], "no customer is out by more than half a paisa");
  });

  test("walletDrift names a customer whose ledger and balance disagree", async () => {
    // The guard is only worth having if it can actually fail, so this writes the
    // drift directly and checks the query finds it.
    const c = await makeCustomer();
    const p = await makePayment(c.id, 300);
    await prisma.$transaction((tx) => topUp(tx, { customerId: c.id, amount: 300, paymentId: p.id }));

    assert.deepEqual(await walletDrift(), [], "clean while the two agree");

    await prisma.customer.update({
      where: { id: c.id },
      data: { advancePayment: 999 },
    });

    const drift = await walletDrift();
    assert.equal(drift.length, 1, "and reports it when they do not");
    assert.equal(drift[0].customerId, c.id);
    assert.equal(round2(drift[0].drift), -699);

    await prisma.customer.update({ where: { id: c.id }, data: { advancePayment: 300 } });
    assert.deepEqual(await walletDrift(), []);
  });

  test("every customer in the database reconciles, not just this file's", async () => {
    // The seeded customers have no wallet rows and no advance payment, so they
    // are the easy case; the point is that the check covers the whole table.
    const drift = await walletDrift();
    assert.deepEqual(drift, [], `drifted: ${drift.map((d) => d.customerId).join(", ")}`);
  });
});

/* ------------------------------------------------------------------ */

describe("post()", () => {
  test("it is the only writer of both the ledger row and the balance", async () => {
    // A structural claim, checked the only way it can be: reach into the module's
    // own writes and confirm nothing else in this file touches advancePayment.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/lib/services/wallet.ts", import.meta.url), "utf8")
    );
    const updates = source.match(/advancePayment:\s*next/g) ?? [];
    assert.equal(updates.length, 1, "one place writes the cached balance, and it is `post`");
  });

  test("it clamps to the floor when asked", async () => {
    const c = await makeCustomer();
    const r = await prisma.$transaction((tx) =>
      post(tx, { customerId: c.id, type: "Adjustment", amount: -9999, note: "clamped", floor: 0 })
    );
    assert.equal(r.balance, 0);
    assert.equal(await ledgerSum(c.id), 0);
  });
});