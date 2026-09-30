/**
 * What happens to the network and the equipment when a customer is deleted.
 *
 * These three checks exist because both of the paths they cover were broken in a
 * way the earlier tests could not see.
 *
 * The router removal test was previously written as "provision, then call
 * `enforceRemoveSecret` on a customer who still exists". That passes, and it
 * proves nothing: the real flow deletes the customer row *first* and asks the
 * router second, so a path that looks the customer up to find the router finds
 * nothing and the secret is never removed. The result was a live PPPoE secret for
 * a departed subscriber — free service, invisible in the system. So this file
 * drives the real order, and the mock router's end state is the assertion.
 *
 * The equipment check is the same shape of mistake. `CustomerEquipment.customer`
 * cascades, so a deleted customer takes the assignment rows with it and the only
 * record that a device left the storeroom disappears with them.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import { startMockRouter } from "./mock-routeros.mjs";
import {
  enforceProvision,
  enforceRemoveSecretByUsername,
  retryPendingNetworkActions,
} from "../src/lib/services/network-enforcement.ts";
import { deleteCustomer } from "../src/lib/services/customers.ts";
import { createItem, recordMovement, assignEquipment } from "../src/lib/services/inventory.ts";

let mock;
let router;
let adminId;
let originalSettings = {};

/** Customer + package fixtures, torn down after each test. */
const created = { customers: [], packages: [], items: [] };

async function makeCustomer(username) {
  const pkg = await prisma.package.create({
    data: {
      name: `DelTest ${username} ${Date.now()}`,
      downloadSpeed: 10,
      uploadSpeed: 10,
      monthlyPrice: 500,
      mikrotikProfile: "10Mbps",
    },
    select: { id: true },
  });
  created.packages.push(pkg.id);

  const customer = await prisma.customer.create({
    data: {
      customerCode: `TEST-DEL-${username.toUpperCase()}-${Date.now()}`,
      name: `Delete ${username}`,
      username,
      phone: `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password: "secret123",
      connectionStatus: "Active",
      billingStatus: "Paid",
      packageId: pkg.id,
      routerId: router.id,
    },
    select: { id: true, username: true, routerId: true },
  });
  created.customers.push(customer.id);
  return customer;
}

before(async () => {
  mock = await startMockRouter();
  mock.reset();

  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@isp.com" } })).id;

  const existing = await prisma.router.findFirst({ where: { name: "delete-test-router" } });
  if (existing) await prisma.router.delete({ where: { id: existing.id } });

  router = await prisma.router.create({
    data: {
      name: "delete-test-router",
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: mock.user,
      apiSecretEnc: mock.password,
      useSsl: false,
      sessionSource: "ppp",
      // Opted in: these tests are about what provisioning does once a router has
      // agreed to it. The gate itself is covered in autoprovision-gate.test.mjs.
      autoProvision: true,
      status: "Online",
    },
    select: { id: true, name: true },
  });

  const enforce = await prisma.setting.findUnique({ where: { key: "network.enforceOnSuspend" } });
  originalSettings.enforce = enforce?.value;
  await saveSettings([{ key: "network.enforceOnSuspend", value: "true" }]);
});

after(async () => {
  if (created.customers.length) {
    await prisma.networkAction.deleteMany({ where: { customerId: { in: created.customers } } });
    await prisma.customerEquipment.deleteMany({ where: { customerId: { in: created.customers } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  // Removals queued against a deleted customer have no customerId, so they are
  // cleared by router rather than by customer.
  await prisma.networkAction.deleteMany({ where: { routerId: router.id, action: "removeSecret" } });
  if (created.items.length) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: created.items } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: created.items } } });
  }
  if (created.packages.length) {
    await prisma.package.deleteMany({ where: { id: { in: created.packages } } });
  }
  if (router) await prisma.router.delete({ where: { id: router.id } }).catch(() => undefined);
  if (originalSettings.enforce !== undefined) {
    await saveSettings([{ key: "network.enforceOnSuspend", value: originalSettings.enforce }]);
  }
  await mock.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  mock.reset();
  // The unreachable-router test points the row at a dead port, so the port is
  // restored here rather than trusting each test to put it back — otherwise one
  // test's setup silently becomes the next test's starting state.
  await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });
});

/* ------------------------------------------------------------------ */

describe("deleting a customer reaches the router", () => {
  test("the secret is removed even though the customer row is already gone", async () => {
    const customer = await makeCustomer("leaver1");
    await enforceProvision(customer.id);

    // Assert it is on the router first, so a later "not there" cannot be a
    // false pass from a provision that never happened.
    assert.ok(mock.secret("leaver1"), "the secret must exist before the delete");

    // The real order: the row goes first.
    await deleteCustomer(customer.id, adminId);
    assert.equal(
      await prisma.customer.findUnique({ where: { id: customer.id } }),
      null,
      "the customer row must actually be gone — this is the whole point of the test"
    );

    const result = await enforceRemoveSecretByUsername("leaver1", customer.routerId, adminId);

    assert.equal(result.ok, true, result.detail);
    assert.equal(
      mock.secret("leaver1"),
      null,
      "the secret must be gone from the router, not merely disabled"
    );
  });

  test("an unreachable router queues the removal with no customer attached", async () => {
    const customer = await makeCustomer("leaver2");
    await enforceProvision(customer.id);
    assert.ok(mock.secret("leaver2"));

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    await deleteCustomer(customer.id, adminId);

    const result = await enforceRemoveSecretByUsername("leaver2", customer.routerId, adminId);

    assert.equal(result.ok, false, "an unreachable router cannot be reported as done");
    assert.equal(result.queued, true, "the removal must be retried, not written off");

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(row.status, "Pending");
    assert.equal(row.action, "removeSecret");
    assert.equal(row.customerId, null, "there is no customer to point at any more");
    assert.equal(row.username, "leaver2", "the username is the only identity the router knows");
    assert.equal(row.routerId, router.id);
  });

  test("the retry carries out a removal whose customer is gone", async () => {
    const customer = await makeCustomer("leaver3");
    await enforceProvision(customer.id);
    assert.ok(mock.secret("leaver3"));

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    await deleteCustomer(customer.id, adminId);
    const failed = await enforceRemoveSecretByUsername("leaver3", customer.routerId, adminId);
    assert.equal(failed.ok, false);

    // Router comes back; the queue entry must clear the backoff.
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });
    await prisma.networkAction.update({
      where: { id: failed.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    const stats = await retryPendingNetworkActions();
    assert.ok(stats.done >= 1, "the queued removal should have completed");

    assert.equal(
      mock.secret("leaver3"),
      null,
      "the retry must actually reach the router — writing the row off would leave a free line"
    );
    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: failed.actionId } });
    assert.equal(row.status, "Done");
  });

  test("a customer with no router is reported plainly, not as a failure", async () => {
    const result = await enforceRemoveSecretByUsername("orphanuser", null, adminId);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.detail, /no router/i);
  });
});

describe("deleting a customer returns the equipment", () => {
  test("an assigned device goes back on the shelf instead of vanishing", async () => {
    const customer = await makeCustomer("returns1");

    const item = await createItem({
      name: "Test ONU for delete",
      sku: `DEL-ONU-${Date.now()}`,
      category: "ONU",
      unit: "pcs",
      reorderLevel: 0,
      userId: adminId,
    });
    created.items.push(item.id);
    await recordMovement({ itemId: item.id, type: "IN", quantity: 5, userId: adminId });

    const serial = `DEL-SN-${Date.now()}`;
    await assignEquipment({ customerId: customer.id, itemId: item.id, serial, userId: adminId });

    const afterIssue = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity;
    assert.equal(afterIssue, 4, "the device left the shelf when it was issued");

    await deleteCustomer(customer.id, adminId);

    const afterDelete = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity;
    assert.equal(afterDelete, 5, "the device must be back on the shelf, not lost with the customer");

    // The stock movement is what survives the delete, and it carries the serial
    // and the reason — so the ledger can still answer "what was ZTE1G-999001 and
    // when did it come back".
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: item.id, reference: serial },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(movement.quantity, 1, "the return is a stock-in of one");
    assert.match(movement.note, /customer deletion/i);

    // The assignment row itself cascades with the customer, because
    // `CustomerEquipment.customer` is onDelete: Cascade. The stock and the
    // ledger are restored; the customer link is not, and cannot be — the
    // customer it pointed at no longer exists.
    assert.equal(
      await prisma.customerEquipment.findUnique({ where: { serial } }),
      null,
      "the assignment row cascades with the customer; the ledger is the surviving record"
    );
  });

  test("a customer with no equipment deletes without fuss", async () => {
    const customer = await makeCustomer("noequip1");
    await assert.doesNotReject(() => deleteCustomer(customer.id, adminId));
    assert.equal(await prisma.customer.findUnique({ where: { id: customer.id } }), null);
  });

  test("only assigned devices are returned — one already returned is left alone", async () => {
    const customer = await makeCustomer("mixed1");

    const item = await createItem({
      name: "Test ONU mixed",
      sku: `DEL-MIX-${Date.now()}`,
      category: "ONU",
      userId: adminId,
    });
    created.items.push(item.id);
    await recordMovement({ itemId: item.id, type: "IN", quantity: 4, userId: adminId });

    const live = `MIX-A-${Date.now()}`;
    const gone = `MIX-B-${Date.now()}`;
    await assignEquipment({ customerId: customer.id, itemId: item.id, serial: live, userId: adminId });
    await assignEquipment({ customerId: customer.id, itemId: item.id, serial: gone, userId: adminId });

    // The second one was already handed back and written off.
    const fault = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial: gone } });
    await prisma.customerEquipment.update({
      where: { id: fault.id },
      data: { status: "Faulty", returnedAt: new Date() },
    });

    const before = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity;
    assert.equal(before, 2);

    await deleteCustomer(customer.id, adminId);

    const after = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity;
    assert.equal(after, 3, "exactly the one live device comes back; the written-off one stays off");

    // The write-off is not undone: a faulty device is off the shelf and stays
    // off. Only the one live device came back.
    //
    // Both an issue and a return carry the serial as their reference, so the
    // sign is what distinguishes them.
    const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id } });
    const credit = (serial) =>
      movements.filter((m) => m.reference === serial && m.quantity > 0).length;

    assert.equal(credit(gone), 0, "a device already written off must not be credited back to stock");
    assert.equal(credit(live), 1, "the live device's return is on the ledger");
  });
});
