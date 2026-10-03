import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import { startMockCpe, buildInform } from "./mock-acs.mjs";
import {
  recordInform,
  provisionOnuForCustomer,
  retryOnuConfigure,
  readTr069Settings,
  buildConfig,
  buildSsid,
  wifiPassword,
  payloadHash,
  tr069Adapter,
  HttpTr069Adapter,
  readLogFor,
} from "../src/lib/services/tr069.ts";
import { retryPendingNetworkActions } from "../src/lib/services/network-enforcement.ts";
import { POST as acsInform } from "../src/app/api/acs/inform/route.ts";

/**
 * Phase M — zero-touch ONU provisioning.
 *
 * The question every test here answers is the same one an operator asks when they
 * plug an ONU into a customer's flat: *does the device now work, and if not, does
 * the system know it does not?*
 */

const SECRET = "acs-shared-secret-for-tests-0123456789";
const STAMP = Date.now();

let cpe;
let area;
let olt;
const created = { onus: [], customers: [], actions: [] };

const SETTINGS_KEYS = [
  "tr069.enabled",
  "tr069.acsSecret",
  "tr069.deviceApiUrl",
  "tr069.vlanId",
  "tr069.wifiSsidPattern",
  "tr069.wifiPasswordPolicy",
  "tr069.provisionTimeoutSec",
];

let originalSettings = {};

async function setSettings(entries) {
  await saveSettings(entries.map((e) => ({ key: e.key, value: e.value })));
  invalidateSettingsCache();
}

/** Points the service at the fake device and arms it. */
async function armAdapter(on = true) {
  await setSettings([
    { key: "tr069.enabled", value: on ? "true" : "false" },
    { key: "tr069.acsSecret", value: SECRET },
    { key: "tr069.deviceApiUrl", value: cpe.url },
    { key: "tr069.vlanId", value: "100" },
    { key: "tr069.wifiSsidPattern", value: "isp-{username}" },
    { key: "tr069.wifiPasswordPolicy", value: "pppoe" },
  ]);
}

function makeSerial(n) {
  return `HWTC${STAMP}${String(n).padStart(4, "0")}`;
}

async function makeOnu(over = {}) {
  const serialNo = over.serialNo ?? makeSerial(created.onus.length + 1);
  const onu = await prisma.onu.create({
    data: {
      serialNo,
      vendor: "Huawei",
      model: "MA5800-X7",
      oltId: olt?.id ?? null,
      ponIndex: "0/1/1:2",
      status: "Provisioning",
      lastSeenAt: new Date(),
      ...over,
    },
    select: { id: true, serialNo: true, status: true },
  });
  created.onus.push(onu.id);
  return onu;
}

async function makeCustomer(over = {}) {
  const n = created.customers.length + 1;
  const c = await prisma.customer.create({
    data: {
      customerCode: `TR069-${STAMP}-${n}`,
      name: `Zero Touch Customer ${n}`,
      username: `zt${STAMP}${n}`,
      // A real-looking secret, because the whole point is that this value ends up
      // in a device payload and must not end up in a log.
      password: `ppp-${STAMP}-${n}-secret`,
      connectionStatus: "Active",
      connectionDate: new Date(),
      phone: `017${String(90000000 + n)}`,
      areaId: area.id,
      ...over,
    },
    select: { id: true, name: true, username: true, password: true, onuId: true },
  });
  created.customers.push(c.id);
  return c;
}

/**
 * Removes anything a previous *interrupted* run of this file left behind.
 *
 * `after()` cannot do this job: it does not run when the process is killed, and
 * one interrupted run once left 96 customers in the database. Those then became
 * the first row `scripts/verify.mjs` picks as "a customer to suspend", and it
 * failed with a message about a customer this file had created. A test file that
 * can make the rest of the suite fail after a Ctrl-C is a trap, not a test.
 */
async function sweepPreviousRun() {
  const customers = await prisma.customer.findMany({
    where: { customerCode: { startsWith: `TR069-` } },
    select: { id: true, onuId: true },
  });
  const onus = [
    ...new Set(customers.map((c) => c.onuId).filter((id) => typeof id === "string")),
  ];
  await prisma.networkAction.deleteMany({
    where: { OR: [{ customerId: { in: customers.map((c) => c.id) } }, { action: "onuConfigure" }] },
  });
  if (customers.length) await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
  if (onus.length) await prisma.tr069Log.deleteMany({ where: { onuId: { in: onus } } });
  // Anything from the `node tests/mock-acs.mjs --inform …` demo as well.
  await prisma.tr069Log.deleteMany({ where: { serialNo: { startsWith: "HWTC999" } } });
  await prisma.onu.deleteMany({ where: { serialNo: { startsWith: "HWTC999" } } });
  if (onus.length) await prisma.onu.deleteMany({ where: { id: { in: onus } } });
}

before(async () => {
  await sweepPreviousRun();
  cpe = await startMockCpe();

  for (const key of SETTINGS_KEYS) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originalSettings[key] = row?.value ?? null;
  }

  area = await prisma.area.findFirstOrThrow();
  const existing = await prisma.olt.findFirst({ where: { name: "tr069-test-olt" } });
  if (existing) await prisma.olt.delete({ where: { id: existing.id } });
  olt = await prisma.olt.create({
    data: { name: "tr069-test-olt", vendor: "Huawei", status: "Online", areaId: area.id },
    select: { id: true, name: true },
  });

  await armAdapter();
});

after(async () => {
  await cleanup();
  for (const [key, value] of Object.entries(originalSettings)) {
    if (value !== null) await saveSettings([{ key, value }]);
  }
  await cpe.close();
  await prisma.$disconnect();
});

/**
 * Re-armed before every test, not restored at the end of one.
 *
 * An assert that throws before its cleanup leaves the next test running against
 * the wrong configuration — which is how a single wording mismatch turned into
 * nine failures that all looked like the feature being broken. Settings are
 * global; test independence has to be established here rather than hoped for.
 */
beforeEach(async () => {
  cpe.reset();
  await armAdapter();
});

async function cleanup() {
  if (created.actions.length) {
    await prisma.networkAction.deleteMany({ where: { id: { in: created.actions } } });
  }
  if (created.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  if (created.onus.length) {
    await prisma.tr069Log.deleteMany({ where: { onuId: { in: created.onus } } });
    await prisma.onu.deleteMany({ where: { id: { in: created.onus } } });
  }
  created.actions.length = 0;
  created.customers.length = 0;
  created.onus.length = 0;
}

// ---------------------------------------------------------------------------

describe("a device checking in", () => {
  test("an Inform from an unknown serial creates the ONU, awaiting configuration", async () => {
    const serialNo = makeSerial(9001);

    const outcome = await recordInform({
      serialNo,
      vendor: "Huawei",
      model: "MA5800-X7",
      oltId: olt.id,
      ponIndex: "0/2/3:5",
    });

    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);

    assert.equal(outcome.created, true);
    assert.equal(row.vendor, "Huawei", "the vendor came off the device");
    assert.equal(row.model, "MA5800-X7", "and so did the model, which is what identifies a firmware");
    assert.equal(row.oltId, olt.id);
    assert.equal(row.ponIndex, "0/2/3:5");
    assert.equal(
      row.status,
      "Provisioning",
      "not Online: the device has nothing working on it yet, and saying otherwise hides it"
    );
    assert.ok(row.lastSeenAt);
  });

  test("an Inform on a known serial creates nothing and changes nothing", async () => {
    const onu = await makeOnu({ status: "Online", ponIndex: "0/9/9:9" });
    const before = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });

    // Every field here is different from what is stored, and all of it is a lie:
    // this is an unauthenticated claim from the network.
    const outcome = await recordInform({
      serialNo: onu.serialNo,
      vendor: "Spoofed",
      model: "Not-A-Real-Model",
      oltId: null,
      ponIndex: "0/0/0:0",
    });

    const after = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });

    assert.equal(outcome.created, false);
    assert.equal(await prisma.onu.count({ where: { serialNo: onu.serialNo } }), 1, "no second row");
    assert.equal(after.vendor, before.vendor, "a later Inform may not restate the vendor");
    assert.equal(after.model, before.model);
    assert.equal(after.ponIndex, before.ponIndex, "or move the device to another port");
    assert.equal(after.oltId, before.oltId);
    assert.equal(after.status, "Online", "nor claim a state the device did not report");
    assert.ok(after.lastSeenAt >= before.lastSeenAt, "presence is the one thing it does prove");
  });

  test("two Informs for a brand-new serial leave one row", async () => {
    const serialNo = makeSerial(9002);
    // Real CPEs retry Inform until it is answered, so this is the normal case.
    const [a, b, c] = await Promise.all([
      recordInform({ serialNo, vendor: "ZTE", model: "C620" }),
      recordInform({ serialNo, vendor: "ZTE", model: "C620" }),
      recordInform({ serialNo, vendor: "ZTE", model: "C620" }),
    ]);

    assert.equal(await prisma.onu.count({ where: { serialNo } }), 1);
    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);
    assert.equal(row.status, "Provisioning");
    assert.equal(new Set([a.onuId, b.onuId, c.onuId]).size, 1, "all three agree on which row it is");
    assert.equal([a.created, b.created, c.created].filter(Boolean).length, 1, "exactly one created it");
  });

  test("an Inform naming an OLT that does not exist gets no OLT", async () => {
    const serialNo = makeSerial(9003);
    const outcome = await recordInform({ serialNo, oltId: "no-such-olt-id" });
    const row = await prisma.onu.findUniqueOrThrow({ where: { id: outcome.onuId } });
    created.onus.push(row.id);
    assert.equal(row.oltId, null, "rather than a dangling reference nobody can fault-localize from");
  });

  test("every Inform is logged with a hash and no payload", async () => {
    const serialNo = makeSerial(9004);
    const inform = { serialNo, vendor: "Huawei", model: "MA5800-X7", uptimeSeconds: 42 };
    await recordInform(inform);
    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);

    const logs = await prisma.tr069Log.findMany({ where: { onuId: row.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "inform");
    assert.equal(logs[0].result, "Success");
    assert.equal(logs[0].payloadHash, payloadHash(inform), "the Inform is fingerprinted");

    const asText = JSON.stringify(logs);
    assert.ok(!asText.includes("Huawei"), "the log holds the hash, not the body it hashed");
  });

  test("a serial is required", async () => {
    await assert.rejects(() => recordInform({ serialNo: "   " }), /serial/i);
  });
});

describe("the ACS endpoint", () => {
  async function post(body, headers = {}) {
    return acsInform(
      new Request("http://localhost/api/acs/inform", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
    );
  }

  test("a correct secret registers the device", async () => {
    const serialNo = makeSerial(9101);
    const res = await post(buildInform({ serialNo }), { authorization: `Bearer ${SECRET}` });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.created, true);
    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);
    assert.equal(row.status, "Provisioning");
    assert.equal(row.vendor, "Huawei");
  });

  test("the CPE's own field names are accepted", async () => {
    const serialNo = makeSerial(9102);
    const res = await post(buildInform({ serialNo, serialKey: "SerialNumber" }), {
      authorization: `Bearer ${SECRET}`,
    });
    assert.equal(res.status, 200, "a device that spells it SerialNumber is still a device");
    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);
  });

  test("no secret is refused", async () => {
    const res = await post(buildInform({ serialNo: makeSerial(9103) }));
    assert.equal(res.status, 401);
  });

  test("a wrong secret is refused", async () => {
    const res = await post(buildInform({ serialNo: makeSerial(9104) }), {
      authorization: "Bearer not-the-secret",
    });
    assert.equal(res.status, 401);
    assert.equal(
      await prisma.onu.count({ where: { serialNo: makeSerial(9104) } }),
      0,
      "and creates nothing"
    );
  });

  test("a secret of the wrong length is refused without a length oracle", async () => {
    // `timingSafeEqual` throws on a length mismatch, so the route compares lengths
    // first — which leaks only the length, never a byte of the value.
    const res = await post(buildInform({ serialNo: makeSerial(9105) }), {
      authorization: `Bearer ${SECRET.slice(0, 5)}`,
    });
    assert.equal(res.status, 401);
  });

  test("the x-acs-secret header is accepted too", async () => {
    const serialNo = makeSerial(9106);
    const res = await post(buildInform({ serialNo }), { "x-acs-secret": SECRET });
    assert.equal(res.status, 200);
    const row = await prisma.onu.findUniqueOrThrow({ where: { serialNo } });
    created.onus.push(row.id);
  });

  test("switched off, it refuses rather than accepting silently", async () => {
    await armAdapter(false);
    const serialNo = makeSerial(9107);
    const res = await post(buildInform({ serialNo }), { authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 503, "a device told 2xx would never come back");
    assert.match((await res.json()).error, /switched off/);
    assert.equal(await prisma.onu.count({ where: { serialNo } }), 0);
  });

  test("with no secret configured at all, nothing is accepted", async () => {
    // The important one: an empty setting must not become an empty shared secret,
    // or the first device on the internet could register itself.
    await saveSettings([{ key: "tr069.acsSecret", value: "" }]);
    invalidateSettingsCache();
    const res = await post(buildInform({ serialNo: makeSerial(9108) }));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not configured/);
    assert.equal(await prisma.onu.count({ where: { serialNo: makeSerial(9108) } }), 0);
  });

  test("an Inform with no serial is a 400, not a 500", async () => {
    const res = await post({ vendor: "Huawei" }, { authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 400);
  });

  test("a body that is not JSON is a 400", async () => {
    const res = await acsInform(
      new Request("http://localhost/api/acs/inform", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: "this is not json",
      })
    );
    assert.equal(res.status, 400);
  });

  test("the Inform the fake CPE sends is the awkward one, on purpose", () => {
    // The route's tolerance is the point, so the mock must exercise it rather
    // than sending the shape the app happens to prefer.
    const inform = buildInform({ serialNo: "HWTC1", serialKey: "SerialNumber" });
    assert.equal(inform.SerialNumber, "HWTC1");
    assert.equal(inform.Vendor, "Huawei");
    assert.equal(inform.Model, "MA5800-X7");
    assert.ok("OLTID" in inform && "PONPort" in inform, "CWMP spellings, not ours");
  });

  test("the inform helper needs a reachable ACS and says so", async () => {
    // Port 1 is not listening. The helper must reject rather than return a
    // fabricated status, or a test could pass against a server that never
    // answered.
    await assert.rejects(() =>
      cpe.inform({ acs: "http://127.0.0.1:1", secret: SECRET, serialNo: makeSerial(9109) })
    );
    await assert.rejects(
      () => cpe.inform({ secret: SECRET, serialNo: "X" }),
      /needs an `acs` base URL/
    );
  });
});

describe("configuring a device", () => {
  test("assigning a serial pushes PPPoE access and the WiFi template", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });

    const result = await provisionOnuForCustomer(customer.id);

    assert.equal(result.ok, true, result.detail);
    created.actions.push(result.actionId);

    const config = cpe.lastConfig();
    assert.ok(config, "the device was given something");
    assert.equal(config.pppoeUsername, customer.username);
    assert.equal(config.pppoePassword, customer.password);
    assert.equal(config.vlanId, "100");
    assert.equal(config.wifiSsid, `isp-${customer.username}`);
    assert.equal(config.wifiEnabled, true);
    assert.equal(config.wifiChannel, 6);
  });

  test("nothing about the password reaches the log", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id, password: `ppp-${STAMP}-verysecret` });
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    const logs = await readLogFor(onu.serialNo);
    assert.ok(logs.length >= 1);
    const push = logs.find((l) => l.action === "pushConfig");
    assert.ok(push, "the push was logged");
    assert.equal(push.result, "Success");
    assert.ok(push.payloadHash, "by hash");

    // The whole table, not just this device's rows.
    const table = await prisma.tr069Log.findMany();
    const dump = JSON.stringify(table);
    assert.ok(!dump.includes(customer.password), "no plaintext PPPoE password anywhere in Tr069Log");
    assert.ok(!dump.includes("verysecret"));
    assert.ok(!dump.includes("pppoePassword"), "and not the key name either");
    assert.ok(!("payload" in (table[0] ?? {})), "the row has no payload field to leak");
  });

  test("a successful push takes the device out of Provisioning", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    assert.equal(result.ok, true);
    const row = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });
    assert.equal(row.status, "Online", "a configured device is not a provisioning problem");
  });

  test("the action is written before the device is called", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(row.status, "Done");
    assert.equal(row.action, "onuConfigure");
    assert.equal(row.username, onu.serialNo, "the serial is what a retry can reach the device by");
    assert.equal(row.routerId, null, "and it is not a router action");
    assert.equal(
      row.payload,
      null,
      "no payload on the outbox: a retry rebuilds it from the customer's current password"
    );
    assert.ok(row.attempts >= 1);
  });

  test("a customer with no ONU is told what to do, not silently skipped", async () => {
    const customer = await makeCustomer();
    const result = await provisionOnuForCustomer(customer.id);
    assert.equal(result.ok, false);
    assert.match(result.detail, /no ONU linked/);
  });

  test("with TR-069 off, nothing is sent", async () => {
    await armAdapter(false);
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    const result = await provisionOnuForCustomer(customer.id);
    assert.equal(result.ok, false);
    assert.match(result.detail, /switched off/);
    assert.equal(cpe.calls().length, 0, "the device was not contacted");
  });

  test("a customer with no PPPoE password fails loudly and is not retried", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id, password: null });
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    assert.equal(result.ok, false);
    assert.match(result.detail, /no PPPoE password/);
    assert.equal(cpe.calls().length, 0, "a blank password is not worth sending");

    const row = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(
      row.status,
      "Failed",
      "terminal: ten retries over hours will not invent a password, and a person has to"
    );

    const logs = await readLogFor(onu.serialNo);
    assert.equal(logs.filter((l) => l.result === "Failure").length, 1);
  });
});

describe("when a device will not answer", () => {
  test("a refused push is logged, queued, and leaves the device row alone", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });

    const before = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });

    cpe.rejectNext(true);
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    assert.equal(result.ok, false, "reported honestly as a failure");
    assert.equal(result.queued, true, "and queued for another attempt");

    const push = (await readLogFor(onu.serialNo)).find((l) => l.action === "pushConfig");
    assert.ok(push, "the attempt is in the log");
    assert.equal(push.result, "Failure");
    assert.match(push.detail, /500/, "with the device's own answer");
    assert.ok(push.actionId === result.actionId, "pointing at the outbox row");

    const action = await prisma.networkAction.findUniqueOrThrow({ where: { id: result.actionId } });
    assert.equal(action.status, "Pending", "Pending, never Failed: Failed is terminal and unretried");
    assert.ok(action.attempts >= 1);
    assert.ok(action.lastError, "and it says why");

    const after = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });
    assert.equal(after.status, before.status, "the device is still Provisioning, not falsely Online");
    assert.deepEqual(
      { oltId: after.oltId, ponIndex: after.ponIndex },
      { oltId: before.oltId, ponIndex: before.ponIndex },
      "and nothing else about it moved"
    );
  });

  test("the retry job pushes it again, and it succeeds", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });

    cpe.rejectNext(true);
    const first = await provisionOnuForCustomer(customer.id);
    created.actions.push(first.actionId);
    assert.equal(first.ok, false);

    // Clear the backoff the failure just set, the way the real retry job finds it
    // due. The ladder itself belongs to Phase A and is not re-tested here.
    await prisma.networkAction.update({
      where: { id: first.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    const stats = await retryPendingNetworkActions();

    const action = await prisma.networkAction.findUniqueOrThrow({ where: { id: first.actionId } });
    assert.equal(action.status, "Done", "the retry went through the same queue and worked");
    assert.equal(action.lastError, null);

    const row = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });
    assert.equal(row.status, "Online");

    // `readLogFor` is newest-first, so the successful retry is [0].
    const pushes = (await readLogFor(onu.serialNo)).filter((l) => l.action === "pushConfig");
    assert.equal(pushes.length, 2, "one failure and one success, both logged");
    assert.equal(pushes[0].result, "Success", "newest first: the retry");
    assert.equal(pushes[1].result, "Failure", "and the original attempt before it");
    assert.equal(
      pushes[0].payloadHash,
      pushes[1].payloadHash,
      "the retry rebuilt the identical config, which is what the hash is for"
    );
    assert.deepEqual(
      pushes.map((p) => p.actionId).filter(Boolean),
      [first.actionId, first.actionId],
      "both attempts point at the one outbox row, so a support agent can follow it"
    );
    assert.ok(stats.done >= 1);
  });

  test("a retry uses the password the customer has now, not the one they had", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id, password: `old-${STAMP}` });

    cpe.rejectNext(true);
    const first = await provisionOnuForCustomer(customer.id);
    created.actions.push(first.actionId);

    // The password changes while the device is unreachable.
    await prisma.customer.update({
      where: { id: customer.id },
      data: { password: `new-${STAMP}` },
    });

    await prisma.networkAction.update({
      where: { id: first.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });
    await retryOnuConfigure({ id: first.actionId });

    const config = cpe.lastConfig();
    assert.equal(config.pppoePassword, `new-${STAMP}`);
    assert.notEqual(
      config.pppoePassword,
      `old-${STAMP}`,
      "the device should end up with the credential that works now, not the one that was wrong"
    );
  });

  test("an ONU action is never handed to a router", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    cpe.rejectNext(true);
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    await prisma.networkAction.update({
      where: { id: result.actionId },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    });
    await retryPendingNetworkActions();

    // Every operation the device saw was a device operation. A router would have
    // been contacted on the router's own port with a PPPoE username.
    assert.deepEqual(
      [...new Set(cpe.calls().map((c) => c.op))],
      ["config"],
      "the adapter spoke to the CPE and to nothing else"
    );
  });
});

describe("the configuration itself", () => {
  test("the SSID carries the username, capped at what a device can hold", () => {
    assert.equal(buildSsid("isp-{username}", "rahim100"), "isp-rahim100");
    assert.equal(buildSsid("{username}-wifi", "rahim100"), "rahim100-wifi");
    assert.equal(buildSsid("plain", "rahim100"), "plain");
    assert.equal(buildSsid("isp-{username}", ""), "isp-guest", "a blank username still gives a name");
    const long = buildSsid("isp-{username}", "x".repeat(60));
    assert.equal(long.length, 32, "a device truncates a longer SSID silently, and the customer then cannot find it");
  });

  test("the WiFi password is derived, never stored", () => {
    const secret = "acs-secret";
    // Same inputs, same password — support can read it back to a customer without
    // reading anything out of the database.
    assert.equal(
      wifiPassword("derived", "HWTC1", "ppp", secret),
      wifiPassword("derived", "HWTC1", "ppp", secret)
    );
    assert.notEqual(
      wifiPassword("derived", "HWTC1", "ppp", secret),
      wifiPassword("derived", "HWTC2", "ppp", secret),
      "and different per device"
    );
    assert.equal(
      wifiPassword("derived", "HWTC1", "ppp", secret).length,
      20,
      "80 bits, and the longest key that stays typable"
    );
    // Changing the shared secret changes every key, which is the correct blast
    // radius: so does every WiFi device.
    assert.notEqual(
      wifiPassword("derived", "HWTC1", "ppp", secret),
      wifiPassword("derived", "HWTC1", "ppp", "rotated")
    );
    // The default reuses the PPPoE password, so the customer has one credential.
    assert.equal(wifiPassword("pppoe", "HWTC1", "ppp", secret), "ppp");
    // An unrecognised policy must not leave a customer with no WiFi.
    assert.equal(wifiPassword("something-else", "HWTC1", "ppp", secret), "ppp");
    assert.equal(wifiPassword("derived", "HWTC1", "ppp", ""), "ppp", "no secret means no HMAC key");
  });

  test("the hash does not depend on key order", () => {
    assert.equal(
      payloadHash({ a: 1, b: 2, c: { d: 3, e: 4 } }),
      payloadHash({ c: { e: 4, d: 3 }, b: 2, a: 1 })
    );
    assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
    assert.match(payloadHash({ a: 1 }), /^[0-9a-f]{64}$/);
  });

  test("a config without a password is refused rather than built", () => {
    const template = { vlanId: "100", wifiSsidPattern: "isp-{username}", wifiPasswordPolicy: "pppoe" };
    assert.throws(
      () => buildConfig({ serialNo: "S1", username: "u", pppoePassword: null, template, acsSecret: "" }),
      /no PPPoE password/
    );
    assert.throws(
      () => buildConfig({ serialNo: "S1", username: "u", pppoePassword: "   ", template, acsSecret: "" }),
      /no PPPoE password/,
      "whitespace is not a password"
    );
    const ok = buildConfig({
      serialNo: "S1",
      username: "u",
      pppoePassword: "p",
      template,
      acsSecret: "",
    });
    assert.equal(ok.wifiSsid, "isp-u");
  });

  test("the settings are read with no secret ever defaulted", () => {
    const empty = readTr069Settings({});
    assert.equal(empty.secret, "", "no default: an empty secret would accept anything");
    assert.equal(empty.enabled, false, "and off unless an operator turns it on");
    assert.equal(empty.vlanId, "100");
    assert.equal(empty.timeoutSeconds, 20);

    const bad = readTr069Settings({ "tr069.provisionTimeoutSec": "banana" });
    assert.equal(bad.timeoutSeconds, 20, "a non-number is not NaN, which would make every call hang");

    const on = readTr069Settings({ "tr069.enabled": "true", "tr069.acsSecret": "s" });
    assert.equal(on.enabled, true);
    assert.equal(on.secret, "s");
  });

  test("with no device API configured, the adapter says so and is labelled simulated", async () => {
    await saveSettings([{ key: "tr069.deviceApiUrl", value: "" }]);
    invalidateSettingsCache();
    const adapter = await tr069Adapter();
    assert.equal(adapter.live, false, "nothing may report a simulated push as a real one");
    assert.match(adapter.name, /Simulated/);
    const outcome = await adapter.pushConfig({ serialNo: "S1" }, {});
    assert.equal(outcome.ok, false);
    assert.match(outcome.detail, /no tr-069 device api is configured/i);
  });

  test("a configured adapter is labelled live", async () => {
    const adapter = await tr069Adapter();
    assert.ok(adapter instanceof HttpTr069Adapter);
    assert.equal(adapter.live, true);
  });
});

describe("what the log is for", () => {
  test("it answers 'did we try, and was it the same attempt', and nothing more", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    const first = await provisionOnuForCustomer(customer.id);
    created.actions.push(first.actionId);
    const second = await provisionOnuForCustomer(customer.id);
    created.actions.push(second.actionId);

    const logs = await readLogFor(onu.serialNo);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].result, "Success");
    assert.equal(logs[1].result, "Success");
    assert.equal(
      logs[0].payloadHash,
      logs[1].payloadHash,
      "identical configuration, identical fingerprint"
    );
    assert.ok(logs[0].detail, "and a human sentence saying what happened");
  });

  test("the log survives the ONU row being deleted", async () => {
    const onu = await makeOnu();
    const customer = await makeCustomer({ onuId: onu.id });
    const result = await provisionOnuForCustomer(customer.id);
    created.actions.push(result.actionId);

    await prisma.customer.deleteMany({ where: { id: customer.id } });
    created.customers = created.customers.filter((id) => id !== customer.id);
    await prisma.onu.delete({ where: { id: onu.id } });
    created.onus = created.onus.filter((id) => id !== onu.id);

    const logs = await prisma.tr069Log.findMany({ where: { serialNo: onu.serialNo } });
    assert.equal(logs.length, 1, "a decommissioned device's history is exactly the part worth keeping");
    assert.equal(logs[0].onuId, null, "the reference goes; the serial is the device's own identity");
  });
});
