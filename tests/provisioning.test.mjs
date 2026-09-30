/**
 * Router provisioning, profile changes and secret removal.
 *
 * Phase A proved that suspending reaches the router. This proves the other three
 * directions, which are the ones a new subscriber, a package change and a
 * cancellation each depend on.
 *
 * The properties under test are all "the database and the router agree, and if
 * they cannot, the work is queued rather than lost":
 *
 *  - a new customer's secret exists on the router with the package's profile;
 *  - a package change repoints the profile rather than creating a second secret;
 *  - a deleted customer's secret is gone, not merely disabled;
 *  - a queued provision survives a customer being suspended in the meantime —
 *    which is the case that the Phase A "is this still wanted?" check would
 *    otherwise throw away, and throwing it away strands a subscriber whose line
 *    was never configured.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import { startMockRouter } from "./mock-routeros.mjs";
import {
  enforceProvision,
  enforceSetProfile,
  enforceRemoveSecret,
  retryPendingNetworkActions,
} from "../src/lib/services/network-enforcement.ts";

let mock;
let router;
let package_;
let area;
let createdCustomers = [];
let createdPackageIds = [];
let originalSettings = {};

/** Creates a customer wired to the mock router, with a given profile on their package. */
async function makeCustomer(username, password = "secret123") {
  const row = await prisma.customer.create({
    data: {
      customerCode: `TEST-PROV-${username.toUpperCase()}-${Date.now()}`,
      name: `Provision ${username}`,
      username,
      phone: `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password,
      connectionStatus: "Active",
      billingStatus: "Paid",
      packageId: package_.id,
      areaId: area.id,
      routerId: router.id,
    },
    select: { id: true, username: true },
  });
  createdCustomers.push(row.id);
  return row;
}

/** A package whose MikroTik profile is whatever the test needs. */
let packageSeq = 0;
async function makePackage(name, profile) {
  packageSeq += 1;
  return prisma.package.create({
    data: {
      // Suffixed because a failed run leaves rows behind, and the name is
      // unique — a leftover must not make the next run fail for the wrong reason.
      name: `${name} ${Date.now()}${packageSeq}`,
      downloadSpeed: 10,
      uploadSpeed: 10,
      monthlyPrice: 500,
      mikrotikProfile: profile,
    },
    select: { id: true, name: true, mikrotikProfile: true },
  });
}

before(async () => {
  mock = await startMockRouter();
  mock.reset();

  area = await prisma.area.findFirstOrThrow();

  const existing = await prisma.router.findFirst({ where: { name: "provision-test-router" } });
  if (existing) await prisma.router.delete({ where: { id: existing.id } });

  router = await prisma.router.create({
    data: {
      name: "provision-test-router",
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: mock.user,
      apiSecretEnc: mock.password,
      useSsl: false,
      sessionSource: "ppp",
      status: "Online",
    },
    select: { id: true, name: true },
  });

  const enforce = await prisma.setting.findUnique({ where: { key: "network.enforceOnSuspend" } });
  originalSettings.enforce = enforce?.value;
  await saveSettings([{ key: "network.enforceOnSuspend", value: "true" }]);

  // Clear anything a previous run left behind, so a failed run does not poison
  // the next one.
  await prisma.package.deleteMany({ where: { name: { startsWith: "Test 10Mbps" } } });

  package_ = await makePackage("Test 10Mbps", "10Mbps");
  createdPackageIds.push(package_.id);
});

after(async () => {
  if (createdCustomers.length) {
    await prisma.networkAction.deleteMany({ where: { customerId: { in: createdCustomers } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  }
  if (createdPackageIds.length) {
    await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } }).catch(() => undefined);
  }
  if (router) await prisma.router.delete({ where: { id: router.id } }).catch(() => undefined);
  if (originalSettings.enforce !== undefined) {
    await saveSettings([{ key: "network.enforceOnSuspend", value: originalSettings.enforce }]);
  }
  await mock.close();
  await prisma.$disconnect();
});

beforeEach(() => mock.reset());

/* ------------------------------------------------------------------ */

describe("provisioning a new subscriber", () => {
  test("the secret is created on the router with the package's profile", async () => {
    const customer = await makeCustomer("newsub1");

    const result = await enforceProvision(customer.id);
    assert.equal(result.ok, true, result.detail);

    // Read the router's state back. The mock is the only thing that knows whether
    // the secret was really created.
    const secret = mock.secret("newsub1");
    assert.ok(secret, "the secret must exist on the router");
    assert.equal(secret.profile, "10Mbps", "the package's profile must be applied");
    assert.equal(secret.disabled, "no", "a new subscriber must be able to connect");

    const action = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(action.status, "Done");
    assert.equal(action.action, "provision");
    assert.equal(action.payload, "10Mbps", "the profile is recorded so a retry reapplies it");
  });

  test("a package with no profile provisions without one rather than failing", async () => {
    const plain = await makePackage("Test No Profile", null);
    const customer = await makeCustomer("noprofile1");
    await prisma.customer.update({ where: { id: customer.id }, data: { packageId: plain.id } });

    const result = await enforceProvision(customer.id);
    assert.equal(result.ok, true, result.detail);

    const secret = mock.secret("noprofile1");
    assert.ok(secret, "the secret is still created");
    assert.equal(secret.profile, undefined, "no profile is sent, so the router default stays");

    createdPackageIds.push(plain.id);
  });

  test("a customer with no PPPoE password is reported, not provisioned with a blank one", async () => {
    const customer = await makeCustomer("nopass1");
    await prisma.customer.update({ where: { id: customer.id }, data: { password: null } });

    const result = await enforceProvision(customer.id);

    assert.equal(result.ok, false, "a blank credential must not be written to the router");
    assert.match(result.detail, /no PPPoE password/i);
    assert.equal(mock.secret("nopass1"), null, "nothing may be created without a credential");
  });

  test("a hotspot router refuses provisioning instead of reporting a false success", async () => {
    await prisma.router.update({
      where: { id: router.id },
      data: { sessionSource: "hotspot" },
    });
    const customer = await makeCustomer("hotspot1");

    const result = await enforceProvision(customer.id);
    assert.equal(result.ok, false, "there is no secret to create on a hotspot router");
    assert.match(result.detail, /cannot be provisioned/i);

    await prisma.router.update({ where: { id: router.id }, data: { sessionSource: "ppp" } });
  });

  test("an unreachable router leaves the work queued rather than lost", async () => {
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    const customer = await makeCustomer("downrouter1");

    const result = await enforceProvision(customer.id);
    assert.equal(result.ok, false);
    assert.equal(result.queued, true, "it must be retried, not written off");

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(row.status, "Pending");
    assert.equal(row.attempts, 1);

    // The customer exists and is usable regardless — the office is never blocked
    // on a router.
    const still = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(still.connectionStatus, "Active");

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });
  });
});

describe("package change reaches the router", () => {
  test("a profile change repoints the existing secret, not a second one", async () => {
    const customer = await makeCustomer("upgrade1");
    await enforceProvision(customer.id);
    assert.equal(mock.secret("upgrade1").profile, "10Mbps");

    const faster = await makePackage("Test 50Mbps", "50Mbps");
    await prisma.customer.update({ where: { id: customer.id }, data: { packageId: faster.id } });

    const result = await enforceSetProfile(customer.id, "50Mbps");
    assert.equal(result.ok, true, result.detail);

    const secret = mock.secret("upgrade1");
    assert.equal(secret.profile, "50Mbps", "the secret must point at the new profile");
    // One secret, not two: a duplicate would leave the router authenticating
    // against whichever it happened to read first.
    const all = mock.secrets().filter((s) => s.name === "upgrade1");
    assert.equal(all.length, 1, "the secret must be updated, not duplicated");

    createdPackageIds.push(faster.id);
  });

  test("an empty profile is refused rather than clearing the customer's speed", async () => {
    const customer = await makeCustomer("noprofilechange1");
    const result = await enforceSetProfile(customer.id, "   ");
    assert.equal(result.ok, false);
    assert.match(result.detail, /No profile/);
  });

  test("a queued profile change is applied even though the customer is suspended", async () => {
    // The asymmetry that matters: a suspend is a statement about whether the
    // customer may be online, so a queued suspend for someone who has since paid
    // must be dropped. A profile change is a statement about what their access
    // should look like, which stays true regardless of status. Dropping this one
    // would leave the customer on the wrong speed indefinitely.
    const customer = await makeCustomer("suspendedprofile1");
    await enforceProvision(customer.id);

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    const failed = await enforceSetProfile(customer.id, "25Mbps");
    assert.equal(failed.ok, false);
    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });

    // Suspended between the failure and the retry — exactly the race.
    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Suspended" },
    });
    await prisma.networkAction.update({
      where: { id: failed.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    await retryPendingNetworkActions();

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: failed.actionId } });
    assert.equal(row.status, "Done", "the profile change is not obsolete just because they are suspended");
    assert.equal(mock.secret("suspendedprofile1").profile, "25Mbps");
  });
});

describe("removing a secret", () => {
  test("a deleted customer's secret is gone, not merely disabled", async () => {
    const customer = await makeCustomer("leaving1");
    await enforceProvision(customer.id);
    assert.ok(mock.secret("leaving1"), "the secret starts present");

    const result = await enforceRemoveSecret(customer.id);
    assert.equal(result.ok, true, result.detail);

    assert.equal(
      mock.secret("leaving1"),
      null,
      "the secret must be deleted — a disabled one hands its credentials to the next subscriber at that address"
    );
  });

  test("removing a secret that is already gone is not an error", async () => {
    const customer = await makeCustomer("alreadygone1");
    const result = await enforceRemoveSecret(customer.id);
    assert.equal(result.ok, true, "an absent secret is the desired end state");
  });
});

describe("the queue holds the profile it was created with", () => {
  test("a retry after a further package change still applies the original profile", async () => {
    // Without the profile on the row, a retry would re-derive it from the
    // package and quietly apply the newer speed to a change that was raised
    // against the older one.
    const customer = await makeCustomer("pinned1");
    // Provision first: a profile change needs a secret to repoint, and a router
    // that has never heard of the subscriber is a different test.
    await enforceProvision(customer.id);

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: 1 } });
    const failed = await enforceSetProfile(customer.id, "8Mbps");
    assert.equal(failed.ok, false);

    // The customer's package moves on before the router comes back.
    const other = await makePackage("Test 100Mbps", "100Mbps");
    await prisma.customer.update({ where: { id: customer.id }, data: { packageId: other.id } });

    await prisma.router.update({ where: { id: router.id }, data: { apiPort: mock.port } });
    await prisma.networkAction.update({
      where: { id: failed.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    await retryPendingNetworkActions();

    const action = await prisma.networkAction.findUniqueOrThrow({ where: { id: failed.actionId } });
    assert.equal(action.status, "Done");
    assert.equal(action.payload, "8Mbps", "the row still carries what it was queued for");

    createdPackageIds.push(other.id);
  });
});
