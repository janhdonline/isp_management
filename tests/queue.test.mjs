import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import { startMockRouter } from "./mock-routeros.mjs";
import { RouterOsClient } from "../src/lib/services/routeros.ts";
import {
  syncBandwidthForCustomer,
  applyBandwidth,
  decide,
  queueName,
  targetFor,
} from "../src/lib/services/bandwidth.ts";
import { retryPendingNetworkActions } from "../src/lib/services/network-enforcement.ts";

/**
 * Phase Q — bandwidth enforcement on MikroTik.
 *
 * The claim under test is the one the problem statement makes: a customer sold
 * 10 Mbps and a customer sold 50 Mbps currently get whatever the router feels
 * like. So the assertions are about *numbers on the router*, read back from the
 * mock, and about the two ways this can go wrong — writing nothing because nobody
 * opted in, and writing something that kills the connection.
 */

const STAMP = Date.now();
const MOCK = { user: "isp-api", password: "correct-horse" };

let router;
let area;
let operator;
let pkg10;
let pkg50;
let pkgNoSpeeds;
let mock;
/** Restored in `after`; a test that leaves one behind changes the dev database. */
let originalSettings = {};

const created = { customers: [], packages: [], routers: [] };

before(async () => {
  mock = await startMockRouter(MOCK);
  await sweep();

  // The router row carries its own credentials, so these settings are not what the
  // test reads — but the app falls back to them, and leaving them consistent keeps
  // the router page in the dev database showing something real.
  const originals = {};
  for (const key of ["network.mikrotikUser", "network.mikrotikPassword"]) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originals[key] = row?.value ?? null;
  }
  await saveSettings([
    { key: "network.mikrotikUser", value: MOCK.user },
    { key: "network.mikrotikPassword", value: MOCK.password },
  ]);
  invalidateSettingsCache();
  originalSettings = originals;

  area = await prisma.area.findFirstOrThrow();
  operator = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Administrator" } },
    select: { id: true },
  });

  pkg10 = await makePackage("Queue 10 Mbps", 10, 2);
  pkg50 = await makePackage("Queue 50 Mbps", 50, 10);
  // Speeds are NOT NULL on the model, so "no speeds" is expressed as zero — which
  // is exactly the number that must never reach a queue.
  pkgNoSpeeds = await makePackage("Queue blank", 0, 0);

  router = await makeRouter({ autoQueues: true }, false);
});

after(async () => {
  // Without this the HTTP server keeps the event loop alive and the run hangs
  // until something kills it — every test green, and the suite never returns.
  await mock.close();
  await sweep();
  for (const [key, value] of Object.entries(originalSettings)) {
    if (value !== null) await saveSettings([{ key, value }]);
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  mock.reset();
  await clearRows();
  invalidateSettingsCache();
});

async function sweep() {
  await prisma.networkAction.deleteMany({
    where: { action: { in: ["setBandwidth", "removeBandwidth"] } },
  });
  await prisma.customer.deleteMany({ where: { customerCode: { startsWith: "Q-" } } });
  // By `name`, not `code`: `Package.code` is nullable and Prisma rejects
  // `startsWith` on a nullable column.
  await prisma.package.deleteMany({ where: { name: { startsWith: "Queue " } } });
  await prisma.router.deleteMany({ where: { name: { startsWith: "q-router-" } } });
}

async function clearRows() {
  if (created.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  if (created.routers.length) {
    await prisma.router.deleteMany({ where: { id: { in: created.routers } } });
  }
  created.customers.length = 0;
  created.routers.length = 0;
}

async function makePackage(name, downloadSpeed, uploadSpeed) {
  const pkg = await prisma.package.create({
    data: {
      // `code` is left null on purpose — it is nullable and unique, and a test
      // package does not need one.
      name,
      monthlyPrice: 500,
      downloadSpeed,
      uploadSpeed,
      fupProfile: name,
      status: "Active",
    },
    select: { id: true, name: true, downloadSpeed: true, uploadSpeed: true },
  });
  created.packages.push(pkg.id);
  return pkg;
}

/**
 * @param tracked Whether `clearRows` should delete it. The main router is created
 *   once in `before` and must survive every `beforeEach`; only the extra routers
 *   individual tests make are disposable.
 */
async function makeRouter(over = {}, tracked = true) {
  const r = await prisma.router.create({
    data: {
      name: `q-router-${STAMP}-${Math.random().toString(36).slice(2, 7)}`,
      ipAddress: "127.0.0.1",
      apiPort: mock.port,
      apiUser: MOCK.user,
      apiSecretEnc: MOCK.password,
      autoProvision: true,
      // Opted in by default, because most of these tests are about what happens
      // *after* the gate. Without it every test here silently measured the
      // "switched off" branch and passed for the wrong reason.
      autoQueues: true,
      areaId: area.id,
      ...over,
    },
    select: { id: true, name: true, autoQueues: true, useRadius: true },
  });
  if (tracked) created.routers.push(r.id);
  return r;
}

async function makeCustomer(over = {}) {
  const n = created.customers.length + 1;
  const c = await prisma.customer.create({
    data: {
      customerCode: `Q-${STAMP}-${n}`,
      name: `Queued Customer ${n}`,
      username: `quser${STAMP}${n}`,
      phone: `018${String(80000000 + n)}`,
      connectionStatus: "Active",
      connectionDate: new Date(),
      areaId: area.id,
      routerId: router.id,
      packageId: pkg10.id,
      ipAddress: "100.64.10.5",
      password: "ppp-secret-value",
      ...over,
    },
    select: { id: true, username: true },
  });
  created.customers.push(c.id);
  return c;
}

// ---------------------------------------------------------------------------

describe("naming and targeting", () => {
  test("a queue is isp-<username>, like everything else this app puts on a router", () => {
    assert.equal(queueName("rahim100"), "isp-rahim100");
    assert.equal(queueName("  rahim100  "), "isp-rahim100");
  });

  test("the target follows the router's session source", () => {
    assert.equal(targetFor("ppp", "100.64.10.5"), "pppoe-service,100.64.10.5");
    assert.equal(targetFor("hotspot", "10.5.0.2"), "hotspot-service,10.5.0.2");
  });
});

describe("the gates, as pure rules", () => {
  const fast = { download: 10, upload: 2 };
  const router = { id: "r", name: "R", sessionSource: "ppp", autoQueues: true, useRadius: false };

  test("no router means nothing to program", () => {
    const d = decide({ connectionStatus: "Active", router: null, packageSpeeds: fast, ipAddress: "1.2.3.4" });
    assert.equal(d.go, false);
    assert.match(d.reason, /No router/);
  });

  test("autoQueues off means the router is not touched", () => {
    const d = decide({
      connectionStatus: "Active",
      router: { ...router, autoQueues: false },
      packageSpeeds: fast,
      ipAddress: "1.2.3.4",
    });
    assert.equal(d.go, false);
    assert.match(d.reason, /switched off for R/);
  });

  test("RADIUS wins, and says why rather than doubling up", () => {
    const d = decide({
      connectionStatus: "Active",
      router: { ...router, useRadius: true },
      packageSpeeds: fast,
      ipAddress: "1.2.3.4",
    });
    assert.equal(d.go, false);
    assert.match(d.reason, /Mikrotik-Rate-Limit/);
    assert.match(d.reason, /only one limiter/);
  });

  test("a package with no speeds is skipped, never shaped to zero", () => {
    for (const speeds of [
      { download: 0, upload: 0 },
      { download: 0, upload: 5 },
      { download: 5, upload: 0 },
      { download: null, upload: null },
    ]) {
      const d = decide({ connectionStatus: "Active", router, packageSpeeds: speeds, ipAddress: "1.2.3.4" });
      assert.equal(d.go, false, JSON.stringify(speeds));
      assert.match(d.reason, /no usable speeds|missing number/);
    }
  });

  test("a suspended customer's queue goes even when their package has no speeds", () => {
    // Checked before the speeds, deliberately: removing something needs no
    // numbers, and a customer suspended on a half-filled-in package must still
    // have their queue taken away.
    const d = decide({
      connectionStatus: "Suspended",
      router,
      packageSpeeds: { download: 0, upload: 0 },
      ipAddress: "1.2.3.4",
    });
    assert.equal(d.go, true, "the queue is removed");
    assert.equal(d.download, 0);
    assert.equal(d.upload, 0);
  });

  test("an active customer on a real package gets those numbers", () => {
    const d = decide({
      connectionStatus: "Active",
      router,
      packageSpeeds: { download: 50, upload: 10 },
      ipAddress: "1.2.3.4",
    });
    assert.equal(d.go, true);
    assert.equal(d.download, 50);
    assert.equal(d.upload, 10);
  });
});

describe("the client against the mock router", () => {
  function client() {
    return new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: MOCK.user,
      password: MOCK.password,
      useSsl: false,
      sessionSource: "ppp",
    });
  }

  test("creates a queue in RouterOS's own units", async () => {
    const c = client();
    const out = await c.ensureSimpleQueue({
      name: "isp-newbie",
      target: "pppoe-service,100.64.10.7",
      maxDownload: 10,
      maxUpload: 2,
    });
    assert.equal(out.created, true);

    const row = mock.queue("isp-newbie");
    assert.ok(row, "the queue exists on the router");
    // Not "10/2": RouterOS reads a bare number as bits per second.
    assert.equal(row["max-limit"], "10M/2M");
  });

  test("re-running on a correct queue writes nothing at all", async () => {
    const c = client();
    await c.ensureSimpleQueue({ name: "isp-idem", target: "pppoe-service,1.1.1.1", maxDownload: 25, maxUpload: 5 });
    const writesAfterFirst = mock.queueWrites();

    const second = await c.ensureSimpleQueue({
      name: "isp-idem",
      target: "pppoe-service,1.1.1.1",
      maxDownload: 25,
      maxUpload: 5,
    });

    assert.equal(second.changed, false);
    assert.equal(second.created, false);
    assert.equal(
      mock.queueWrites(),
      writesAfterFirst,
      "not a write that happens to be harmless — no write"
    );
    assert.equal(mock.queues().filter((q) => q.name === "isp-idem").length, 1, "and no duplicate");
  });

  test("a package change updates in place", async () => {
    const c = client();
    await c.ensureSimpleQueue({ name: "isp-change", target: "pppoe-service,1.1.1.1", maxDownload: 10, maxUpload: 2 });
    const before = mock.queueWrites();

    const out = await c.ensureSimpleQueue({
      name: "isp-change",
      target: "pppoe-service,1.1.1.1",
      maxDownload: 50,
      maxUpload: 10,
    });

    assert.equal(out.changed, true);
    assert.equal(out.created, false);
    assert.ok(mock.queueWrites() > before, "one PATCH, not a delete and a PUT");
    assert.equal(mock.queue("isp-change")["max-limit"], "50M/10M");
    assert.equal(mock.queues().filter((q) => q.name === "isp-change").length, 1);
  });

  test("reads limits back in Mbps whatever RouterOS wrote", async () => {
    const c = client();
    // `someone-elses` is stored as `50m/10m` by the mock on purpose.
    const found = await c.findSimpleQueue("someone-elses");
    assert.equal(found.maxDownload, 50);
    assert.equal(found.maxUpload, 10);
  });

  test("removing something already gone succeeds", async () => {
    const c = client();
    assert.equal(await c.removeSimpleQueue("never-existed"), true);
    assert.equal(await c.removeSimpleQueue("isp-rahim100"), true);
    assert.equal(mock.queue("isp-rahim100"), null);
  });
});

describe("a customer on an opted-in router", () => {
  test("gets a queue at their package's speeds", async () => {
    const customer = await makeCustomer({ packageId: pkg10.id });

    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(result.ok, true, result.detail);
    assert.equal(result.changed, true);
    const row = mock.queue(`isp-${customer.username}`);
    assert.ok(row, "the queue is on the router");
    assert.equal(row["max-limit"], "10M/2M");
    assert.equal(row.target, "pppoe-service,100.64.10.5");
  });

  test("a 10 → 50 change reaches the router", async () => {
    const customer = await makeCustomer({ packageId: pkg10.id });
    await syncBandwidthForCustomer(customer.id, operator.id);
    assert.equal(mock.queue(`isp-${customer.username}`)["max-limit"], "10M/2M");

    await prisma.customer.update({ where: { id: customer.id }, data: { packageId: pkg50.id } });
    await syncBandwidthForCustomer(customer.id, operator.id);

    const row = mock.queue(`isp-${customer.username}`);
    assert.equal(row["max-limit"], "50M/10M");
    assert.equal(mock.queues().filter((q) => q.name === `isp-${customer.username}`).length, 1);
  });

  test("running it twice changes nothing and creates no duplicate", async () => {
    const customer = await makeCustomer({ packageId: pkg50.id });
    await syncBandwidthForCustomer(customer.id, operator.id);
    const writes = mock.queueWrites();

    const second = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(second.ok, true);
    assert.equal(second.changed, false, "already correct");
    assert.equal(mock.queueWrites(), writes, "and nothing was written");
    assert.equal(mock.queues().filter((q) => q.name === `isp-${customer.username}`).length, 1);
  });

  test("the row in the queue names the package it came from", async () => {
    const customer = await makeCustomer({ packageId: pkg50.id });
    await syncBandwidthForCustomer(customer.id, operator.id);

    const { listManagedQueues } = await import("../src/lib/services/bandwidth.ts");
    const report = await listManagedQueues(router.id);
    const mine = report.queues.find((q) => q.name === `isp-${customer.username}`);
    assert.ok(mine, "the queue is attributed to a customer");
    assert.equal(mine.username, customer.username);
    assert.equal(mine.packageName, "Queue 50 Mbps");
    assert.equal(mine.maxDownload, 50);
    assert.equal(
      report.unmanaged,
      1,
      "the hand-made 'someone-elses' queue is reported, not hidden"
    );
  });
});

describe("suspending and reconnecting", () => {
  test("suspend takes the queue away, reconnect puts it back", async () => {
    const customer = await makeCustomer({ packageId: pkg10.id });
    await syncBandwidthForCustomer(customer.id, operator.id);
    assert.ok(mock.queue(`isp-${customer.username}`));

    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Suspended" },
    });
    const down = await syncBandwidthForCustomer(customer.id, operator.id);
    assert.equal(down.ok, true, down.detail);
    assert.equal(mock.queue(`isp-${customer.username}`), null, "the queue is gone");

    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Active" },
    });
    const up = await syncBandwidthForCustomer(customer.id, operator.id);
    assert.equal(up.ok, true);
    assert.equal(mock.queue(`isp-${customer.username}`)["max-limit"], "10M/2M", "back at the package");
  });

  test("the queue is removed, not zeroed", async () => {
    const customer = await makeCustomer({ packageId: pkg10.id });
    await syncBandwidthForCustomer(customer.id, operator.id);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Suspended" },
    });
    await syncBandwidthForCustomer(customer.id, operator.id);

    // `max-limit=0` means unlimited on some RouterOS versions and blocks on
    // others. A coin flip with a customer's connection on it is not a decision.
    assert.equal(mock.queue(`isp-${customer.username}`), null);
    assert.ok(
      !mock.queues().some((q) => String(q["max-limit"]).includes("0M/0M")),
      "and no zero-limit queue anywhere"
    );
  });

  test("a reconnect uses the package they have now, not the one they had", async () => {
    const customer = await makeCustomer({ packageId: pkg10.id });
    await syncBandwidthForCustomer(customer.id, operator.id);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Suspended" },
    });
    await syncBandwidthForCustomer(customer.id, operator.id);

    await prisma.customer.update({
      where: { id: customer.id },
      data: { connectionStatus: "Active", packageId: pkg50.id },
    });
    await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(mock.queue(`isp-${customer.username}`)["max-limit"], "50M/10M");
  });
});

describe("routers this app must not touch", () => {
  test("autoQueues off leaves the router exactly as it was", async () => {
    const quiet = await makeRouter({ autoQueues: false });
    const customer = await makeCustomer({ packageId: pkg10.id, routerId: quiet.id });

    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.detail, /switched off/);
    assert.equal(mock.queue(`isp-${customer.username}`), null, "nothing written");
    assert.equal(mock.queueWrites(), 0, "and not one call to the queue collection");
  });

  test("a RADIUS router is left alone, and the reason is recorded", async () => {
    const rad = await makeRouter({ useRadius: true });
    const customer = await makeCustomer({ packageId: pkg10.id, routerId: rad.id });

    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.detail, /Mikrotik-Rate-Limit/);
    assert.equal(mock.queue(`isp-${customer.username}`), null);
    assert.equal(mock.queueWrites(), 0);

    const log = await prisma.activityLog.findFirst({
      where: { summary: { contains: customer.username } },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    assert.ok(log, "the skip is recorded rather than silently ignored");
    assert.match(log.summary, /No queue programmed/);
  });

  test("a package with no speeds is skipped, and no zero queue appears", async () => {
    const customer = await makeCustomer({ packageId: pkgNoSpeeds.id });

    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.detail, /no usable speeds/);
    assert.equal(mock.queue(`isp-${customer.username}`), null);
    assert.equal(mock.queueWrites(), 0, "nothing attempted at all");
    assert.ok(
      !mock.queues().some((q) => q.name === `isp-${customer.username}`),
      "no zero-speed queue anywhere on the router"
    );
  });
});

describe("a router that will not answer", () => {
  test("the attempt is logged, queued for retry, and the customer is untouched", async () => {
    const dead = await makeRouter({ apiPort: 1 });
    const customer = await makeCustomer({ packageId: pkg10.id, routerId: dead.id });
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });

    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    assert.equal(result.ok, false);
    assert.equal(result.queued, true, "queued rather than lost");

    const row = await prisma.networkAction.findFirstOrThrow({
      where: { id: result.actionId },
      select: { status: true, lastError: true, attempts: true, payload: true },
    });
    assert.equal(row.status, "Pending", "Pending, never Failed: Failed is terminal");
    assert.ok(row.lastError, "and it says why");
    assert.ok(row.attempts >= 1);
    assert.equal(row.payload, null, "nothing on the queue row could be a credential");

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(after.connectionStatus, before.connectionStatus);
    assert.equal(after.routerId, before.routerId);

    // Filtered on `entity`, not the summary text: the summary names the queue and
    // the router, and the word "Bandwidth" is the entity. Filtering on the wrong one
    // found nothing and read as "the failure was not logged".
    const log = await prisma.activityLog.findFirst({
      where: { entity: "Bandwidth", action: "Update" },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    assert.ok(log, "the attempt is in the activity log");
    assert.match(log.summary, /failed/);
  });

  test("the retry goes through the Phase A queue", async () => {
    const dead = await makeRouter({ apiPort: 1 });
    const customer = await makeCustomer({ packageId: pkg10.id, routerId: dead.id });
    const result = await syncBandwidthForCustomer(customer.id, operator.id);

    // Put the row at the very front of the queue, the way a later cycle finds it
    // due.
    //
    // The drain takes 50 rows oldest-first and this development database carries
    // ~58 stale Pending rows from earlier test runs, so "an hour ago" is still not
    // old enough to be in the window. Ten days is older than anything here, which
    // makes the ordering deterministic without this test deleting rows other suites
    // created.
    const longAgo = new Date(Date.now() - 10 * 24 * 3_600_000);
    await prisma.networkAction.update({
      where: { id: result.actionId },
      data: { createdAt: longAgo, updatedAt: longAgo },
    });
    const before = await prisma.networkAction.findUniqueOrThrow({
      where: { id: result.actionId },
      select: { attempts: true },
    });

    await retryPendingNetworkActions();

    const after = await prisma.networkAction.findUniqueOrThrow({
      where: { id: result.actionId },
      select: { id: true, status: true, attempts: true },
    });
    assert.equal(after.id, result.actionId, "the same row, not a new one");
    assert.ok(after.attempts > before.attempts, "attempted again");
  });

  test("a queue that has moved on before the retry is dropped, not forced", async () => {
    // The gate can close between queueing and executing: an admin switches
    // autoQueues off, or moves the router onto RADIUS, while a retry waited.
    const off = await makeRouter({ autoQueues: true });
    const customer = await makeCustomer({ packageId: pkg10.id, routerId: off.id });
    const result = await syncBandwidthForCustomer(customer.id, operator.id);
    assert.equal(result.ok, true);

    await prisma.router.update({ where: { id: off.id }, data: { autoQueues: false } });
    mock.reset();

    const retried = await applyBandwidth(result.actionId);
    assert.equal(retried.skipped, true);
    assert.match(retried.detail, /switched off/);
    assert.equal(mock.queueWrites(), 0, "the router was not written after opting out");
  });
});
