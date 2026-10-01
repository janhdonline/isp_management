/**
 * Automatic payment reminders.
 *
 * The property under test is exactly-once. Everything else here — day matching,
 * channel fallback, quiet hours — is only interesting because of how it behaves
 * when the job runs twice, and two concurrent times, which is what a cron route
 * fired by three schedulers actually does.
 *
 * The delivery path is exercised for real, against the actual WhatsApp and SMS
 * adapters in `src/lib/services/messaging.ts`, with `fetch` stubbed. Stubbing the
 * adapters instead would mean testing that the reminder service calls a function
 * that returns whatever the test told it to, which is not the thing that has
 * been wrong. What has been wrong is the *chain*: a WhatsApp failure that is
 * treated as a success, an unconfigured channel recorded as Sent, a second run
 * that sends the same letter twice.
 */
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import {
  sendReminders,
  collectDueReminders,
  deliverReminder,
  reminderKey,
  parseDayList,
  parseQuietHours,
  isQuiet,
  quietWindowEnd,
  parseChannels,
  daysBetween,
} from "../src/lib/services/reminders.ts";
import { addDays, startOfDay } from "../src/lib/utils.ts";

const stamp = Date.now();
const customerIds = [];
let pkg;
let area;
/** When this file started, so the `after` hook can find exactly its own rows. */
let runStartedAt;

/** What the stubbed providers do on their next call. */
const provider = {
  whatsapp: { status: 200, body: { messages: [{ id: "wamid.TEST" }] } },
  sms: { status: 200, body: { code: "200", message: "ok" } },
  calls: [],
};

/** Stands in for the providers' HTTP, recording what was sent where. */
function installFetchStub() {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const which = href.includes("graph.facebook.com") ? "whatsapp" : "sms";
    provider.calls.push({
      channel: which,
      to: JSON.parse(init.body).to ?? JSON.parse(init.body).number,
      body: JSON.parse(init.body).text?.body ?? JSON.parse(init.body).sms,
    });
    const cfg = provider[which];
    return new Response(JSON.stringify(cfg.body), {
      status: cfg.status,
      headers: { "content-type": "application/json" },
    });
  };
}

const realFetch = globalThis.fetch;

async function makeCustomer(over = {}) {
  const n = customerIds.length + 1;
  const row = await prisma.customer.create({
    data: {
      customerCode: `REMIND-${stamp}-${n}`,
      name: `Reminder Test ${n}`,
      username: `remind${stamp}${n}`,
      phone: `017${String(10000000 + n)}`,
      connectionStatus: "Active",
      packageId: pkg.id,
      areaId: area.id,
      connectionDate: new Date(),
      ...over,
    },
    select: { id: true, name: true, phone: true },
  });
  customerIds.push(row.id);
  return row;
}

async function makeInvoice(customer, { daysOverdue = 1, ...over } = {}) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: `REM-${stamp}-${customerIds.length}-${Math.random().toString(36).slice(2, 7)}`,
      customerId: customer.id,
      packageId: pkg.id,
      issueDate: addDays(new Date(), -30),
      dueDate: addDays(startOfDay(new Date()), -daysOverdue),
      amount: 1000,
      total: 1000,
      paid: 0,
      status: "Overdue",
      ...over,
    },
    select: { id: true, invoiceNumber: true },
  });
}

before(async () => {
  runStartedAt = new Date(Date.now() - 5000);
  installFetchStub();

  pkg = await prisma.package.create({
    data: {
      name: `Reminder Test Package ${stamp}`,
      downloadSpeed: 10,
      uploadSpeed: 5,
      monthlyPrice: 1000,
      billingCycle: "Monthly",
      validityDays: 30,
      status: "Active",
    },
    select: { id: true },
  });
  area = await prisma.area.create({
    data: { name: `Reminder Test Area ${stamp}`, code: `RM${stamp % 100000}`, status: "Active" },
    select: { id: true },
  });
});

beforeEach(async () => {
  provider.whatsapp = { status: 200, body: { messages: [{ id: "wamid.TEST" }] } };
  provider.sms = { status: 200, body: { code: "200", message: "ok" } };
  provider.calls = [];

  await saveSettings([
    { key: "reminder.enabled", value: "true" },
    { key: "reminder.expiryDays", value: "3,1" },
    { key: "reminder.dueDays", value: "1,3,7" },
    { key: "reminder.channelOrder", value: "whatsapp,sms" },
    { key: "reminder.quietHours", value: "" },
    { key: "api.whatsappUrl", value: "1234567890" },
    { key: "api.whatsappToken", value: "test-token" },
    { key: "api.smsUrl", value: "http://sms.test/send" },
    { key: "api.smsApiKey", value: "test-sms-key" },
  ]);

  await prisma.notification.deleteMany({ where: { customerId: { in: customerIds } } });
});

after(async () => {
  globalThis.fetch = realFetch;
  // Every row this run created, not just the ones belonging to its own
  // customers: `sendReminders` is a whole-database job and it also reminds the
  // seeded customers, whose rows would otherwise survive and make a later run
  // look like it had already sent everything.
  await prisma.notification.deleteMany({
    where: { idempotencyKey: { not: null }, createdAt: { gte: runStartedAt } },
  });
  if (customerIds.length) {
    await prisma.notification.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (area) await prisma.area.deleteMany({ where: { id: area.id } });
  if (pkg) await prisma.package.deleteMany({ where: { id: pkg.id } });
  // Pinned to the seeded values rather than restored from a snapshot: a snapshot
  // taken while a *previous* run had already leaked leaves the leak in place, and
  // the next suite to run — or the verify script — then sees reminders switched
  // on with a fake provider, and starts mailing customers.
  await saveSettings([
    { key: "reminder.enabled", value: "false" },
    { key: "reminder.expiryDays", value: "3,1" },
    { key: "reminder.dueDays", value: "1,3,7" },
    { key: "reminder.channelOrder", value: "whatsapp,sms" },
    { key: "reminder.quietHours", value: "22:00-07:00" },
    { key: "api.whatsappUrl", value: "" },
    { key: "api.whatsappToken", value: "" },
    { key: "api.smsUrl", value: "https://api.bulksmsbd.com/smsapi" },
    { key: "api.smsApiKey", value: "" },
  ]);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("the idempotency key", () => {
  test("has the documented shape", () => {
    assert.equal(
      reminderKey("cust_1", "inv_2", "due", 7),
      "reminder:cust_1:inv_2:due:7"
    );
    // An expiry reminder has no invoice, and says so rather than dropping the slot:
    // a key that changed shape when an invoice appeared would be a duplicate
    // waiting for the next billing run.
    assert.equal(reminderKey("cust_1", null, "expiry", 3), "reminder:cust_1:none:expiry:3");
  });

  test("the day offset is part of it, so 3-days and 1-day are different reminders", () => {
    assert.notEqual(reminderKey("c", null, "expiry", 3), reminderKey("c", null, "expiry", 1));
  });
});

describe("the day lists", () => {
  test("parse, dedupe and sort, and survive nonsense", () => {
    assert.deepEqual(parseDayList("7, 3,1", []), [1, 3, 7]);
    assert.deepEqual(parseDayList("3,3,1", []), [1, 3], "a repeated day is one reminder");
    assert.deepEqual(parseDayList("", [3, 1]), [1, 3], "a blank setting falls back to the default");
    assert.deepEqual(parseDayList("abc,-4,99999", [3, 1]), [1, 3], "junk is dropped, not obeyed");
  });
});

describe("quiet hours", () => {
  const window = { from: 22 * 60, to: 7 * 60 };

  test("a window that wraps midnight is parsed", () => {
    assert.deepEqual(parseQuietHours("22:00-07:00"), { from: 1320, to: 420 });
    assert.equal(parseQuietHours(""), null, "blank means no window");
    assert.equal(parseQuietHours("not-a-window"), null);
    assert.equal(parseQuietHours("10:00-10:00"), null, "a 24-hour window is not a quiet window");
  });

  test("inside the window is quiet on both sides of midnight", () => {
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 23, 30)), true);
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 2, 0)), true);
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 6, 59)), true);
  });

  test("outside it, it is not quiet", () => {
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 12, 0)), false);
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 21, 59)), false);
    assert.equal(isQuiet(window, new Date(2026, 0, 1, 7, 0)), false, "the window ends at 07:00, not after");
  });

  test("a held reminder is released at the end of the window", () => {
    const until = quietWindowEnd(window, new Date(2026, 0, 1, 23, 30));
    assert.equal(until.getDate(), 2, "22:30 is past midnight by the time 07:00 arrives");
    assert.equal(until.getHours(), 7);
    assert.equal(isQuiet(window, until), false, "and it is sendable then");
  });
});

describe("day matching", () => {
  test("expiry in exactly 3 days triggers; 2 and 4 do not", async () => {
    await saveSettings([{ key: "reminder.expiryDays", value: "3" }, { key: "reminder.dueDays", value: "" }]);

    const onDay = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const tooSoon = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 2) });
    const tooLate = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 4) });
    // Time of day must not matter: an expiry date carries a timestamp from
    // whenever the renewal was last edited, and a reminder that fires at 02:00 but
    // not at 14:00 is a bug that gets noticed once a month.
    const lateInDay = await makeCustomer({ expiryDate: new Date(addDays(startOfDay(new Date()), 3).getTime() + 23 * 3600_000) });

    const due = await collectDueReminders(new Date());
    const keys = due.map((r) => r.customerId);

    assert.ok(keys.includes(onDay.id), "exactly 3 days out must be due");
    assert.ok(keys.includes(lateInDay.id), "the hour of the expiry timestamp is irrelevant");
    assert.ok(!keys.includes(tooSoon.id));
    assert.ok(!keys.includes(tooLate.id));
  });

  test("an invoice due 1 day ago triggers; 2 days ago does not", async () => {
    await saveSettings([{ key: "reminder.expiryDays", value: "" }, { key: "reminder.dueDays", value: "1" }]);

    const c1 = await makeCustomer();
    const c2 = await makeCustomer();
    const inv1 = await makeInvoice(c1, { daysOverdue: 1 });
    const inv2 = await makeInvoice(c2, { daysOverdue: 2 });

    const due = await collectDueReminders(new Date());
    const keys = due.map((r) => r.key);

    assert.ok(keys.includes(reminderKey(c1.id, inv1.id, "due", 1)), "1 day past due is due");
    assert.ok(!keys.includes(reminderKey(c2.id, inv2.id, "due", 1)), "2 days past due is not");
  });

  test("daysBetween counts calendar days, not elapsed hours", () => {
    const today = startOfDay(new Date(2026, 5, 10, 0, 1));
    assert.equal(daysBetween(today, new Date(2026, 5, 13, 23, 59)), 3);
    assert.equal(daysBetween(new Date(2026, 5, 13), new Date(2026, 5, 10)), -3);
  });

  test("a customer with no phone is skipped rather than failed", async () => {
    await saveSettings([{ key: "reminder.expiryDays", value: "1" }, { key: "reminder.dueDays", value: "" }]);
    const c = await makeCustomer({ phone: "", expiryDate: addDays(startOfDay(new Date()), 1) });
    const due = await collectDueReminders(new Date());
    assert.ok(!due.some((r) => r.customerId === c.id));
  });
});

/* ------------------------------------------------------------------ */

describe("sending, exactly once", () => {
  test("a customer expiring in 3 days gets exactly one reminder", async () => {
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });

    const result = await sendReminders();
    assert.ok(result.ran >= 1, result.skipped);

    const rows = await prisma.notification.findMany({ where: { customerId: customer.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Sent");
    assert.equal(rows[0].channel, "WhatsApp");
    assert.equal(rows[0].idempotencyKey, reminderKey(customer.id, null, "expiry", 3));
    assert.equal(rows[0].template, "expiry-reminder");
  });

  test("running the job again sends nothing and adds no rows", async () => {
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    await sendReminders();

    const before = await prisma.notification.findMany({ where: { customerId: customer.id } });
    const callsBefore = provider.calls.length;

    const second = await sendReminders();
    const after = await prisma.notification.findMany({ where: { customerId: customer.id } });

    assert.equal(after.length, before.length, "a second run must not add a row");
    assert.equal(provider.calls.length, callsBefore, "and must not send a second message");
    assert.match(second.skipped, /0 newly recorded/);
  });

  test("the same key twice inserts once — the database settles the race", async () => {
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const key = reminderKey(customer.id, null, "expiry", 3);

    // Two concurrent inserts of the same key, which is what two cron runs racing
    // produce. The unique index makes one lose; a check-then-insert would let both
    // through, because both can pass the check.
    const results = await Promise.allSettled([
      prisma.notification.create({
        data: { idempotencyKey: key, channel: "WHATSAPP", recipient: customer.phone, customerId: customer.id, body: "a", status: "Sent" },
      }),
      prisma.notification.create({
        data: { idempotencyKey: key, channel: "WHATSAPP", recipient: customer.phone, customerId: customer.id, body: "a", status: "Sent" },
      }),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one insert wins");
    assert.equal(results.filter((r) => r.status === "rejected").length, 1, "the other is rejected by the index");
    assert.equal(
      await prisma.notification.count({ where: { idempotencyKey: key } }),
      1,
      "and there is exactly one row"
    );
  });

  test("skipDuplicates lets one of two concurrent job runs record a reminder", async () => {
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const key = reminderKey(customer.id, null, "expiry", 3);

    const [a, b] = await Promise.all([
      prisma.notification.createMany({
        data: [{ idempotencyKey: key, channel: "WHATSAPP", recipient: customer.phone, customerId: customer.id, body: "x", status: "Sent" }],
        skipDuplicates: true,
      }),
      prisma.notification.createMany({
        data: [{ idempotencyKey: key, channel: "WHATSAPP", recipient: customer.phone, customerId: customer.id, body: "x", status: "Sent" }],
        skipDuplicates: true,
      }),
    ]);

    assert.equal(a.count + b.count, 1, "one run inserts, the other is dropped by the index");
    assert.equal(await prisma.notification.count({ where: { customerId: customer.id } }), 1);
  });

  test("an ordinary manual message is not deduplicated", async () => {
    // Null keys: several messages to one customer are legitimate and the unique
    // index permits it, because NULLs are not equal to each other in SQL.
    const customer = await makeCustomer();
    await prisma.notification.createMany({
      data: [
        { channel: "SMS", recipient: customer.phone, customerId: customer.id, body: "one", status: "Sent" },
        { channel: "SMS", recipient: customer.phone, customerId: customer.id, body: "two", status: "Sent" },
      ],
    });
    assert.equal(await prisma.notification.count({ where: { customerId: customer.id } }), 2);
  });
});

/* ------------------------------------------------------------------ */

describe("channel fallback", () => {
  const reminderFor = async (over = {}) => ({
    key: "reminder:test:none:expiry:1",
    kind: "expiry",
    customerId: "test",
    customerName: "Test",
    recipient: "01700000000",
    invoiceId: null,
    invoiceNumber: null,
    dayOffset: 1,
    body: "Your subscription expires tomorrow.",
    ...over,
  });

  test("WhatsApp configured → sent on WhatsApp, and SMS is not touched", async () => {
    const report = await deliverReminder(await reminderFor(), ["whatsapp", "sms"]);
    assert.equal(report.sent, true);
    assert.equal(report.channel, "WhatsApp");
    assert.equal(provider.calls.filter((c) => c.channel === "sms").length, 0);
  });

  test("WhatsApp fails → SMS carries it, and the switch is on the row", async () => {
    provider.whatsapp = { status: 500, body: { error: { message: "template not approved" } } };

    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    // Every other test customer is still in the database and still due, so this
    // run does more work than this one case cares about; the calls are counted for
    // this customer's number only.
    provider.calls = [];
    await sendReminders();

    const row = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(row.status, "Sent");
    assert.equal(row.channel, "SMS", "the channel that actually delivered it is recorded");
    assert.match(row.notes, /WhatsApp/, "and so is the fact that it was tried first");
    assert.match(row.notes, /SMS/);

    const digits = (v) => String(v).replace(/^\+?880/, "").replace(/^0/, "");
    const mine = provider.calls.filter((c) => digits(c.to) === digits(customer.phone));
    assert.equal(mine.filter((c) => c.channel === "whatsapp").length, 1, "WhatsApp was tried once");
    assert.equal(mine.filter((c) => c.channel === "sms").length, 1, "and SMS carried it");
  });

  test("WhatsApp unconfigured → SMS carries it", async () => {
    await saveSettings([{ key: "api.whatsappUrl", value: "" }, { key: "api.whatsappToken", value: "" }]);

    const report = await deliverReminder(await reminderFor(), ["whatsapp", "sms"]);
    assert.equal(report.sent, true);
    assert.equal(report.channel, "SMS");
    assert.equal(provider.calls.filter((c) => c.channel === "whatsapp").length, 0, "an unconfigured channel is not called");
  });

  test("neither configured → Failed, never Sent", async () => {
    await saveSettings([
      { key: "api.whatsappUrl", value: "" },
      { key: "api.whatsappToken", value: "" },
      { key: "api.smsUrl", value: "" },
      { key: "api.smsApiKey", value: "" },
    ]);

    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const result = await sendReminders();

    const row = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(row.status, "Failed");
    assert.notEqual(row.status, "Sent", "an undelivered reminder must never read as delivered");
    assert.equal(row.sentAt, null);
    assert.match(row.error, /not configured/i);
    // Every other test customer is still due too, so the count is this run's whole
    // workload; what is being asserted is that nothing was sent and it was said.
    assert.equal(result.ran, 0);
    assert.match(result.skipped, /\d+ failed/);
  });

  test("both configured but both failing → Failed with both reasons", async () => {
    provider.whatsapp = { status: 500, body: { error: "down" } };
    provider.sms = { status: 500, body: { message: "down" } };

    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    await sendReminders();

    const row = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(row.status, "Failed");
    assert.match(row.error, /WhatsApp/);
    assert.match(row.error, /SMS/);

    const digits = (v) => String(v).replace(/^\+?880/, "").replace(/^0/, "");
    const mine = provider.calls.filter((c) => digits(c.to) === digits(customer.phone));
    assert.equal(mine.length, 2, "both channels were genuinely tried, and neither worked");
  });

  test("the channel order is honoured", async () => {
    provider.whatsapp = { status: 500, body: {} };
    const report = await deliverReminder(await reminderFor(), ["sms", "whatsapp"]);
    assert.equal(report.channel, "SMS", "SMS was listed first, so it is tried first and never falls through");
    assert.equal(provider.calls.filter((c) => c.channel === "whatsapp").length, 0);
  });

  test("an unrecognised channel in the setting is dropped, not tried", () => {
    assert.deepEqual(parseChannels("whatsapp,telegram,sms"), ["whatsapp", "sms"]);
    assert.deepEqual(parseChannels(""), ["whatsapp", "sms"], "a blank setting falls back to the default");
    assert.deepEqual(parseChannels("telegram"), ["whatsapp", "sms"]);
  });
});

/* ------------------------------------------------------------------ */

describe("quiet hours", () => {
  test("a run inside the window holds the reminder and sends nothing", async () => {
    await saveSettings([{ key: "reminder.quietHours", value: "00:00-23:59" }]);

    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const result = await sendReminders();

    const row = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(row.status, "Scheduled", "a reminder nobody is awake to receive waits");
    assert.equal(provider.calls.length, 0, "and nothing is sent at 3am");
    assert.equal(result.ran, 0);
    assert.match(row.notes, /quiet hours/i);
  });

  test("the held reminder is sent once the window has passed", async () => {
    await saveSettings([{ key: "reminder.quietHours", value: "00:00-23:59" }]);
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });

    await sendReminders();
    const held = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(held.status, "Scheduled");
    const callsWhileHeld = provider.calls.length;

    // The window closes and the release time passes. The row is backdated rather
    // than the clock advanced, because a test cannot wait until 07:00 — and
    // backdating is exactly the state the row is in an hour after it was held.
    await prisma.notification.update({
      where: { id: held.id },
      data: { scheduledAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await saveSettings([{ key: "reminder.quietHours", value: "" }]);
    const second = await sendReminders();

    const sent = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(sent.status, "Sent");
    assert.equal(provider.calls.length, callsWhileHeld + 1, "exactly one delivery");
    assert.match(sent.notes, /quiet hours/);
    assert.ok(second.ran >= 1);
  });

  test("a released reminder is not delivered again by the next run", async () => {
    await saveSettings([{ key: "reminder.quietHours", value: "00:00-23:59" }]);
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    await sendReminders();
    await saveSettings([{ key: "reminder.quietHours", value: "" }]);
    await sendReminders();

    const callsAfterRelease = provider.calls.length;
    await sendReminders();

    assert.equal(provider.calls.length, callsAfterRelease, "still exactly one delivery");
    assert.equal(
      await prisma.notification.count({ where: { customerId: customer.id } }),
      1
    );
  });
});

/* ------------------------------------------------------------------ */

describe("the scheduled-message job leaves reminders alone", () => {
  test("a held reminder is not picked up by the generic queue", async () => {
    // sendScheduledMessages sends on the single channel recorded at scheduling
    // time, with no fallback. Letting it pick up reminders would deliver some of
    // them through a different route than the rest.
    await saveSettings([{ key: "reminder.quietHours", value: "00:00-23:59" }]);
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    await sendReminders();

    const callsHeld = provider.calls.length;
    const { sendScheduledMessages } = await import("../src/lib/services/cron.ts");
    await sendScheduledMessages();

    assert.equal(provider.calls.length, callsHeld, "the reminder is still waiting for its own flush");
    const row = await prisma.notification.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(row.status, "Scheduled");
  });

  test("an ordinary scheduled message still goes out", async () => {
    // The exclusion is on the key, not on the table: the manual queue must keep
    // working.
    const { sendScheduledMessages } = await import("../src/lib/services/cron.ts");
    const callsBefore = provider.calls.length;
    await prisma.notification.create({
      data: {
        channel: "SMS",
        recipient: "01700000001",
        body: "manually queued",
        status: "Scheduled",
        scheduledAt: addDays(new Date(), -1),
      },
    });
    await sendScheduledMessages();
    assert.equal(provider.calls.length, callsBefore + 1);
    await prisma.notification.deleteMany({ where: { body: "manually queued" } });
  });
});

describe("the job as a whole", () => {
  test("reminders are off until an operator turns them on", async () => {
    await saveSettings([{ key: "reminder.enabled", value: "false" }]);
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });

    const result = await sendReminders();
    assert.equal(result.ran, 0);
    assert.match(result.skipped, /switched off/i);
    assert.equal(await prisma.notification.count({ where: { customerId: customer.id } }), 0);
  });

  test("one run covers both kinds for the same customer", async () => {
    const customer = await makeCustomer({ expiryDate: addDays(startOfDay(new Date()), 3) });
    const invoice = await makeInvoice(customer, { daysOverdue: 1 });

    await sendReminders();
    const rows = await prisma.notification.findMany({ where: { customerId: customer.id } });
    const templates = rows.map((r) => r.template).sort();

    assert.deepEqual(templates, ["due-reminder", "expiry-reminder"]);
    assert.ok(
      rows.some((r) => r.idempotencyKey === reminderKey(customer.id, invoice.id, "due", 1))
    );
  });
});