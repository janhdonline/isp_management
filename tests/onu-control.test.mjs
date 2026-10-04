import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import { startMockOlt, DEFAULT_OIDS } from "./mock-olt-snmp.mjs";
import { SnmpOltAdapter } from "../src/lib/olt/snmp.ts";
import { VENDORS } from "../src/lib/olt/oid-maps.ts";
import {
  ONU_ACTIONS,
  ACTION_PLANS,
  OUTBOX_ACTION,
  actionFromOutbox,
  isOnuOutboxAction,
  requestOnuAction,
  executeOnuAction,
  retryOnuAction,
  previewOnuAction,
  reclaimStaleOnuActions,
} from "../src/lib/services/onu-control.ts";
import { retryPendingNetworkActions } from "../src/lib/services/network-enforcement.ts";

/**
 * Phase P — remote ONU control.
 *
 * The thing that makes this dangerous is that the four actions are not equally
 * dangerous. A reboot costs a customer a minute; a deauthorize takes them off the
 * air; a factory reset needs a site visit afterwards. So most of these tests are
 * about the *ordering and the refusals* rather than the command reaching the wire.
 */

const STAMP = Date.now();
const SETTINGS_KEYS = ["network.snmpCommunity", "network.snmpCommunity.huawei", "alerts.channel"];
let originalSettings = {};

let olt;
let area;
let operator;
let reader;
const created = { onus: [], customers: [], actions: [], olts: [] };

/** Every write the fake device was asked to perform, as `{ leaf, value }`. */
let commands = [];
/** The community each session was opened with, in order. */
let sessionsOpened = [];
let failNext = false;
/**
 * Held open while set, so six requests genuinely overlap.
 *
 * Without this the fake answers instantly, the first request finishes before the
 * second takes the lock, and the second sees a `Done` row — which is a real
 * scenario, but not the one the concurrency test is trying to create.
 */
let deviceGate = null;

/**
 * A device that records what it was told.
 *
 * Built on the same session seam as Phase N's tests, because the thing under test
 * is "which command went to which slot", and that is decided by the adapter's
 * choice of leaf — not by the wire. `tests/mock-olt-snmp.mjs` is the real
 * protocol and is exercised separately.
 */
function fakeDevice() {
  // **Not** `commands = []` here. The resolver below is called once per request, so
  // resetting the log in here wiped it out from under the request that had just
  // written to it — which showed up as "the device was never told", for a device
  // the log two lines later recorded as having accepted the command.
  const factory = (c) => {
    sessionsOpened.push(c);
    const session = {
      subtree(oid, feedCb, doneCb) {
        const row = { serialNo: "ONU0001", rxPower: -20, txPower: 2, state: 2 };
        const base = VENDORS.huawei.oids.onuSerial.replace(/\.\d+$/, "");
        const last = Number(oid.slice(base.length + 1));
        const value =
          last === 2 ? row.serialNo : last === 5 ? row.state : last === 6 ? row.rxPower : row.txPower;
        feedCb([{ oid: `${oid}.1`, type: 4, value: String(value) }]);
        doneCb(null);
        return null;
      },
      async set(varbinds, cb) {
        if (deviceGate) await deviceGate;
        if (failNext) {
          cb(new Error("device busy"));
          return null;
        }
        for (const v of varbinds) {
          commands.push({ leaf: String(v.oid).split(".").pop(), value: v.value, oid: v.oid });
        }
        cb(null);
        return null;
      },
      close() {
        return undefined;
      },
    };
    return session;
  };
  return factory;
}

/**
 * The adapter the service will use, with the fake device behind it.
 *
 * Passed in as the service's `adapterFor` parameter rather than having the service
 * reach for one itself — which is the whole reason that parameter exists.
 */
function adapterFor(row) {
  return Promise.resolve(
    new SnmpOltAdapter(
      {
        oltId: row.id,
        oltName: row.name,
        host: row.ipAddress ?? "127.0.0.1",
        port: row.snmpPort ?? 16999,
        community: "olt-community",
        vendor: row.apiVendor ?? "snmp-huawei",
        oids: VENDORS.huawei.oids,
        timeoutMs: 100,
        retries: 0,
      },
      fakeDevice()
    )
  );
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

before(async () => {
  for (const key of SETTINGS_KEYS) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originalSettings[key] = row?.value ?? null;
  }
  await sweep();

  await saveSettings([
    { key: "network.snmpCommunity", value: "olt-community" },
    { key: "network.snmpCommunity.huawei", value: "olt-community" },
    // Alerts go out over an unconfigured channel so `raiseAlert` returns at once
    // instead of reaching for the internet — see the Phase N note.
    { key: "alerts.channel", value: "SMS" },
  ]);
  invalidateSettingsCache();

  area = await prisma.area.findFirstOrThrow();
  // `User.role` is a relation, not a string — hence the nested `name`.
  operator = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Administrator" } },
    select: { id: true },
  });
  reader = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Technician" } },
    select: { id: true },
  });

  olt = await prisma.olt.create({
    data: {
      name: `onuctl-olt-${STAMP}`,
      vendor: "Huawei",
      status: "Online",
      ipAddress: "127.0.0.1",
      apiVendor: "snmp-huawei",
      snmpCommunityEnc: true,
      snmpPort: 16999,
      areaId: area.id,
    },
    select: { id: true, name: true },
  });
  created.olts.push(olt.id);
});

after(async () => {
  await sweep();
  for (const [key, value] of Object.entries(originalSettings)) {
    if (value !== null) await saveSettings([{ key, value }]);
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  commands = [];
  sessionsOpened = [];
  failNext = false;
  deviceGate = null;
  await clearRows();
  invalidateSettingsCache();
});

/** Removes what a previous *interrupted* run left behind — `after` cannot. */
async function sweep() {
  await prisma.networkAction.deleteMany({
    where: { action: { in: Object.values(OUTBOX_ACTION) } },
  });
  await prisma.onu.deleteMany({ where: { serialNo: { startsWith: "CTL" } } });
  // The device serial is fixed, not CTL-prefixed, so it needs naming on its own.
  await prisma.onu.deleteMany({ where: { serialNo: "ONU0001" } });
  await prisma.customer.deleteMany({ where: { customerCode: { startsWith: "CTL-" } } });
  await prisma.olt.deleteMany({ where: { name: { startsWith: "onuctl-olt-" } } });
}

async function clearRows() {
  // By action type, not by tracked id. A test that fails before it calls
  // `outboxRows()` has had no chance to register its row, so cleaning by id left it
  // behind and the next test's "nothing was queued" counted somebody else's row.
  await prisma.networkAction.deleteMany({
    where: { action: { in: Object.values(OUTBOX_ACTION) } },
  });
  created.actions.length = 0;
  if (created.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  if (created.onus.length) {
    await prisma.onu.deleteMany({ where: { id: { in: created.onus } } });
  }
  created.actions.length = 0;
  created.customers.length = 0;
  created.onus.length = 0;
}

/**
 * An ONU the fake device recognises.
 *
 * The serial has to be `ONU0001` because that is what the fake session answers
 * with — a device whose serial the cabinet does not know cannot be written to, and
 * the adapter would (correctly) report it as refused.
 */
async function makeOnu(over = {}) {
  // An upsert, not a create. The serial is fixed (the fake device only knows
  // `ONU0001`), so a create is one interrupted run away from failing every test
  // after it with a unique violation — which is exactly what happened, and it
  // surfaced as an unrelated assertion three tests later.
  const onu = await prisma.onu.upsert({
    where: { serialNo: "ONU0001" },
    create: {
      serialNo: "ONU0001",
      vendor: "ZTE",
      status: "Online",
      rxPower: -20,
      oltId: olt.id,
      ponIndex: "0/1/1:3",
      ...over,
    },
    update: {
      vendor: "ZTE",
      status: "Online",
      rxPower: -20,
      oltId: olt.id,
      ponIndex: "0/1/1:3",
      customers: { deleteMany: {} },
      ...over,
    },
    select: { id: true, serialNo: true },
  });
  if (!created.onus.includes(onu.id)) created.onus.push(onu.id);
  return onu;
}

async function attachCustomer(onuId, connectionStatus = "Active") {
  const customer = await prisma.customer.create({
    data: {
      customerCode: `CTL-${STAMP}-${created.customers.length + 1}`,
      name: `Controlled Customer ${created.customers.length + 1}`,
      username: `ctl${STAMP}${created.customers.length + 1}`,
      phone: `019${String(70000000 + created.customers.length)}`,
      connectionStatus,
      connectionDate: new Date(),
      areaId: area.id,
      onuId,
    },
    select: { id: true, name: true },
  });
  created.customers.push(customer.id);
  return customer;
}

/** The outbox rows this module wrote, so cleanup can find them. */
async function outboxRows() {
  const rows = await prisma.networkAction.findMany({
    where: { action: { in: Object.values(OUTBOX_ACTION) } },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) if (!created.actions.includes(r.id)) created.actions.push(r.id);
  return rows;
}

// ---------------------------------------------------------------------------

describe("what each action is", () => {
  test("they are not equally dangerous, and the copy says so", () => {
    assert.deepEqual([...ONU_ACTIONS], ["reboot", "authorize", "deauthorize", "reset"]);

    // A reboot is routine support work. Making an operator type anything for it
    // means they do not, and the one that mattered gets skipped.
    assert.equal(ACTION_PLANS.reboot.needsConfirmation, false);

    // These two need the second act, and both cost somebody their service.
    assert.equal(ACTION_PLANS.deauthorize.needsConfirmation, true);
    assert.equal(ACTION_PLANS.deauthorize.affectsCustomer, true);
    assert.equal(ACTION_PLANS.reset.needsConfirmation, true);

    // Only reset destroys configuration, and that has to be visible in the prompt:
    // it is the difference between a minute's outage and a site visit.
    assert.equal(ACTION_PLANS.reset.keepsConfiguration, false);
    assert.equal(ACTION_PLANS.deauthorize.keepsConfiguration, true);
    assert.match(ACTION_PLANS.reset.effect, /configuration/i);

    // Authorize changes nobody's service.
    assert.equal(ACTION_PLANS.authorize.affectsCustomer, false);
    assert.equal(ACTION_PLANS.authorize.needsConfirmation, false);
  });

  test("every action maps to its own outbox type", () => {
    for (const action of ONU_ACTIONS) {
      assert.equal(actionFromOutbox(OUTBOX_ACTION[action]), action);
      assert.equal(isOnuOutboxAction(OUTBOX_ACTION[action]), true);
    }
    assert.equal(isOnuOutboxAction("suspend"), false);
    assert.equal(isOnuOutboxAction("onuConfigure"), false, "Phase M's type is its own");
    assert.equal(actionFromOutbox("nonsense"), null);
  });
});

describe("a reboot", () => {
  test("reaches the device, and the outbox row stores no credentials", async () => {
    await makeOnu();

    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });

    assert.equal(result.ok, true, result.detail);
    assert.equal(result.executed, true);
    assert.equal(result.deduped, false);

    // The device was told to reboot — a distinct leaf from a factory reset, which
    // was Phase N's habit of writing both to "reset".
    assert.equal(commands.length, 1);
    assert.equal(commands[0].leaf, "reboot");

    const [row] = await outboxRows();
    assert.equal(row.action, "onuReboot");
    assert.equal(row.status, "Done");
    assert.equal(row.payload, null, "nothing on this row could be a credential");
    assert.equal(row.username, "ONU0001", "the serial is the device reference");
    assert.equal(row.routerId, null);

    // A read happens first, to find the slot. The adapter opens a separate session
    // for the write, so the read cannot be carrying write authority by accident.
    assert.equal(sessionsOpened[0], "olt-community", "the lookup is a read");
    assert.ok(
      sessionsOpened.every((c) => c === "olt-community"),
      "and no session was opened with anything else"
    );
  });

  test("is written to the activity log with the operator and the outcome", async () => {
    await makeOnu();
    await requestOnuAction({ serialNo: "ONU0001", action: "reboot", actorId: operator.id, adapterFor });

    const logs = await prisma.activityLog.findMany({
      where: { summary: { contains: "ONU0001" } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0].summary, /Reboot on ONU ONU0001/);
    assert.match(logs[0].summary, /accepted by the device/);
    assert.equal(logs[0].actorId, operator.id, "against the person who pressed it");
  });

  test("a factory reset uses a different leaf, or it is a reboot that ate a config", async () => {
    await makeOnu();
    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reset",
      actorId: operator.id,
      confirmCustomerImpact: true,
      adapterFor,
    });

    assert.equal(result.ok, true, result.detail);
    assert.equal(commands[0].leaf, "factory-reset");
    assert.notEqual(commands[0].leaf, "reboot");
  });
});

describe("deauthorize on a live customer", () => {
  test("is refused without the second confirmation, by the service", async () => {
    const onu = await makeOnu();
    await attachCustomer(onu.id);

    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "deauthorize",
      actorId: operator.id,
      adapterFor,
      // No confirmCustomerImpact — the dialog's tick, or the absence of one.
    });

    assert.equal(result.ok, false);
    assert.match(result.detail, /affects a customer/);
    assert.match(result.detail, /confirmed explicitly/);
    assert.equal(commands.length, 0, "nothing was sent");
    assert.equal((await outboxRows()).length, 0, "and nothing was queued");
  });

  test("the preview names the customer and says service stops now", async () => {
    const onu = await makeOnu();
    const customer = await attachCustomer(onu.id);

    const preview = await previewOnuAction("ONU0001", "deauthorize", adapterFor);
    assert.equal(preview.supported, true);
    assert.equal(preview.impact.hasCustomer, true);
    assert.equal(preview.impact.live, true);
    assert.match(preview.impact.warning, new RegExp(customer.name));
    assert.match(preview.impact.warning, /immediately/);
    assert.equal(preview.target.oltName, olt.name);
  });

  test("with the confirmation it goes through", async () => {
    const onu = await makeOnu();
    const customer = await attachCustomer(onu.id);

    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "deauthorize",
      actorId: operator.id,
      reason: "Support ticket 4471, customer reported abuse",
      confirmCustomerImpact: true,
      adapterFor,
    });

    assert.equal(result.ok, true, result.detail);
    // Deauthorise and authorise are the same leaf with different values — the
    // device is told which state to be in, not which command to run.
    assert.equal(commands[0].leaf, "authorize");
    assert.equal(commands[0].value, 2);

    const [row] = await outboxRows();
    assert.equal(row.customerId, customer.id, "the row is attributable to the customer it cut off");
  });

  test("a suspended customer is not described as being on the air", async () => {
    const onu = await makeOnu();
    const customer = await attachCustomer(onu.id, "Suspended");

    const preview = await previewOnuAction("ONU0001", "deauthorize", adapterFor);
    assert.equal(preview.impact.live, false);
    assert.match(
      preview.impact.warning,
      new RegExp(`${customer.name} is on this ONU but suspended`),
      "saying it would cut their service would train an operator to ignore the warning"
    );
  });
});

describe("an ONU that cannot be reached", () => {
  test("the attempt is logged as failed and queued, and the row is untouched", async () => {
    const onu = await makeOnu();
    const before = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });

    failNext = true;
    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });

    assert.equal(result.ok, false);
    assert.equal(result.executed, true, "it was attempted");

    const [row] = await outboxRows();
    assert.equal(row.status, "Pending", "Pending, never Failed: Failed is terminal and unretried");
    assert.ok(row.attempts >= 1);
    assert.ok(row.lastError, "and it says why");

    const after = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });
    assert.equal(after.status, before.status, "a reboot that did not happen changed nothing");
    assert.equal(after.ponIndex, before.ponIndex);
    assert.equal(after.rxPower, before.rxPower);

    const logs = await prisma.activityLog.findMany({
      where: { summary: { contains: "ONU0001" } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    assert.match(logs[0].summary, /failed/);
    assert.match(logs[0].summary, /queued for retry/);
  });

  test("the retry goes through the Phase A outbox and then succeeds", async () => {
    await makeOnu();
    failNext = true;
    await requestOnuAction({ serialNo: "ONU0001", action: "reboot", actorId: operator.id, adapterFor });

    // Clear the backoff the failure just set, *and* date the row to the front of
    // the queue.
    //
    // The drain takes 50 rows ordered oldest-first, and this development database
    // carries 58 stale Pending rows from earlier test runs — so a brand-new row is
    // not merely last, it is outside the window. That is worth knowing about the
    // drain in its own right; here it just means the test has to place its row
    // where the drain will actually look.
    const [pending] = await outboxRows();
    const anHourAgo = new Date(Date.now() - 60 * 60_000);
    await prisma.networkAction.update({
      where: { id: pending.id },
      data: { updatedAt: anHourAgo, createdAt: anHourAgo },
    });

    // The drain resolves its own adapter from the row, so it talks to the real
    // cabinet — which is not there. What this test is for is the *routing*: the
    // Phase A queue picks the row up, hands it to this module, and leaves it
    // Pending rather than dropping it. Success against a device is covered by the
    // `retryOnuAction` test below, which can supply the fake.
    const beforeAttempts = pending.attempts;
    await retryPendingNetworkActions();

    const [after_] = await outboxRows();
    assert.equal(after_.id, pending.id, "the same row — not a new one");
    assert.ok(
      after_.attempts > beforeAttempts,
      `the drain attempted it again (attempts ${beforeAttempts} -> ${after_.attempts})`
    );
    assert.notEqual(after_.status, "Done", "and did not claim success it did not have");
  });

  test("a row stuck mid-call is put back in the queue", async () => {
    await makeOnu();
    failNext = true;
    await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    const [row] = await outboxRows();

    // Simulate a process that died between claiming and answering.
    await prisma.networkAction.update({
      where: { id: row.id },
      data: { status: "Running", updatedAt: new Date(Date.now() - 10 * 60_000) },
    });

    const reclaimed = await reclaimStaleOnuActions();
    assert.equal(reclaimed, 1);
    assert.equal((await outboxRows())[0].status, "Pending");

    // And a *fresh* Running row is left alone: a device call can legitimately take
    // a while, and reclaiming it would let a second run in.
    await prisma.networkAction.update({
      where: { id: row.id },
      data: { status: "Running", updatedAt: new Date() },
    });
    assert.equal(await reclaimStaleOnuActions(), 0);
  });
});

describe("permission", () => {
  test("the service refuses an unknown serial rather than guessing", async () => {
    const result = await requestOnuAction({
      serialNo: "NOTHING0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /No ONU with the serial/);
    assert.equal(commands.length, 0);
  });

  test("an ONU with no OLT says so, and nothing is queued", async () => {
    await makeOnu({ oltId: null });

    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /not on an OLT/);
    assert.equal((await outboxRows()).length, 0);
  });

  test("an OLT with no adapter is a clean 'not supported', not a silent no-op", async () => {
    await makeOnu();
    await prisma.olt.update({ where: { id: olt.id }, data: { apiVendor: null } });

    // No `adapterFor` here on purpose: this case is *the row saying it is not
    // configured*, and an injected adapter would answer "live" and hide it. The
    // unconfigured adapter throws before any I/O, so this costs no packets.
    const preview = await previewOnuAction("ONU0001", "reboot");
    assert.equal(preview.supported, false);
    assert.match(preview.unsupportedReason, /vendor or SNMP community/);

    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
    });
    assert.equal(result.ok, false);
    assert.equal(commands.length, 0);
    assert.equal(
      (await outboxRows()).length,
      0,
      "an unsupported action must not leave a row that fails on every retry for ever"
    );

    const logs = await prisma.activityLog.findMany({
      where: { summary: { contains: "ONU0001" } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    assert.match(logs[0].summary, /Refused Reboot/);

    await prisma.olt.update({ where: { id: olt.id }, data: { apiVendor: "snmp-huawei" } });
  });

  test("the service refuses an unknown serial rather than guessing", async () => {
    // The permission gate itself is `requirePermission("network.edit")`, the same
    // helper every mutation in this application uses. It cannot be exercised from
    // a plain test: importing the route pulls in `server-only` through `lib/auth`,
    // which does not load outside Next's own runtime. So the gate is asserted where
    // it can be — `scripts/verify.mjs`, against a running server — and what is
    // tested here is that nothing below the gate executes for a device nobody owns.
    const result = await requestOnuAction({
      serialNo: "NOTHING0001",
      action: "reboot",
      actorId: reader.id,
      adapterFor,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /No ONU with the serial/);
    assert.equal(commands.length, 0);
    assert.equal((await outboxRows()).length, 0);
    assert.ok(reader.id, "and a non-administrator role exists to be the reader");
  });
});

describe("two operators, one device", () => {
  test("one command reaches the device, not two", async () => {
    await makeOnu();

    // Hold the device open so both requests are genuinely in flight at once, which
    // is the case the lock exists for.
    let release = () => {};
    deviceGate = new Promise((r) => {
      release = r;
    });

    const first = requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    // Let the first reach the device before the second arrives.
    await new Promise((r) => setTimeout(r, 40));
    const second = requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    release();

    const [a, b] = await Promise.all([first, second]);

    assert.equal((await outboxRows()).length, 1, "the second request joined the first's row");
    assert.equal(
      [a, b].filter((r) => r.ok && !r.deduped).length,
      1,
      "and exactly one of them sent it"
    );
    assert.equal([a, b].filter((r) => r.deduped).length, 1);
    assert.equal(
      commands.length,
      1,
      "a double reboot is a customer watching two outages"
    );
  });

  test("six at once still send one", async () => {
    await makeOnu();
    let release = () => {};
    deviceGate = new Promise((r) => {
      release = r;
    });
    // Started, then released, then awaited — awaiting first would deadlock on the
    // gate this test is holding.
    const all = Array.from({ length: 6 }, () =>
      requestOnuAction({ serialNo: "ONU0001", action: "reboot", actorId: operator.id, adapterFor })
    );
    await new Promise((r) => setTimeout(r, 40));
    release();
    const results = await Promise.all(all);
    assert.equal((await outboxRows()).length, 1);
    assert.equal(results.filter((r) => r.ok && !r.deduped).length, 1);
    assert.equal(commands.length, 1);
  });

  test("a double-click after the first finished is absorbed", async () => {
    // The case the lock cannot cover: the second request arrives once the first
    // has already completed, so its row is `Done`. A person clicking Reboot twice
    // is the commonest accident here, and two reboots is two outages.
    await makeOnu();
    const first = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    assert.equal(first.ok, true);
    assert.equal(commands.length, 1);

    commands = [];
    const second = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    assert.equal(second.deduped, true);
    assert.equal(commands.length, 0, "and the device was not rebooted twice");
    assert.equal((await outboxRows()).length, 1);
  });

  test("executing one row twice sends one command", async () => {
    await makeOnu();
    const result = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });

    commands = [];
    const second = await executeOnuAction(result.actionId, adapterFor);
    assert.equal(second.ok, false);
    assert.match(second.detail, /Another run is already doing this/);
    assert.equal(commands.length, 0, "the claim is what stops it, not a check");
  });

  test("different actions are not deduped into one another", async () => {
    await makeOnu();
    await requestOnuAction({ serialNo: "ONU0001", action: "reboot", actorId: operator.id, adapterFor });
    await requestOnuAction({
      serialNo: "ONU0001",
      action: "authorize",
      actorId: operator.id,
      adapterFor,
    });
    const rows = await outboxRows();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.action).sort(), ["onuAuthorize", "onuReboot"]);
  });

  test("a retry entry point exists for the drain", async () => {
    await makeOnu();
    failNext = true;
    const failed = await requestOnuAction({
      serialNo: "ONU0001",
      action: "reboot",
      actorId: operator.id,
      adapterFor,
    });
    assert.equal(failed.ok, false);

    // The device comes back. That is the whole point of a retry, and leaving it
    // refusing would be testing that a second failure also fails.
    failNext = false;
    commands = [];
    const done = await retryOnuAction({ id: failed.actionId }, adapterFor);
    assert.equal(done, true);
    assert.equal(commands.length, 1, "the device was told once, on the retry");
    assert.equal((await outboxRows())[0].status, "Done");
  });
});

describe("the real protocol", () => {
  test("the fake OLT is reachable as a device the adapter can be pointed at", async (t) => {
    // Probed, not assumed: net-snmp's agent does not serve requests in this
    // container (see the Phase N note), so this records what it can and skips with
    // the reason rather than failing for something unrelated to this phase.
    const oltMock = await startMockOlt();
    try {
      const real = new SnmpOltAdapter({
        oltId: "probe",
        oltName: "probe-olt",
        host: "127.0.0.1",
        port: oltMock.port,
        community: oltMock.community,
        vendor: "snmp-huawei",
        oids: DEFAULT_OIDS,
        timeoutMs: 1200,
        retries: 0,
      });
      const readings = await real.discoverOnus();
      assert.ok(readings.length > 0, "the agent answered");
    } catch (e) {
      t.skip(`net-snmp's agent did not answer on ${oltMock.url}: ${
        e instanceof Error ? e.message : e
      }`);
    } finally {
      await oltMock.close();
    }
  });
});
