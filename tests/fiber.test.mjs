import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { invalidateSettingsCache } from "../src/lib/settings.ts";
import {
  localizeFaults,
  detectIncidents,
  affectedCustomers,
  dominantArea,
  faultKey,
  locate,
  asPoint,
  isUsablePoint,
  parsePoints,
  mapFeatures,
  mapRoutes,
  pruneOpenIncidents,
  readFaultSettings,
  ticketForKey,
  FIBER_TEMPLATES,
  OUTAGE_BODY,
} from "../src/lib/services/fiber.ts";

/**
 * Phase L — GIS fiber map + fault localization.
 *
 * The seeds are built around one question: after this OLT dies, who does the
 * office have to call? Everything else follows from getting that list right and
 * producing it exactly once.
 */

const stamp = Date.now();
const created = { areas: [], olts: [], onus: [], customers: [], tickets: [], notifications: [], routes: [] };

let seq = 0;

/**
 * Removes everything this file has created so far.
 *
 * Run between tests as well as after them. It has to: the fault job's rules read
 * the *whole* network, so a dark OLT left behind by one test is a real cluster
 * for the next one — a test asserting "nothing was detected" failed because of
 * an unrelated test's leftovers, which is a failure that looks like a bug in the
 * feature and is not.
 *
 * The job's own memory (`faults.stateStore.*`) goes with it. Those rows are keyed
 * by OLT id, and a stale snapshot entry for an OLT still in the table would
 * suppress the very transition a test is trying to cause.
 */
/** When this test began. Tickets are scoped by when they were raised. */
let testStart = new Date();

async function cleanup() {
  if (created.tickets.length) {
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: created.tickets } } });
    await prisma.ticket.deleteMany({ where: { id: { in: created.tickets } } });
  }
  if (created.notifications.length) {
    await prisma.notification.deleteMany({ where: { id: { in: created.notifications } } });
  }
  if (created.routes.length) {
    await prisma.fiberRoute.deleteMany({ where: { id: { in: created.routes } } });
  }
  if (created.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  if (created.onus.length) {
    await prisma.onu.deleteMany({ where: { id: { in: created.onus } } });
  }
  if (created.olts.length) {
    await prisma.olt.deleteMany({ where: { id: { in: created.olts } } });
  }
  if (created.areas.length) {
    await prisma.area.deleteMany({ where: { id: { in: created.areas } } });
  }
  for (const rows of Object.values(created)) rows.length = 0;
  await prisma.setting.deleteMany({ where: { key: { startsWith: "faults.stateStore." } } });
}

beforeEach(async () => {
  await cleanup();
  testStart = new Date();
  // `getSettings` memoises for 15 seconds, so a test that sets a threshold would
  // otherwise run the job against the previous test's value.
  invalidateSettingsCache();
});

after(cleanup);

/**
 * Runs `fn` with one setting overridden, and puts the row back afterwards.
 *
 * Restored rather than deleted: `faults.enabled` and friends are the app's own
 * settings, and a test that left one behind would silently disable fault
 * localization for whoever runs the app next. An earlier draft of this file did
 * exactly that, and the failure surfaced as "nothing works" in six unrelated tests.
 */
async function withSetting(key, value, fn) {
  const original = await prisma.setting.findUnique({ where: { key } });
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, group: "Network" },
    update: { value },
  });
  invalidateSettingsCache();
  try {
    await fn();
  } finally {
    if (original) await prisma.setting.update({ where: { key }, data: { value: original.value } });
    else await prisma.setting.delete({ where: { key } });
    invalidateSettingsCache();
  }
}

after(async () => {
  if (created.tickets.length) {
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: created.tickets } } });
    await prisma.ticket.deleteMany({ where: { id: { in: created.tickets } } });
  }
  await prisma.notification.deleteMany({ where: { id: { in: created.notifications } } });
  await prisma.fiberRoute.deleteMany({ where: { id: { in: created.routes } } });
  await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  await prisma.onu.deleteMany({ where: { id: { in: created.onus } } });
  await prisma.olt.deleteMany({ where: { id: { in: created.olts } } });
  await prisma.area.deleteMany({ where: { id: { in: created.areas } } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "faults.stateStore." } } });
});

/** Tracks a row for cleanup and returns its id. */
function track(bucket, id) {
  created[bucket].push(id);
  return id;
}

async function makeArea(over = {}) {
  seq += 1;
  const a = await prisma.area.create({
    data: {
      name: `Fiber Area ${stamp}-${seq}`,
      code: `FA${stamp}${seq}`,
      status: "Active",
      latitude: 23.7806,
      longitude: 90.4125,
      ...over,
    },
    select: { id: true, name: true },
  });
  return { ...a, id: track("areas", a.id) };
}

async function makeOlt(over = {}) {
  seq += 1;
  const o = await prisma.olt.create({
    data: {
      name: `Fiber OLT ${stamp}-${seq}`,
      status: "Online",
      latitude: 23.7806,
      longitude: 90.4125,
      ...over,
    },
    select: { id: true, name: true },
  });
  return { ...o, id: track("olts", o.id) };
}

async function makeOnu(oltId, over = {}) {
  seq += 1;
  const onu = await prisma.onu.create({
    data: {
      serialNo: `FS${stamp}-${seq}`,
      oltId,
      ponIndex: "0/1/1",
      status: "Online",
      latitude: 23.781 + (seq % 50) * 0.0001,
      longitude: 90.413 + (seq % 50) * 0.0001,
      lastSeenAt: new Date(),
      ...over,
    },
    select: { id: true, serialNo: true },
  });
  return { ...onu, id: track("onus", onu.id) };
}

async function makeCustomer(onuId, over = {}) {
  seq += 1;
  const c = await prisma.customer.create({
    data: {
      customerCode: `FB-${stamp}-${seq}`,
      name: `Fiber Customer ${seq}`,
      username: `fb${stamp}${seq}`,
      phone: `017${String(10000000 + seq)}`,
      connectionStatus: "Active",
      connectionDate: new Date(),
      onuId,
      ...over,
    },
    select: { id: true, name: true, phone: true },
  });
  return { ...c, id: track("customers", c.id) };
}

/**
 * Five ONUs on one port, each with a customer behind it.
 *
 * `areaId` matters: a bulk ticket is routed by the most common area among the
 * affected customers, so a cluster whose customers have no area is routed
 * nowhere. Worth being able to build, so not the default.
 */
async function makeCluster(oltId, count, onuOver = {}, { areaId = null, ...customerOver } = {}) {
  const onus = [];
  const customers = [];
  for (let i = 0; i < count; i++) {
    const onu = await makeOnu(oltId, onuOver);
    onus.push(onu);
    customers.push(await makeCustomer(onu.id, { ...customerOver, areaId }));
  }
  return { onus, customers };
}

function goDark(ids) {
  return prisma.onu.updateMany({
    where: { id: { in: ids } },
    data: { status: "Offline" },
  });
}

/**
 * Fiber tickets belonging to *this file's* OLTs.
 *
 * Scoped rather than global on purpose. The claim key embeds the OLT id, which
 * makes "the tickets this test caused" an exact question — and a global count
 * against a shared development database reports the leftovers of any earlier run
 * as if they were this test's, which is a failure that looks like a bug in the
 * feature and is not.
 */
async function fiberTickets() {
  const rows = await prisma.ticket.findMany({
    where: {
      category: "Fiber Fault",
      // Raised since this test began, or already seen. The claim key alone is not
      // enough: a resolved incident has its key freed, so the *first* ticket of a
      // two-incident test drops out of its own test's results the moment the
      // second one opens.
      OR: [{ createdAt: { gte: testStart } }, { id: { in: created.tickets } }],
    },
  });
  for (const t of rows) if (!created.tickets.includes(t.id)) created.tickets.push(t.id);
  return rows;
}

/** Queued messages addressed to *this file's* customers. */
async function queued(template) {
  const rows = await prisma.notification.findMany({
    where: { template, customerId: { in: created.customers } },
  });
  for (const m of rows) if (!created.notifications.includes(m.id)) created.notifications.push(m.id);
  return rows;
}

// ---------------------------------------------------------------------------

describe("a dead OLT", () => {
  test("produces exactly the customers behind it, one ticket and one message each", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    const { onus, customers } = await makeCluster(olt.id, 5, {}, { areaId: area.id });

    // The first run teaches the job what "up" looks like.
    await localizeFaults(new Date());
    assert.equal((await fiberTickets()).length, 0, "a healthy network opens no ticket");

    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const affected = await affectedCustomers({ oltId: olt.id });
    assert.deepEqual(
      affected.map((c) => c.id).sort(),
      customers.map((c) => c.id).sort(),
      "the affected list is exactly the five customers on that OLT"
    );

    const tickets = await fiberTickets();
    assert.equal(tickets.length, 1, "one bulk ticket");
    const ticket = tickets[0];

    assert.equal(ticket.customerId, null, "a bulk ticket belongs to no single customer");
    assert.equal(ticket.priority, "Critical");
    assert.equal(ticket.areaId, area.id, "routed to the area with the dark customers");
    assert.match(ticket.description, /Affected customers: 5/, "the count is in the ticket");
    assert.match(
      ticket.description,
      /Location: 23\.7806, 90\.4125 \(OLT cabinet\)/,
      "the OLT's own coordinates are the pin"
    );
    assert.match(ticket.description, /openstreetmap\.org/, "a clickable pin for the crew");
    assert.match(ticket.description, /went offline/, "how it was decided is recorded");
    assert.match(ticket.dedupeKey, /^fault:/, "the claim key is on the ticket");

    const withComments = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { comments: true },
    });
    assert.equal(withComments.comments.length, 1);
    for (const c of customers) {
      assert.ok(withComments.comments[0].body.includes(c.name), `${c.name} is named on the ticket`);
    }

    const sms = await queued("fiber-outage");
    assert.equal(sms.length, 5, "one queued message per affected customer");
    assert.equal(new Set(sms.map((m) => m.recipient)).size, 5, "no recipient twice");
    for (const m of sms) {
      assert.equal(m.channel, "SMS");
      assert.equal(m.body, OUTAGE_BODY);
      assert.equal(m.status, "Scheduled", "queued, never sent from inside the job");
      assert.equal(m.sentAt, null, "sending happens in the messaging cron, not in a transaction");
    }
    const batches = new Set(sms.map((m) => m.idempotencyKey.split(":").slice(0, 3).join(":")));
    assert.equal(batches.size, 1, "all five messages belong to one batch: one incident");
    assert.equal(
      [...batches][0],
      `fault:sms:${ticket.id}`,
      "the batch is keyed on the ticket, which is unique per incident"
    );
    assert.ok(
      sms.every((m) => m.notes.includes(ticket.dedupeKey)),
      "the incident key is still recorded on every message"
    );

    // The ONUs are on the OLT, so this is what "affected" meant.
    assert.equal(onus.length, 5);
  });

  test("the run that opened it opens nothing on the next twenty runs", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });

    for (let i = 0; i < 20; i++) await localizeFaults(new Date());

    assert.equal((await fiberTickets()).length, 1);
    assert.equal((await queued("fiber-outage")).length, 5);
  });

  test("two runs racing a trigger neither has seen produce one ticket and one batch", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });

    // Both runs see the trigger. A check-then-insert would have both act on it;
    // what settles it is the unique index on the ticket's claim.
    const now = new Date();
    const [a, b] = await Promise.all([
      detectIncidents(now, { applyState: false }),
      detectIncidents(now, { applyState: false }),
    ]);
    assert.equal(a.started.length, 1);
    assert.equal(b.started.length, 1, "both see it — the claim, not a check, is what decides");

    await Promise.all([localizeFaults(new Date()), localizeFaults(new Date())]);

    const tickets = await fiberTickets();
    assert.equal(tickets.length, 1, "exactly one ticket survives the race");

    const sms = await queued("fiber-outage");
    assert.equal(sms.length, 5, "exactly one message per customer, not two");
    assert.equal(new Set(sms.map((m) => m.recipient)).size, 5);
  });

  test("an OLT that was already dark when the job started opens nothing", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id, status: "Offline" });
    await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await localizeFaults(new Date());

    assert.equal(
      (await fiberTickets()).length,
      0,
      "nobody said anything was wrong, so nothing is"
    );
  });

  test("a second outage after a recovery gets its own ticket", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    await makeCluster(olt.id, 2);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Online" } });
    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const tickets = await fiberTickets();
    assert.equal(tickets.length, 2, "two incidents, two tickets");
    const open_ = tickets.find((t) => t.status === "Open");
    const closed = tickets.find((t) => t.status === "Resolved");
    assert.ok(open_, "the second incident is still open");
    assert.ok(closed, "the first was closed by its recovery");
    assert.match(open_.dedupeKey, /^fault:/, "and the open one holds the claim");
    assert.equal(
      closed.dedupeKey,
      null,
      "the resolved one gave it back — which is the only reason the second could take it"
    );
  });
});

describe("the ONU cluster rule", () => {
  test("five ONUs dropping on one port inside the window is a cut", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    const { onus, customers } = await makeCluster(olt.id, 5, {}, { areaId: area.id });

    await localizeFaults(new Date());
    await goDark(onus.map((o) => o.id));
    await localizeFaults(new Date());

    const tickets = await fiberTickets();
    assert.equal(tickets.length, 1);
    assert.match(tickets[0].subject, /PON 0\/1\/1/, "named to the port, not to the whole OLT");
    assert.equal(tickets[0].priority, "High", "a port is worse than nothing, better than a whole OLT");
    assert.match(tickets[0].description, /Affected customers: 5/);
    assert.match(tickets[0].description, /cluster failure/);
    assert.equal(tickets[0].areaId, area.id);
    assert.equal((await queued("fiber-outage")).length, customers.length);
  });

  test("four on one port is not a cut", async () => {
    const olt = await makeOlt();
    const { onus } = await makeCluster(olt.id, 4);

    await localizeFaults(new Date());
    await goDark(onus.map((o) => o.id));
    await localizeFaults(new Date());

    assert.equal((await fiberTickets()).length, 0);
    assert.equal((await queued("fiber-outage")).length, 0);
  });

  test("five whose last sighting is not all inside the window is not a cut", async () => {
    const olt = await makeOlt();
    const { onus } = await makeCluster(olt.id, 4);
    // A fifth ONU on the same port that has been dark for a week — a dead ONU
    // that happens to share the port, not a fifth witness to a break. It is dark
    // *before* the first run on purpose: a job that sees an ONU online stamps
    // its last-seen time, so an old sighting only survives on one the job has
    // never watched come up.
    const stale = await makeOnu(olt.id, {
      status: "Offline",
      lastSeenAt: new Date(Date.now() - 7 * 24 * 3_600_000),
    });

    await localizeFaults(new Date());
    await goDark(onus.map((o) => o.id));
    await localizeFaults(new Date());

    assert.equal(
      (await fiberTickets()).length,
      0,
      "counting a week-old outage would lower the bar for every cluster on the network"
    );
    assert.ok(stale.id);
  });

  test("the threshold comes from Settings", async () => {
    await withSetting("faults.onuClusterThreshold", "3", async () => {
      const olt = await makeOlt();
      const { onus } = await makeCluster(olt.id, 3);

      await localizeFaults(new Date());
      await goDark(onus.map((o) => o.id));
      await localizeFaults(new Date());

      assert.equal(
        (await fiberTickets()).length,
        1,
        "three is a cut when Settings says three is, and was not at five"
      );
    });
  });

  test("ONUs on a dead OLT do not also open a second ticket", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    const { onus } = await makeCluster(olt.id, 6);

    await localizeFaults(new Date());
    // The OLT goes, and with it every ONU behind it. One physical event.
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await goDark(onus.map((o) => o.id));
    await localizeFaults(new Date());

    const tickets = await fiberTickets();
    assert.equal(
      tickets.length,
      1,
      "one cut, one ticket — not the OLT rule and the cluster rule both firing"
    );
    assert.match(tickets[0].subject, /OLT .* offline/);
  });

  test("only the customers on the dead port are told", async () => {
    const olt = await makeOlt();
    const { onus: dead, customers: dark } = await makeCluster(olt.id, 5, { ponIndex: "0/1/1" });
    const { onus: alive, customers: lit } = await makeCluster(olt.id, 5, { ponIndex: "0/1/2" });

    await localizeFaults(new Date());
    await goDark(dead.map((o) => o.id));
    await localizeFaults(new Date());

    const sms = await queued("fiber-outage");
    assert.deepEqual(
      sms.map((m) => m.customerId).sort(),
      dark.map((c) => c.id).sort(),
      "the five on the healthy port lost nothing and are not told they did"
    );
    for (const c of lit) {
      assert.ok(!sms.some((m) => m.customerId === c.id));
    }
    assert.equal(alive.length, 5);
  });
});

describe("recovery", () => {
  test("a note on the ticket, and no second message", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id });
    await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    const opened = (await fiberTickets())[0];

    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Online" } });
    await localizeFaults(new Date(Date.now() + 42 * 60_000));

    const after_ = await prisma.ticket.findUniqueOrThrow({
      where: { id: opened.id },
      include: { comments: { orderBy: { createdAt: "asc" } } },
    });
    assert.equal(after_.status, "Resolved");
    assert.equal(after_.dedupeKey, null, "the claim is freed for the next incident");
    assert.ok(after_.resolvedAt, "and the ticket says when");

    const notes = after_.comments.filter((c) => c.body.includes("Service restored"));
    assert.equal(notes.length, 1, "exactly one recovery note");
    assert.match(notes[0].body, /42 minutes/, "how long they were down");
    assert.equal(notes[0].isInternal, true, "it is a note for the office, not a reply to a customer");

    assert.equal((await queued("fiber-outage")).length, 5, "still five: nobody was told twice");
    assert.equal(
      (await queued("fiber-recovery")).length,
      0,
      "recovery messages are off by default"
    );
  });

  test("running the recovery pass repeatedly does not stack notes", async () => {
    const olt = await makeOlt();
    await makeCluster(olt.id, 2);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    const opened = (await fiberTickets())[0];

    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Online" } });
    for (let i = 0; i < 5; i++) {
      await localizeFaults(new Date(Date.now() + (i + 2) * 60_000));
    }

    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: opened.id },
      include: { comments: true },
    });
    assert.equal(
      row.comments.filter((c) => c.body.includes("Service restored")).length,
      1
    );
  });

  test("with the setting on, recovery queues a second batch", async () => {
    await withSetting("faults.notifyRecovery", "true", async () => {
      const olt = await makeOlt();
      const { customers } = await makeCluster(olt.id, 5);

      await localizeFaults(new Date());
      await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
      await localizeFaults(new Date());
      await prisma.olt.update({ where: { id: olt.id }, data: { status: "Online" } });
      await localizeFaults(new Date(Date.now() + 30 * 60_000));

      const back = await queued("fiber-recovery");
      assert.equal(back.length, customers.length, "one per affected customer");
      assert.deepEqual(
        back.map((m) => m.customerId).sort(),
        customers.map((c) => c.id).sort()
      );
      for (const m of back) {
        assert.equal(m.status, "Scheduled");
        assert.match(m.idempotencyKey, /:recovery:/);
      }
    });
  });

  test("a cluster that falls back under the threshold recovers too", async () => {
    const olt = await makeOlt();
    const { onus } = await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await goDark(onus.map((o) => o.id));
    await localizeFaults(new Date());
    const opened = (await fiberTickets())[0];
    assert.ok(opened, "the cluster opened a ticket");

    // Two of the five come back: below the threshold, so the incident is over
    // even though the port is not healthy.
    await prisma.onu.updateMany({
      where: { id: { in: onus.slice(0, 2).map((o) => o.id) } },
      data: { status: "Online" },
    });
    await localizeFaults(new Date(Date.now() + 10 * 60_000));

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: opened.id } });
    assert.equal(row.status, "Resolved");
    assert.match(row.subject, /PON 0\/1\/1/);
  });
});

describe("what the job refuses to do", () => {
  test("a disconnected customer is not told about an outage", async () => {
    const olt = await makeOlt();
    const { customers } = await makeCluster(olt.id, 5);
    const gone = customers[0];
    await prisma.customer.update({
      where: { id: gone.id },
      data: { connectionStatus: "Disconnected" },
    });

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const affected = await affectedCustomers({ oltId: olt.id });
    assert.ok(!affected.some((c) => c.id === gone.id), "no line, no notice");
    assert.equal((await queued("fiber-outage")).length, 4);
  });

  test("a threshold of zero does not turn every dark ONU into an incident", () => {
    assert.equal(readFaultSettings({ "faults.onuClusterThreshold": "0" }).threshold, 5);
    assert.equal(
      readFaultSettings({ "faults.onuClusterThreshold": "banana" }).threshold,
      5,
      "a non-number falls back rather than becoming NaN and doing nothing"
    );
    assert.equal(readFaultSettings({ "faults.onuClusterThreshold": "12" }).threshold, 12);
    assert.equal(readFaultSettings({ "faults.onuClusterThreshold": "7.9" }).threshold, 7);
    assert.equal(readFaultSettings({ "faults.onuClusterWindowMinutes": "0" }).windowMinutes, 10);
    assert.equal(readFaultSettings({ "faults.onuClusterWindowMinutes": "30" }).windowMinutes, 30);
    assert.equal(readFaultSettings({}).enabled, true);
    assert.equal(readFaultSettings({ "faults.enabled": "false" }).enabled, false);
    assert.equal(readFaultSettings({ "faults.notifyRecovery": "true" }).notifyRecovery, true);
    assert.equal(readFaultSettings({}).notifyRecovery, false);
  });

  test("switched off, it touches nothing", async () => {
    await withSetting("faults.enabled", "false", async () => {
      const olt = await makeOlt();
      await makeCluster(olt.id, 5);

      await localizeFaults(new Date());
      await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
      const result = await localizeFaults(new Date());

      assert.equal(result.ran, 0);
      assert.match(result.skipped, /switched off/);
      assert.equal((await fiberTickets()).length, 0);
    });
  });

  test("incident memory is pruned once it is stale", async () => {
    const olt = await makeOlt();
    await makeCluster(olt.id, 5);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    assert.equal((await fiberTickets()).length, 1);

    assert.equal(await pruneOpenIncidents(new Date()), 0, "a fresh incident is kept");
    const dropped = await pruneOpenIncidents(new Date(Date.now() + 25 * 3_600_000));
    assert.ok(dropped >= 1, "a port that never recovers does not stay open for ever");
  });

  test("the job reports what it did, in words", async () => {
    const olt = await makeOlt();
    await makeCluster(olt.id, 3);
    const quiet = await localizeFaults(new Date());
    assert.match(quiet.skipped, /0 new incident/);

    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    const opened = await localizeFaults(new Date());
    assert.match(opened.skipped, /1 ticket\(s\) opened/);
    assert.match(opened.skipped, /3 message\(s\) queued/);
    assert.equal(opened.ran, 1);
  });
});

describe("the map", () => {
  test("markers carry the coordinates and status that are in the database", async () => {
    const area = await makeArea();
    const olt = await makeOlt({ areaId: area.id, status: "Offline" });
    seq += 1;
    const router = await prisma.router.create({
      data: {
        name: `fiber-router-${stamp}-${seq}`,
        ipAddress: `10.99.${seq % 200}.${seq % 200}`,
        areaId: area.id,
        status: "Online",
        latitude: 23.7999,
        longitude: 90.4199,
      },
      select: { id: true },
    });
    const onu = await makeOnu(olt.id, { status: "Low Signal", latitude: 23.75, longitude: 90.5 });

    const byId = new Map((await mapFeatures()).map((f) => [`${f.kind}:${f.id}`, f]));

    const oltRow = await prisma.olt.findUniqueOrThrow({ where: { id: olt.id } });
    const marker = byId.get(`olt:${olt.id}`);
    assert.equal(marker.lat, oltRow.latitude, "a marker is at the stored latitude");
    assert.equal(marker.lng, oltRow.longitude);
    assert.equal(marker.status, "Offline");
    assert.equal(marker.name, oltRow.name);
    assert.match(marker.detail, /OLT · 1 ONU on 0 PON ports/);

    assert.equal(byId.get(`router:${router.id}`).lat, 23.7999);
    assert.equal(byId.get(`router:${router.id}`).status, "Online");
    assert.match(byId.get(`router:${router.id}`).detail, /0 active users/);

    const onuRow = await prisma.onu.findUniqueOrThrow({ where: { id: onu.id } });
    assert.equal(byId.get(`onu:${onu.id}`).name, onuRow.serialNo, "an unnamed ONU shows its serial");
    assert.equal(byId.get(`onu:${onu.id}`).lat, 23.75);
    assert.equal(byId.get(`onu:${onu.id}`).lng, 90.5);
    assert.equal(byId.get(`onu:${onu.id}`).status, "Low Signal");
    assert.match(byId.get(`onu:${onu.id}`).detail, /PON 0\/1\/1/);
    assert.match(byId.get(`onu:${onu.id}`).detail, new RegExp(`via ${oltRow.name}`));

    await prisma.router.delete({ where: { id: router.id } });
  });

  test("a device with no coordinates is off the map, not at (0, 0)", async () => {
    const olt = await makeOlt({ latitude: null, longitude: null });

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const features = await mapFeatures();
    assert.ok(
      !features.some((f) => f.kind === "olt" && f.id === olt.id),
      "an unlocated cabinet is absent rather than in the Gulf of Guinea"
    );
    assert.ok(
      !features.some((f) => f.lat === 0 && f.lng === 0),
      "and nothing else is at (0, 0) either"
    );

    const ticket = (await fiberTickets())[0];
    // This OLT has no area and no ONUs, so there is nothing to fall back to.
    assert.match(ticket.description, /Location: not recorded/);
    assert.match(
      ticket.description,
      /Ask the office where the cabinet is/,
      "an unlocatable outage says so instead of inventing a pin"
    );
  });

  test("(0, 0) is not a location", () => {
    assert.equal(isUsablePoint(0, 0), false);
    assert.equal(isUsablePoint(23.78, 90.41), true);
    assert.equal(isUsablePoint(null, 90.41), false);
    assert.equal(isUsablePoint(23.78, null), false);
    assert.equal(isUsablePoint(91, 0), false);
    assert.equal(isUsablePoint(-91, 0), false);
    assert.equal(isUsablePoint(0, 181), false);
    assert.equal(isUsablePoint("23.78", "90.41"), false);
    assert.equal(isUsablePoint(NaN, 90), false);
    assert.equal(isUsablePoint(Infinity, 90), false);
    assert.deepEqual(asPoint(null, null), null);
    assert.deepEqual(asPoint(1.5, 2.5), { lat: 1.5, lng: 2.5 });
  });

  test("the pin falls back from cabinet to area to the customers themselves", () => {
    const nowhere = { latitude: null, longitude: null };
    const cabinet = { latitude: 23.78, longitude: 90.41 };
    const area = { latitude: 24.0, longitude: 91.0 };
    const onus = [
      { latitude: 23.0, longitude: 90.0 },
      { latitude: 23.2, longitude: 90.4 },
    ];

    assert.deepEqual(locate(cabinet, area, onus), {
      lat: 23.78,
      lng: 90.41,
      source: "OLT cabinet",
    });
    assert.deepEqual(locate(nowhere, area, onus), {
      lat: 24.0,
      lng: 91.0,
      source: "area centre",
    });
    assert.deepEqual(locate(nowhere, nowhere, onus), {
      lat: 23.1,
      lng: 90.2,
      source: "centroid of 2 located ONUs",
    });
    assert.equal(locate(nowhere, nowhere, []), null);
    assert.equal(locate(nowhere, nowhere, [{ latitude: 0, longitude: 0 }]), null);
    assert.equal(locate(cabinet, nowhere, []).source, "OLT cabinet");
  });

  test("a cabinetless OLT's pin falls back to the area it serves", async () => {
    const area = await makeArea({ latitude: 23.7, longitude: 90.3 });
    const olt = await makeOlt({ areaId: area.id, latitude: null, longitude: null });
    await makeCluster(olt.id, 1);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const ticket = (await fiberTickets())[0];
    assert.match(ticket.description, /Location: 23\.7, 90\.3 \(area centre\)/);
  });
});

describe("fiber routes", () => {
  test("a stored route comes back as an ordered polyline", async () => {
    const olt = await makeOlt();
    seq += 1;
    const route = await prisma.fiberRoute.create({
      data: {
        name: `route-${stamp}-${seq}`,
        oltId: olt.id,
        note: "6-span feeder",
        points: [
          { lat: 23.7, lng: 90.3 },
          { lat: 23.71, lng: 90.31 },
          { lat: 23.72, lng: 90.32 },
        ],
      },
      select: { id: true },
    });
    track("routes", route.id);

    const { routes, skipped } = await mapRoutes();
    const found = routes.find((r) => r.id === route.id);
    assert.ok(found, "the route is on the map");
    assert.equal(found.points.length, 3);
    assert.deepEqual(found.points[0], { lat: 23.7, lng: 90.3 });
    assert.equal(found.points[2].lng, 90.32, "the order the crew recorded is the order drawn");
    assert.equal(found.olt, olt.name);
    assert.equal(found.note, "6-span feeder");
    assert.ok(skipped >= 0);
  });

  test("one unreadable route does not take the map down with it", async () => {
    seq += 1;
    const good = await prisma.fiberRoute.create({
      data: { name: `good-${stamp}-${seq}`, points: [{ lat: 23.7, lng: 90.3 }] },
      select: { id: true },
    });
    seq += 1;
    const bad = await prisma.fiberRoute.create({
      data: {
        name: `bad-${stamp}-${seq}`,
        // What a hand-written INSERT leaves behind.
        points: [{ lat: "here", lng: "there" }, { lat: 0, lng: 0 }, null, 7],
      },
      select: { id: true },
    });
    track("routes", good.id);
    track("routes", bad.id);

    const { routes, skipped } = await mapRoutes();
    assert.ok(routes.some((r) => r.id === good.id), "the readable route is drawn");
    assert.ok(!routes.some((r) => r.id === bad.id), "the unreadable one is not");
    assert.equal(skipped, 1, "and the page is told one was skipped");
  });

  test("points are parsed, not trusted", () => {
    assert.deepEqual(parsePoints([{ lat: 1.5, lng: 2.5 }]), [{ lat: 1.5, lng: 2.5 }]);
    assert.deepEqual(parsePoints("nope"), []);
    assert.deepEqual(parsePoints(null), []);
    assert.deepEqual(parsePoints({ lat: 1, lng: 2 }), []);
    assert.deepEqual(parsePoints([]), []);
    assert.deepEqual(parsePoints([{ lat: 1, lng: 2 }, { lat: 3 }]), [{ lat: 1, lng: 2 }]);
    assert.deepEqual(parsePoints([{ lat: 0, lng: 0 }]), [], "(0,0) is not a waypoint");
    assert.deepEqual(parsePoints([{ lat: 1, lng: 2 }, null, 9, "x"]), [{ lat: 1, lng: 2 }]);
    assert.deepEqual(parsePoints([{ lat: 200, lng: 2 }]), [], "out of range");
  });
});

describe("the details that matter", () => {
  test("a ticket routes to the area with the most dark customers, not the OLT's", () => {
    const a = { id: "a", name: "Alpha", phone: "", areaId: "A", areaName: "Alpha" };
    const b = { id: "b", name: "Bravo", phone: "", areaId: "B", areaName: "Bravo" };
    const c = { id: "c", name: "Charlie", phone: "", areaId: "B", areaName: "Bravo" };
    assert.equal(dominantArea([a, b, c]), "B", "two in Bravo beats one in Alpha");
    assert.equal(dominantArea([a, b]), "A", "a tie breaks on name, so it is stable");
    assert.equal(dominantArea([b, a]), "A", "and stable whichever way round they arrive");
    assert.equal(dominantArea([{ ...a, areaId: null, areaName: null }]), null);
    assert.equal(dominantArea([]), null);
  });

  test("the incident key is floored to the hour", () => {
    assert.equal(faultKey("o1", "all", new Date("2026-10-02T21:37:12")), "fault:o1:all:21");
    assert.equal(
      faultKey("o1", "0/1/1", new Date("2026-10-02T21:59:59")),
      faultKey("o1", "0/1/1", new Date("2026-10-02T21:00:01"))
    );
    assert.notEqual(
      faultKey("o1", "all", new Date("2026-10-02T21:59:59")),
      faultKey("o1", "all", new Date("2026-10-02T22:00:01"))
    );
    assert.match(faultKey("olt_abc", "0/1/1", new Date()), /^fault:olt_abc:0\/1\/1:\d\d$/);
  });

  test("a second outage inside the same hour tells the customers again", async () => {
    // Two separate cuts, forty minutes apart, on the same cabinet. The claim key
    // carries an hour bucket, so both incidents claim `fault:{olt}:all:{hour}` —
    // the first ticket is Resolved by then and its key is freed, so the second
    // ticket is allowed. Its *messages* have to be allowed too: keying them on
    // the incident key made a second outage in the same hour open a ticket that
    // notified nobody, because every message collided with the first batch.
    const olt = await makeOlt();
    const { customers } = await makeCluster(olt.id, 3);
    const start = new Date("2026-10-02T21:05:00");

    await localizeFaults(start);
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(start);
    assert.equal((await fiberTickets()).length, 1);
    assert.equal((await queued("fiber-outage")).length, 3);

    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Online" } });
    await localizeFaults(new Date(start.getTime() + 10 * 60_000));
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date(start.getTime() + 40 * 60_000));

    const tickets = await fiberTickets();
    assert.equal(tickets.length, 2, "two outages, two tickets, both in the same hour");
    assert.equal(tickets.filter((t) => t.status === "Open").length, 1, "one is still open");

    const sms = await queued("fiber-outage");
    assert.equal(sms.length, 6, "each outage tells everyone once: 3 + 3");
    assert.deepEqual(
      [...new Set(sms.map((m) => m.customerId))].sort(),
      customers.map((c) => c.id).sort()
    );
    const byBatch = new Map();
    for (const m of sms) {
      const batch = m.idempotencyKey.split(":").slice(0, 3).join(":");
      byBatch.set(batch, (byBatch.get(batch) ?? 0) + 1);
    }
    assert.equal(byBatch.size, 2, "two batches, one per outage");
    for (const [batch, count] of byBatch) {
      assert.equal(count, 3, `${batch} went to all three customers`);
    }
  });

  test("an outage that runs past the hour boundary stays one ticket and one batch", async () => {
    const olt = await makeOlt();
    await makeCluster(olt.id, 3);
    const start = new Date("2026-10-02T21:50:00");

    await localizeFaults(start);
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(start);
    assert.equal((await fiberTickets()).length, 1);

    // Still dark at 22:10. The claim key is now a *different* hour bucket, so
    // only the open-incident memory stops a second ticket.
    await localizeFaults(new Date("2026-10-02T22:10:00"));
    await localizeFaults(new Date("2026-10-02T22:30:00"));

    assert.equal((await fiberTickets()).length, 1, "one fault, one ticket, across an hour boundary");
    assert.equal((await queued("fiber-outage")).length, 3, "and one batch of three");
  });

  test("the ticket the incident owns is found by its key", async () => {
    const olt = await makeOlt();
    await makeCluster(olt.id, 2);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());

    const ticket = (await fiberTickets())[0];
    assert.equal(await ticketForKey(ticket.dedupeKey), ticket.id);
    assert.equal(await ticketForKey("fault:nope:all:00"), null);
  });

  test("a queued fiber message is not a reminder, and a reminder does not eat it", async () => {
    // Two features now queue exactly-once messages, so "carries an idempotency
    // key" no longer means "is a reminder". On the old test a queued outage notice
    // appeared on the Reminders page and was picked up by the reminder drain,
    // which would have delivered it down the WhatsApp-then-SMS fallback chain.
    const olt = await makeOlt();
    const { customers } = await makeCluster(olt.id, 2);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    assert.equal((await queued("fiber-outage")).length, customers.length);

    const { listReminders } = await import("../src/lib/services/reminder-queries.ts");
    const listed = await listReminders({});
    const leaked = listed.rows.filter((r) => String(r.idempotencyKey ?? "").startsWith("fault:"));
    assert.deepEqual(leaked, [], "an outage notice is not a payment reminder");

    const { sendReminders } = await import("../src/lib/services/reminders.ts");
    await withSetting("reminder.enabled", "true", async () => {
      await sendReminders();
    });

    const after_ = await queued("fiber-outage");
    assert.ok(
      after_.every((m) => m.status === "Scheduled"),
      "the reminder job left the queued outage notices alone"
    );
  });

  test("the messaging job does pick the queued outage notices up", async () => {
    // The other half of the same seam: `sendScheduledMessages` used to select
    // `idempotencyKey: null`, which skipped every fiber message for ever. They
    // were queued, marked Scheduled, and never delivered.
    const olt = await makeOlt();
    const { customers } = await makeCluster(olt.id, 2);

    await localizeFaults(new Date());
    await prisma.olt.update({ where: { id: olt.id }, data: { status: "Offline" } });
    await localizeFaults(new Date());
    const rows = await queued("fiber-outage");
    assert.equal(rows.length, customers.length);

    const { sendScheduledMessages } = await import("../src/lib/services/cron.ts");
    const result = await sendScheduledMessages();

    const after_ = await queued("fiber-outage");
    assert.equal(
      after_.filter((m) => m.status === "Scheduled").length,
      0,
      "the drain took them; no SMS gateway is configured here, so they land Failed"
    );
    assert.equal(after_.length, customers.length, "and it did not create any more");
    assert.ok(result.ran + /failed/.test(result.skipped), `drain reported: ${result.skipped}`);
  });

  test("every message carries a template the drain knows to send", () => {
    assert.deepEqual([...FIBER_TEMPLATES], ["fiber-outage", "fiber-recovery"]);
    assert.ok(OUTAGE_BODY.length <= 160, "one SMS segment");
  });
});