/**
 * The per-router auto-provisioning gate.
 *
 * Without it, installing this system and typing a router's API password was
 * enough to start creating, reprofiling and deleting PPP secrets on hardware
 * nobody had agreed the app should touch. `Router.autoProvision` is the
 * capability grant that makes that an explicit decision, one router at a time.
 *
 * The property being defended is not "nothing is written" — it is that *the
 * three secret-writing actions stop and suspension does not*. A gate that also
 * blocked suspension would be worse than no gate: a customer the office has cut
 * off would keep browsing because nobody remembered a checkbox.
 *
 * Every check asserts on the mock router's end state and on the absence of a
 * queue row. A skipped action that still wrote a `NetworkAction` would be
 * retried forever, so "no call was made" alone is not enough.
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
  enforceRemoveSecretByUsername,
  enforceSuspend,
} from "../src/lib/services/network-enforcement.ts";
import { enforceFup } from "../src/lib/services/cron.ts";

let mock;
let router;
let areaId;
let createdCustomers = [];
let createdPackages = [];
let originalSettings = {};

const GB = 1024 ** 3;
const gb = (n) => BigInt(Math.round(n * GB));

/** A customer on a package that has both a normal and a throttled profile. */
async function makeCustomer(username, pkg) {
  const customer = await prisma.customer.create({
    data: {
      customerCode: `TEST-GATE-${username.toUpperCase()}-${Date.now()}`,
      name: `Gate ${username}`,
      username,
      phone: `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password: "secret123",
      connectionStatus: "Active",
      billingStatus: "Paid",
      packageId: pkg.id,
      areaId: areaId,
      routerId: router.id,
    },
    select: { id: true, username: true },
  });
  createdCustomers.push(customer.id);
  return customer;
}

/** A package with a normal profile and a throttled one, for the FUP check. */
async function makePackage(name, extra = {}) {
  const row = await prisma.package.create({
    data: {
      name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      downloadSpeed: 20,
      uploadSpeed: 20,
      monthlyPrice: 800,
      ...extra,
    },
    select: { id: true },
  });
  createdPackages.push(row.id);
  return row;
}

async function addSession(customerId, loginTime, bytes) {
  await prisma.onlineSession.create({
    data: {
      customerId,
      username: "gate",
      loginTime,
      logoutTime: new Date(loginTime.getTime() + 3600_000),
      downloadBytes: bytes,
      uploadBytes: 0n,
    },
  });
}

/** Puts a secret on the router directly, so "was it touched?" is answerable. */
async function seedSecret(username, profile) {
  // The mock is the source of truth; give it a secret the way the router would.
  const res = await fetch(`http://127.0.0.1:${mock.port}/rest/ppp/secret`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${mock.user}:${mock.password}`).toString("base64")}`,
    },
    body: JSON.stringify({ name: username, password: "x", profile, disabled: "no" }),
  });
  assert.ok(res.ok, `seeding the secret failed: ${res.status}`);
}

before(async () => {
  mock = await startMockRouter();
  mock.reset();

  areaId = (await prisma.area.findFirstOrThrow()).id;

  const existing = await prisma.router.findFirst({ where: { name: "gate-test-router" } });
  if (existing) await prisma.router.delete({ where: { id: existing.id } });

  // Left at the schema default on purpose — the whole point is that off is off.
  router = await prisma.router.create({
    data: {
      name: "gate-test-router",
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: mock.user,
      apiSecretEnc: mock.password,
      useSsl: false,
      sessionSource: "ppp",
    },
    select: { id: true, name: true },
  });
  assert.equal(
    (await prisma.router.findUniqueOrThrow({ where: { id: router.id } })).autoProvision,
    false,
    "the flag must default to off"
  );

  for (const key of ["network.enforceOnSuspend", "network.fupAction"]) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originalSettings[key] = row?.value ?? "";
  }
  await saveSettings([
    { key: "network.enforceOnSuspend", value: "true" },
    { key: "network.fupAction", value: "throttle" },
  ]);
});

after(async () => {
  if (createdCustomers.length) {
    await prisma.networkAction.deleteMany({ where: { customerId: { in: createdCustomers } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  }
  if (createdPackages.length) {
    await prisma.package.deleteMany({ where: { id: { in: createdPackages } } });
  }
  if (router) await prisma.router.delete({ where: { id: router.id } }).catch(() => undefined);
  for (const [key, value] of Object.entries(originalSettings)) {
    await saveSettings([{ key, value }]);
  }
  await mock.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  mock.reset();
  await prisma.networkAction.deleteMany({ where: { routerId: router.id } });
  // Every test in this file is about the flag being off.
  await prisma.router.update({ where: { id: router.id }, data: { autoProvision: false } });
});

/* ------------------------------------------------------------------ */

describe("with auto-provisioning off", () => {
  const pkg = async () =>
    makePackage("GatePkg", { fupLimit: 50, fupProfile: "2Mbps", mikrotikProfile: "20Mbps" });

  test("a new customer gets no secret, and no queue row either", async () => {
    const c = await makeCustomer("newcust", await pkg());

    const result = await enforceProvision(c.id);

    assert.equal(result.ok, true, "not a failure — nothing was wanted");
    assert.equal(result.skipped, true, "it must be reported as skipped, not applied");
    assert.match(result.detail, /Auto-provisioning is off/i);
    assert.equal(result.actionId, undefined, "a skipped action must not be queued for retry");
    assert.equal(mock.secret("newcust"), null, "the router must not have been called at all");
    assert.equal(mock.calls().length, 0, "not one request may reach the router");

    const rows = await prisma.networkAction.count({ where: { customerId: c.id } });
    assert.equal(rows, 0, "a skipped action must leave nothing pending, or it retries forever");
  });

  test("a package change does not touch the profile", async () => {
    const c = await makeCustomer("pkgchange", await pkg());
    await seedSecret("pkgchange", "20Mbps");
    const before = mock.calls().length;

    const result = await enforceSetProfile(c.id, "50Mbps");

    assert.equal(result.skipped, true);
    assert.equal(mock.calls().length, before, "the router must not be written to");
    assert.equal(mock.secret("pkgchange").profile, "20Mbps", "the profile is unchanged");
    assert.equal(await prisma.networkAction.count({ where: { customerId: c.id } }), 0);
  });

  test("deleting a customer does not remove the secret", async () => {
    const c = await makeCustomer("delcust", await pkg());
    await seedSecret("delcust", "20Mbps");
    const before = mock.calls().length;

    // Both paths: the customer-routed one, and the username one that the delete
    // action actually uses. The second matters more — it runs for a customer who
    // no longer exists, so nothing else would stop it.
    const viaCustomer = await enforceRemoveSecret(c.id);
    const viaUsername = await enforceRemoveSecretByUsername("delcust", router.id);

    for (const result of [viaCustomer, viaUsername]) {
      assert.equal(result.skipped, true, result.detail);
      assert.match(result.detail, /Auto-provisioning is off/i);
    }
    assert.equal(mock.calls().length, before, "the router must not be written to");
    assert.equal(mock.secret("delcust").profile, "20Mbps", "the secret survives");
    assert.equal(await prisma.networkAction.count({ where: { customerId: c.id } }), 0);
    assert.equal(
      await prisma.networkAction.count({ where: { routerId: router.id, action: "removeSecret" } }),
      0,
      "the username path must not queue a removal either"
    );
  });

  test("suspending still works — the gate does not apply to it", async () => {
    // This is the asymmetry that matters. Suspension is a billing decision, and
    // gating it would mean a customer the office cut off keeps browsing because
    // nobody remembered a checkbox.
    const c = await makeCustomer("suspgate", await pkg());
    await seedSecret("suspgate", "20Mbps");
    const before = mock.calls().length;

    const result = await enforceSuspend(c.id);

    assert.equal(result.ok, true, result.detail);
    assert.equal(result.skipped, undefined, "suspend must not be skipped by this gate");
    assert.ok(mock.calls().length > before, "the router must actually have been called");
    assert.equal(
      mock.secret("suspgate").disabled,
      "yes",
      "a suspended customer must be locked out even with auto-provisioning off"
    );
  });

  test("a FUP throttle is skipped and the customer is not marked throttled", async () => {
    // The interaction that needed fixing: enforceSetProfile now reports "skipped"
    // for an opted-out router, and treating that as applied would set
    // fupThrottled on a customer the router never touched — and then suppress
    // every future attempt.
    const c = await makeCustomer("fupgate", await pkg());
    const from = new Date("2026-05-01T00:00:00Z");
    const to = new Date("2026-05-31T00:00:00Z");

    await prisma.invoice.create({
      data: {
        invoiceNumber: `GATE-INV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        customerId: c.id,
        issueDate: from,
        dueDate: to,
        billingFrom: from,
        billingTo: to,
        amount: 800,
        total: 800,
        paid: 800,
        status: "Paid",
      },
    });
    await seedSecret("fupgate", "20Mbps");
    await addSession(c.id, new Date("2026-05-20T10:00:00Z"), gb(60));
    const before = mock.calls().length;

    const result = await enforceFup();

    assert.equal(mock.calls().length, before, "the router must not be written to");
    assert.equal(mock.secret("fupgate").profile, "20Mbps", "the profile is unchanged");
    assert.match(result.note ?? "", /throttle skipped/i, "the ISP must be told it was skipped");

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(
      row.fupThrottled,
      false,
      "a throttle that never happened must not be recorded as one, or no future run retries it"
    );
    assert.equal(row.fupThrottledAt, null);
  });
});

describe("with auto-provisioning on", () => {
  test("a new customer is provisioned again", async () => {
    await prisma.router.update({ where: { id: router.id }, data: { autoProvision: true } });
    const c = await makeCustomer("oncust", await makePackage("GateOn", { mikrotikProfile: "20Mbps" }));

    const result = await enforceProvision(c.id);

    assert.equal(result.ok, true, result.detail);
    assert.ok(mock.secret("oncust"), "the secret must be created once the router is opted in");
  });
});
