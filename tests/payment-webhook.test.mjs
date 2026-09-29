/**
 * Payment gateway callbacks.
 *
 * Every check here is an attack or a provider quirk rather than a happy path,
 * because the happy path is the one thing a webhook does not get wrong by
 * itself. The properties under test:
 *
 *  - a callback is a claim, not a fact: the amount is re-checked against our own
 *    invoice, and a mismatch writes nothing;
 *  - providers retry: the same transaction delivered twice is one payment;
 *  - the gateway's own validation API is the authority: a callback for a
 *    transaction it does not recognise writes nothing at all.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import { startMockGateway } from "./mock-gateway.mjs";
import { POST as webhook } from "../src/app/api/webhooks/[provider]/route.ts";

let gateway;
let customer;
let originalSettings = {};
let createdInvoiceId;

const SETTINGS = [
  "api.sslcommerzStoreId",
  "api.sslcommerzStorePassword",
  "api.sslcommerzSandbox",
];

before(async () => {
  gateway = await startMockGateway();
  process.env.PAYMENT_GATEWAY_BASE_URL = gateway.baseUrl;

  for (const key of SETTINGS) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originalSettings[key] = row?.value ?? "";
  }
  await saveSettings([
    { key: "api.sslcommerzStoreId", value: "teststore" },
    { key: "api.sslcommerzStorePassword", value: "testpassword" },
    { key: "api.sslcommerzSandbox", value: "true" },
  ]);

  customer = await prisma.customer.findFirstOrThrow({
    select: { id: true, name: true, connectionStatus: true },
  });
});

after(async () => {
  delete process.env.PAYMENT_GATEWAY_BASE_URL;
  if (createdInvoiceId) {
    await prisma.payment.deleteMany({ where: { invoiceId: createdInvoiceId } });
    await prisma.invoice.deleteMany({ where: { id: createdInvoiceId } });
  }
  for (const [key, value] of Object.entries(originalSettings)) {
    await saveSettings([{ key, value }]);
  }
  await gateway.close();
  await prisma.$disconnect();
});

/** A fresh unpaid invoice, so each check starts from a known balance. */
async function makeInvoice(total = 1000) {
  if (createdInvoiceId) {
    await prisma.payment.deleteMany({ where: { invoiceId: createdInvoiceId } });
    await prisma.invoice.deleteMany({ where: { id: createdInvoiceId } });
  }
  const row = await prisma.invoice.create({
    data: {
      invoiceNumber: `TEST-GW-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      amount: total,
      total,
      paid: 0,
      status: "Due",
    },
    select: { id: true, invoiceNumber: true, total: true, paid: true },
  });
  createdInvoiceId = row.id;
  return row;
}

async function post(body, provider = "sslcommerz") {
  return webhook(
    new Request("http://localhost/api/webhooks/sslcommerz", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider }) }
  );
}

beforeEach(() => gateway.reset());

/* ------------------------------------------------------------------ */

describe("payment gateway callback", () => {
  test("a valid callback settles the invoice and issues a receipt", async () => {
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000000`;
    gateway.seed("VAL-1", { tranId, amount: 1000 });

    const res = await post({ tran_id: tranId, val_id: "VAL-1", amount: "1000.00" });
    const body = await res.json();

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.recorded, true);
    assert.ok(body.paymentId, "a payment id should come back");

    // Read the database back rather than trusting the response.
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: inv.id },
      include: { receipt: true },
    });
    assert.equal(payment.amount, 1000);
    assert.equal(payment.method, "Online");
    assert.equal(payment.gatewayTxnId, "VAL-1");
    assert.ok(payment.receipt, "an online payment must still get a receipt");

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(after.status, "Paid", "a full payment settles the invoice");
    assert.equal(after.paid, 1000);
  });

  test("the same transaction delivered twice creates exactly one payment", async () => {
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000001`;
    gateway.seed("VAL-2", { tranId, amount: 1000 });

    const first = await post({ tran_id: tranId, val_id: "VAL-2", amount: "1000.00" });
    const firstBody = await first.json();
    assert.equal(firstBody.recorded, true);

    // Providers retry. This is the case that turns one customer payment into two
    // payments in the ledger and a credit the ISP has to chase back.
    const second = await post({ tran_id: tranId, val_id: "VAL-2", amount: "1000.00" });
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(secondBody.recorded, false);
    assert.equal(secondBody.duplicate, true);

    const count = await prisma.payment.count({ where: { invoiceId: inv.id } });
    assert.equal(count, 1, "a duplicate delivery must not create a second payment");
  });

  test("a tampered posted amount is ignored in favour of the validated one", async () => {
    // The dangerous shape of this attack is posting a *smaller* figure than was
    // really paid, hoping the handler records what the callback says. It cannot:
    // the posted amount is only used to decide what to ask the gateway, and the
    // figure that gets recorded is the one the gateway validates.
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000002`;
    gateway.seed("VAL-3", { tranId, amount: 1000 });

    const res = await post({ tran_id: tranId, val_id: "VAL-3", amount: "100.00" });
    const body = await res.json();

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.recorded, true);

    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    assert.equal(
      payment.amount,
      1000,
      "the validated amount is recorded, not the one the caller posted"
    );
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(after.paid, 1000);
  });

  test("more than the balance is refused even when the gateway agrees", async () => {
    const inv = await makeInvoice(500);
    const tranId = `${inv.invoiceNumber}-1700000003`;
    // A genuine payment, but of more than the customer owes.
    gateway.seed("VAL-4", { tranId, amount: 5000 });

    const res = await post({ tran_id: tranId, val_id: "VAL-4", amount: "5000.00" });
    const body = await res.json();

    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(body.invoiceBalance, 500);
    assert.equal(
      await prisma.payment.count({ where: { invoiceId: inv.id } }),
      0,
      "overpayment through a gateway must not be recorded silently"
    );
  });

  test("a callback the gateway does not recognise writes nothing", async () => {
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000004`;
    // Nothing seeded: the validation endpoint will report no such transaction.
    const res = await post({ tran_id: tranId, val_id: "VAL-FORGED", amount: "1000.00" });

    assert.equal(res.status, 400);
    assert.equal(
      await prisma.payment.count({ where: { invoiceId: inv.id } }),
      0,
      "a forged callback must not create a payment"
    );
  });

  test("a rejected transaction is acknowledged, not retried forever", async () => {
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000005`;
    gateway.seed("VAL-5", { tranId, amount: 1000, status: "FAILED" });

    const res = await post({ tran_id: tranId, val_id: "VAL-5", amount: "1000.00" });
    const body = await res.json();

    // 200 so the provider stops delivering, but nothing recorded.
    assert.equal(res.status, 200);
    assert.equal(body.recorded, false);
    assert.equal(body.status, "Failed");
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 0);
  });

  test("a callback for an unknown invoice is a 404, not a payment", async () => {
    const tranId = `NO-SUCH-INVOICE-1700000006`;
    gateway.seed("VAL-6", { tranId, amount: 500 });

    const res = await post({ tran_id: tranId, val_id: "VAL-6", amount: "500.00" });
    assert.equal(res.status, 404);
  });

  test("an unknown provider is refused", async () => {
    const res = await post({ tran_id: "x", val_id: "y", amount: "1" }, "stripe");
    assert.equal(res.status, 404);
  });

  test("a partial payment leaves the rest outstanding", async () => {
    const inv = await makeInvoice(1000);
    const tranId = `${inv.invoiceNumber}-1700000007`;
    gateway.seed("VAL-7", { tranId, amount: 400 });

    const res = await post({ tran_id: tranId, val_id: "VAL-7", amount: "400.00" });
    const body = await res.json();
    assert.equal(body.recorded, true);
    assert.equal(body.remaining, 600);

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(after.paid, 400);
    assert.equal(after.status, "Partial", "a part payment is not a settled invoice");
  });

  test("with no gateway configured the endpoint says so rather than failing oddly", async () => {
    await saveSettings([
      { key: "api.sslcommerzStoreId", value: "" },
      { key: "api.sslcommerzStorePassword", value: "" },
    ]);
    const res = await post({ tran_id: "x", val_id: "y", amount: "1" });
    assert.equal(res.status, 501);

    await saveSettings([
      { key: "api.sslcommerzStoreId", value: "teststore" },
      { key: "api.sslcommerzStorePassword", value: "testpassword" },
    ]);
  });
});
