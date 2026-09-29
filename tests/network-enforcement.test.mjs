/**
 * Billing enforcement that reaches the network.
 *
 * This is the test for the most expensive bug an ISP billing system can have: a
 * customer the report calls "Suspended" who is still streaming. Every check here
 * reads the router's end state back off the mock rather than trusting the value
 * the function returned, and reads the database back independently, because the
 * failure mode this guards against is a function that reports success while
 * changing nothing.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { startMockRouter } from "./mock-routeros.mjs";
import { RouterOsClient } from "../src/lib/services/routeros.ts";
import { adapterForRouter } from "../src/lib/services/network-adapter.ts";
import {
  enforceSuspend,
  enforceReconnect,
  retryPendingNetworkActions,
  pendingEnforcementCount,
  maybeAutoReconnect,
} from "../src/lib/services/network-enforcement.ts";
import { saveSettings } from "../src/lib/settings.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let mock;
let router; // the Router row, pointed at the mock
let package_;
let area;
let onlineCustomer; // username "rahim100" — has a live session on the mock
let offlineCustomer; // username "offline300" — has a secret, no session
let created = [];
let originalSettings = {};

/** Sets one setting through the real writer, so the cache is invalidated. */
const setSetting = (key, value) => saveSettings([{ key, value }]);

/** Creates a customer wired to the mock router. */
async function makeCustomer(username) {
  const row = await prisma.customer.create({
    data: {
      customerCode: `TEST-${username.toUpperCase()}`,
      name: `Test ${username}`,
      username,
      phone: "01700000000",
      password: username,
      connectionStatus: "Active",
      billingStatus: "Paid",
      monthlyBill: 500,
      totalPayable: 500,
      packageId: package_.id,
      areaId: area.id,
      routerId: router.id,
    },
    select: { id: true, username: true, connectionStatus: true },
  });
  created.push(row.id);
  return row;
}

before(async () => {
  mock = await startMockRouter();
  mock.reset();

  package_ = await prisma.package.findFirstOrThrow();
  area = await prisma.area.findFirstOrThrow();

  const existing = await prisma.router.findFirst({ where: { name: "enforcement-test-router" } });
  if (existing) await prisma.router.delete({ where: { id: existing.id } });

  router = await prisma.router.create({
    data: {
      name: "enforcement-test-router",
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: mock.user,
      apiSecretEnc: mock.password,
      useSsl: false,
      sessionSource: "ppp",
      status: "Online",
    },
    select: { id: true, name: true, ipAddress: true, apiPort: true },
  });

  const enforce = await prisma.setting.findUnique({ where: { key: "network.enforceOnSuspend" } });
  const auto = await prisma.setting.findUnique({ where: { key: "billing.autoReconnect" } });
  originalSettings = {
    enforce: enforce?.value,
    auto: auto?.value,
  };
  await setSetting("network.enforceOnSuspend", "true");
  await setSetting("billing.autoReconnect", "true");

  onlineCustomer = await makeCustomer("rahim100");
  offlineCustomer = await makeCustomer("offline300");
});

after(async () => {
  if (created.length) {
    await prisma.networkAction.deleteMany({ where: { customerId: { in: created } } });
    await prisma.customer.deleteMany({ where: { id: { in: created } } });
  }
  if (router) await prisma.router.delete({ where: { id: router.id } }).catch(() => undefined);
  if (originalSettings.enforce !== undefined) {
    await setSetting("network.enforceOnSuspend", originalSettings.enforce);
  }
  if (originalSettings.auto !== undefined) {
    await setSetting("billing.autoReconnect", originalSettings.auto);
  }
  await mock.close();
  await prisma.$disconnect();
});

beforeEach(() => mock.reset());

/* ------------------------------------------------------------------ */
/* The tests                                                           */
/* ------------------------------------------------------------------ */

describe("router enforcement", () => {
  test("suspending disables the PPP secret and kicks the live session", async () => {
    const result = await enforceSuspend(onlineCustomer.id);

    assert.equal(result.ok, true, result.detail);
    assert.equal(mock.secret("rahim100").disabled, "yes", "the secret must be disabled");

    // A live session must actually be dropped, not just prevented next time.
    const deletes = mock.calls().filter((c) => c.method === "DELETE" && c.path.startsWith("/ppp/active/"));
    assert.ok(deletes.length >= 1, "the live session should have been kicked");

    const action = await prisma.networkAction.findUniqueOrThrow({
      where: { id: result.actionId },
    });
    assert.equal(action.status, "Done");
    assert.equal(action.action, "suspend");
  });

  test("suspending a customer who is offline still disables them, with no error", async () => {
    // The case the old `block()` could not handle: no session, so no IP, so
    // nothing to block. The secret is the enforcement point.
    const result = await enforceSuspend(offlineCustomer.id);

    assert.equal(result.ok, true, result.detail);
    assert.equal(
      mock.secret("offline300").disabled,
      "yes",
      "an offline customer must still be locked out of the next login"
    );
  });

  test("the database is left correct even when the router is unreachable", async () => {
    // Point the customer at a port nothing is listening on.
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });

    const result = await enforceSuspend(onlineCustomer.id);

    // The suspension stands regardless — the office's decision is not hostage
    // to a router.
    await prisma.customer.update({
      where: { id: onlineCustomer.id },
      data: { connectionStatus: "Suspended", suspendReason: "test" },
    });

    assert.equal(result.ok, false, "an unreachable router must not report success");
    assert.equal(result.queued, true, "the action must be queued for retry");
    assert.ok(result.actionId, "a queued action id must be returned");

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    // Pending, not Failed: a failed row is terminal and the retry job would
    // never look at it, so the customer would stay online forever.
    assert.equal(row.status, "Pending");
    assert.ok(row.lastError, "the reason must be recorded");
    assert.equal(row.attempts, 1, "the attempt must be counted, for the backoff ladder");
    assert.ok(
      await pendingEnforcementCount() > 0,
      "the operator must be able to see work is waiting"
    );

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });
  });

  test("a queued action is completed by the retry job once the router is back", async () => {
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    const failed = await enforceSuspend(offlineCustomer.id);
    assert.equal(failed.ok, false);
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });

    // The customer is still Suspended in the database, so the suspend is still
    // wanted and the retry should carry it out.
    await prisma.customer.update({
      where: { id: offlineCustomer.id },
      data: { connectionStatus: "Suspended" },
    });
    // Clear the backoff the failure just set, so the retry is due now.
    await prisma.networkAction.update({
      where: { id: failed.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    const stats = await retryPendingNetworkActions();
    assert.ok(stats.retried >= 1, "the queued action should have been picked up");
    assert.ok(stats.done >= 1, "it should have completed");

    assert.equal(
      mock.secret("offline300").disabled,
      "yes",
      "the retry must actually reach the router"
    );
    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: failed.actionId } });
    assert.equal(row.status, "Done");
  });

  test("reconnecting re-enables the secret", async () => {
    await enforceSuspend(onlineCustomer.id);
    assert.equal(mock.secret("rahim100").disabled, "yes");

    const result = await enforceReconnect(onlineCustomer.id);
    assert.equal(result.ok, true, result.detail);
    assert.equal(mock.secret("rahim100").disabled, "no", "the secret must be usable again");
  });

  test("a queued suspend is abandoned when the customer has since been reactivated", async () => {
    // This is the dangerous case: an old suspend action sitting in the queue,
    // executed after the customer paid. Disabling the secret here would cut off
    // somebody who owes nothing.
    const row = await prisma.networkAction.create({
      data: {
        customerId: onlineCustomer.id,
        routerId: router.id,
        username: "rahim100",
        action: "suspend",
        status: "Pending",
        // Two failures in, so the backoff ladder is 15 minutes and the row's age
        // makes it due — and well under the cap, so it is not written off.
        attempts: 2,
        updatedAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    await prisma.customer.update({
      where: { id: onlineCustomer.id },
      data: { connectionStatus: "Active" },
    });
    mock.reset();

    await retryPendingNetworkActions();

    const after = await prisma.networkAction.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "Done", "the obsolete action should be closed, not executed");
    assert.equal(
      mock.secret("rahim100").disabled,
      "no",
      "a paying customer must never be cut off by a stale queued action"
    );
  });

  test("enforcement off means the database changes and the router is not touched", async () => {
    await setSetting("network.enforceOnSuspend", "false");
    mock.reset();

    const result = await enforceSuspend(onlineCustomer.id);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true, "it must be reported as skipped, not done");
    assert.match(result.detail, /Settings/);
    assert.equal(
      mock.calls().length,
      0,
      "no router call should be made while enforcement is off"
    );

    await setSetting("network.enforceOnSuspend", "true");
  });

  test("a customer with no router is reported plainly, not as a failure", async () => {
    const orphan = await prisma.customer.create({
      data: {
        customerCode: `TEST-ORPHAN-${Date.now()}`,
        name: "No Router",
        username: `orphan${Date.now()}`,
        phone: "01700000000",
        password: "orphan",
        connectionStatus: "Active",
      },
      select: { id: true },
    });
    created.push(orphan.id);

    const result = await enforceSuspend(orphan.id);
    assert.equal(result.ok, true, "this is not an error — there is simply nothing to enforce");
    assert.equal(result.skipped, true);
    assert.match(result.detail, /no router/i);
  });
});

/* ------------------------------------------------------------------ */
/* Auto-reconnect on payment                                           */
/* ------------------------------------------------------------------ */

describe("auto-reconnect after payment", () => {
  test("a suspended customer who clears their dues comes back up on their own", async () => {
    await prisma.customer.update({
      where: { id: offlineCustomer.id },
      data: { connectionStatus: "Suspended", suspendReason: "unpaid" },
    });
    await enforceSuspend(offlineCustomer.id);
    assert.equal(mock.secret("offline300").disabled, "yes");

    // An outstanding invoice, then a payment that settles it.
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `TEST-INV-${Date.now()}`,
        customerId: offlineCustomer.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
        total: 500,
        paid: 0,
        status: "Due",
      },
      select: { id: true },
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paid: 500, status: "Paid" },
    });

    const result = await maybeAutoReconnect(offlineCustomer.id);

    assert.ok(result, "a suspended customer with dues cleared must be acted on");
    assert.equal(result.ok, true, result?.detail);
    assert.equal(mock.secret("offline300").disabled, "no", "the line must come back by itself");

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: offlineCustomer.id } });
    assert.equal(row.connectionStatus, "Active");
    assert.equal(row.suspendReason, null);

    await prisma.invoice.delete({ where: { id: invoice.id } });
  });

  test("a customer who still owes money stays suspended", async () => {
    await prisma.customer.update({
      where: { id: onlineCustomer.id },
      data: { connectionStatus: "Suspended", suspendReason: "unpaid" },
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `TEST-INV2-${Date.now()}`,
        customerId: onlineCustomer.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
        total: 500,
        paid: 0,
        status: "Due",
      },
      select: { id: true },
    });

    const result = await maybeAutoReconnect(onlineCustomer.id);

    assert.ok(result, "the decision must be reported, not silently skipped");
    assert.equal(result.ok, false, "a customer with dues outstanding stays cut off");
    assert.match(result.detail, /Still owes/);

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: onlineCustomer.id } });
    assert.equal(row.connectionStatus, "Suspended", "they must not be reconnected");

    await prisma.invoice.delete({ where: { id: invoice.id } });
  });

  test("an active customer is left alone", async () => {
    await prisma.customer.update({
      where: { id: onlineCustomer.id },
      data: { connectionStatus: "Active" },
    });
    const result = await maybeAutoReconnect(onlineCustomer.id);
    assert.equal(result, null, "there is nothing to do for an active customer");
  });
});

/* ------------------------------------------------------------------ */
/* The client itself                                                   */
/* ------------------------------------------------------------------ */

describe("RouterOS PPP secret control", () => {
  test("a missing secret is an error, not a silent success", async () => {
    const client = new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: mock.user,
      password: mock.password,
    });

    await assert.rejects(
      () => client.setSecretDisabled("nobody-here", true),
      /no PPP secret/,
      "a subscriber with no secret must not be reported as suspended"
    );
  });

  test("the adapter refuses to pretend a hotspot user was cut off", async () => {
    // Hotspot has no secret, so an offline user genuinely cannot be blocked.
    // The honest thing is to fail loudly so the action is queued, rather than
    // return true and let a customer keep using the internet unpaid.
    const client = new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: mock.user,
      password: mock.password,
    });
    const adapter = adapterForRouter({
      id: router.id,
      name: router.name,
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: mock.user,
      apiSecret: mock.password,
      useSsl: false,
      sessionSource: "hotspot",
    });

    await assert.rejects(
      () => adapter.setAccess("not-online-right-now", false),
      /not connected/,
      "a hotspot user with no address cannot be blocked, and that must be said"
    );
    void client;
  });
});
