/**
 * FUP enforcement.
 *
 * These checks drive the scheduled job against the mock router and assert on the
 * router's end state, because the failure this guards against is silent: a job
 * that reports it throttled four customers while every PPP secret still points at
 * the fast profile. A returned `{ ran: 4 }` is not evidence.
 *
 * The fixtures write `OnlineSession` rows directly rather than going through the
 * network sync, because what is being tested is the sum over a window, and the
 * sync's own max-of-counters behaviour is covered by the RouterOS tests.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import { startMockRouter } from "./mock-routeros.mjs";
import { customerCycleUsage, cycleWindow } from "../src/lib/services/fup.ts";
import { enforceFup } from "../src/lib/services/cron.ts";

let mock;
let router;
let areaId;
let createdCustomers = [];
let originalSettings = {};

const GB = 1024 ** 3;
/** Exactly n GB, in the bytes the session rows store. */
const gb = (n) => BigInt(Math.round(n * GB));

/** A customer on a package with the given limit and profiles. */
async function makeCustomer(username, { limit, fupProfile, profile } = {}) {
  const pkg = await prisma.package.create({
    data: {
      name: `FUPTest ${username} ${Date.now()}`,
      downloadSpeed: 20,
      uploadSpeed: 20,
      monthlyPrice: 800,
      fupLimit: limit,
      fupProfile,
      mikrotikProfile: profile,
    },
    select: { id: true },
  });
  createdPackages.push(pkg.id);

  const customer = await prisma.customer.create({
    data: {
      customerCode: `TEST-FUP-${username.toUpperCase()}-${Date.now()}`,
      name: `FUP ${username}`,
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
  return { ...customer, pkgId: pkg.id };
}

let createdPackages = [];

/** An invoice that defines the cycle window, so usage is measured against it. */
async function setCycle(customerId, from, to) {
  await prisma.invoice.create({
    data: {
      invoiceNumber: `FUP-INV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
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
}

/** A session that started at a given time and moved a given amount. */
async function addSession(customerId, loginTime, down, up = 0n) {
  await prisma.onlineSession.create({
    data: {
      customerId,
      username: "fup",
      loginTime,
      logoutTime: new Date(loginTime.getTime() + 3600_000),
      downloadBytes: down,
      uploadBytes: up,
    },
  });
}

before(async () => {
  mock = await startMockRouter();
  mock.reset();

  areaId = (await prisma.area.findFirstOrThrow()).id;

  const existing = await prisma.router.findFirst({ where: { name: "fup-test-router" } });
  if (existing) await prisma.router.delete({ where: { id: existing.id } });

  router = await prisma.router.create({
    data: {
      name: "fup-test-router",
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
  await saveSettings([{ key: "network.fupAction", value: "throttle" }]);
  // A window that has already closed, so sessions can be placed either side of
  // it deterministically.
  const from = new Date("2026-03-01T00:00:00Z");
  const to = new Date("2026-03-31T00:00:00Z");
  globalThis.__fupWindow = { from, to };
});

/* ------------------------------------------------------------------ */

describe("measuring the cycle", () => {
  test("sessions inside the window are summed, ones outside are not", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("windows", { limit: 100, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);

    await addSession(c.id, new Date("2026-03-05T10:00:00Z"), gb(10), gb(1));
    await addSession(c.id, new Date("2026-03-20T10:00:00Z"), gb(20), gb(2));
    // Outside the window: before it, and after it.
    await addSession(c.id, new Date("2026-02-25T10:00:00Z"), gb(500));
    await addSession(c.id, new Date("2026-04-05T10:00:00Z"), gb(500));

    const usage = await customerCycleUsage(c.id);

    assert.equal(usage.bytes, gb(33), "only the sessions inside the window count");
    assert.ok(Math.abs(usage.gb - 33) < 0.001, `got ${usage.gb} GB`);
    assert.equal(usage.limitGb, 100);
    assert.equal(usage.exceeded, false);

    const w = await cycleWindow(c.id);
    assert.equal(w.from.toISOString(), from.toISOString(), "the cycle is the invoice window");
  });

  test("without an invoice the window falls back to the package validity", async () => {
    const c = await makeCustomer("noinv", { limit: 50, profile: "20Mbps" });
    const w = await cycleWindow(c.id);
    const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
    assert.ok(Math.abs(days - 30) < 1, `expected about 30 days, got ${days}`);
    assert.ok(Math.abs(w.to.getTime() - Date.now()) < 60_000, "the window must end now, not in the past");
  });

  test("a package with no limit is unlimited, not at zero", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("nolimit", { limit: null, profile: "20Mbps" });
    await setCycle(c.id, from, to);
    await addSession(c.id, new Date("2026-03-10T10:00:00Z"), gb(999));

    const usage = await customerCycleUsage(c.id);
    assert.equal(usage.limitGb, null);
    assert.equal(usage.percent, null);
    assert.equal(usage.exceeded, false, "no limit means never exceeded");
  });
});

describe("enforcing the limit", () => {
  test("crossing the limit moves the secret to the throttled profile", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("throttle1", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);

    // Start below, so the restore path is what puts the profile there first.
    await addSession(c.id, new Date("2026-03-05T10:00:00Z"), gb(10));
    // Provision so the secret exists, then push it over.
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    assert.equal(mock.secret("throttle1").profile, "20Mbps", "the fast profile is applied first");

    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));

    const result = await enforceFup();
    assert.ok(result.ran >= 1, `ran=${result.ran}`);

    // The router, not the return value.
    assert.equal(
      mock.secret("throttle1").profile,
      "2Mbps",
      "the secret must actually point at the throttled profile"
    );

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, true);
    assert.ok(row.fupThrottledAt, "when it happened is part of the record");
  });

  test("a second run does not touch the router again", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("throttle2", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));

    await enforceFup();
    mock.reset();

    // Put the secret back so a fresh call would be visible if one happened.
    await prisma.networkAction.deleteMany({ where: { customerId: c.id } });
    const before = mock.calls().length;
    await enforceFup();

    assert.equal(
      mock.calls().length,
      before,
      "an already-throttled customer must not generate another router write"
    );
  });

  test("a new cycle restores the package profile and clears the flag", async () => {
    const c = await makeCustomer("restore1", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);

    // Throttle them, then move the cycle on so usage falls back under the limit.
    const overFrom = new Date("2026-03-01T00:00:00Z");
    const overTo = new Date("2026-03-31T00:00:00Z");
    await setCycle(c.id, overFrom, overTo);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));
    await enforceFup();
    assert.equal(mock.secret("restore1").profile, "2Mbps");

    // A new invoice window with no usage in it.
    const newFrom = new Date("2026-04-01T00:00:00Z");
    const newTo = new Date("2026-04-30T00:00:00Z");
    await prisma.invoice.updateMany({
      where: { customerId: c.id },
      data: { billingFrom: newFrom, billingTo: newTo },
    });

    const result = await enforceFup();
    assert.ok(result.ran >= 1, "the restore should count as work done");

    assert.equal(
      mock.secret("restore1").profile,
      "20Mbps",
      "the customer must be put back on their package speed"
    );
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, false);
    assert.equal(row.fupThrottledAt, null);
  });

  test("a suspended customer is left alone", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("susp1", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));

    // Suspension is the expiry sweep's decision, not this job's.
    await prisma.customer.update({
      where: { id: c.id },
      data: { connectionStatus: "Suspended" },
    });
    // No `mock.reset()` here: it would wipe the secret the assertion reads, and
    // a null secret is indistinguishable from an untouched one. The commands the
    // job actually issued are the better evidence anyway.
    const before = mock.calls().length;

    await enforceFup();

    assert.equal(
      mock.calls().length,
      before,
      "a suspended customer must not produce a single router call"
    );
    assert.equal(mock.secret("susp1").profile, "20Mbps", "a suspended line is not throttled here");
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, false);
  });

  test("a package with no throttled profile cannot throttle, and says so", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("nothrottle", { limit: 50, profile: "20Mbps", fupProfile: null });
    await setCycle(c.id, from, to);
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));
    const before = mock.calls().length;

    const result = await enforceFup();

    assert.equal(
      mock.calls().length,
      before,
      "nothing may be changed on the router when there is nothing to change it to"
    );
    assert.equal(mock.secret("nothrottle").profile, "20Mbps");
    assert.match(result.note ?? "", /no throttled profile/i, "the ISP must be told the package needs one");
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, false, "and the customer is not marked as throttled");
  });

  test("with the action off, nothing happens at all", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("off1", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));
    mock.reset();

    await saveSettings([{ key: "network.fupAction", value: "off" }]);
    const result = await enforceFup();

    assert.equal(result.ran, 0);
    assert.match(result.skipped, /off/i);
    assert.equal(mock.calls().length, 0, "not one router call may be made");
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, false);
  });

  test("notify mode leaves the router alone", async () => {
    const { from, to } = globalThis.__fupWindow;
    const c = await makeCustomer("notify1", { limit: 50, profile: "20Mbps", fupProfile: "2Mbps" });
    await setCycle(c.id, from, to);
    const { enforceProvision } = await import("../src/lib/services/network-enforcement.ts");
    await enforceProvision(c.id);
    await addSession(c.id, new Date("2026-03-25T10:00:00Z"), gb(60));
    const before = mock.calls().length;

    await saveSettings([{ key: "network.fupAction", value: "notify" }]);
    const result = await enforceFup();

    assert.equal(
      mock.calls().length,
      before,
      "notify mode must not touch the router at all"
    );
    assert.equal(mock.secret("notify1").profile, "20Mbps");
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.fupThrottled, false, "and must not mark the customer as throttled");

    // The notification is recorded with the gateway's real outcome, never
    // "Sent" just because we tried.
    const note = await prisma.notification.findFirst({
      where: { customerId: c.id, template: "fup-exceeded" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(note, "a notification row should be written");
    assert.ok(["Sent", "Failed"].includes(note.status));
    void result;
  });
});
