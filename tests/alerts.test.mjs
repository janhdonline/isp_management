/**
 * Device-down alerts.
 *
 * The property under test is the one that stops an alert channel being muted:
 * **one incident, one alert, one page.** Everything else is bookkeeping around it.
 *
 * So the tests measure that by *doing* the noisy thing — running the monitor ten
 * more times while a device is still down, flapping it, and running two monitors
 * concurrently on a fresh transition — and asserting the counts do not move. A
 * check-then-insert passes the happy path and fails all three, which is exactly
 * the bug this design is arranged to be unable to have.
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import {
  dedupeKey,
  raiseAlert,
  resolveAlert,
  evaluateTransitions,
  evaluateSignal,
  deviceHealthWatch,
  listAlerts,
} from "../src/lib/services/device-alerts.ts";

const stamp = Date.now();
const routerIds = [];
const oltIds = [];
const onuIds = [];

/** The ONU id the low-signal cases use; there is no real row behind it. */
const SYNTHETIC_ONU = "onu-1";

/** Everything the notifier sent. The channel is stubbed so nothing leaves the box. */
let sent = [];
let notifyMode = "ok"; // ok | unconfigured | fail

const realFetch = globalThis.fetch;

beforeEach(async () => {
  sent = [];
  notifyMode = "ok";

  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes("telegram.org")) {
      sent.push({ channel: "Telegram", body: JSON.parse(init?.body ?? "{}").text });
      if (notifyMode === "fail") {
        return new Response(JSON.stringify({ ok: false, description: "blocked" }), { status: 403 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(url, init);
  };

  if (routerIds.length) {
    await prisma.deviceAlert.deleteMany({ where: { deviceId: { in: routerIds } } });
  }
  if (oltIds.length) {
    await prisma.deviceAlert.deleteMany({ where: { deviceId: { in: oltIds } } });
  }
  if (onuIds.length) {
    await prisma.deviceAlert.deleteMany({ where: { deviceId: { in: onuIds } } });
  }
  await prisma.deviceAlert.deleteMany({ where: { deviceId: SYNTHETIC_ONU } });
  // The low-signal cases use a synthetic ONU id rather than a real row, so its
  // alerts are cleaned by id too — otherwise a streak alert leaks from one case
  // into the next and the "one alert" counts are wrong.
  await prisma.deviceAlert.deleteMany({ where: { deviceId: SYNTHETIC_ONU } });

  await prisma.setting.deleteMany({ where: { key: { startsWith: "alerts.stateStore" } } });

  await saveSettings([
    { key: "alerts.channel", value: "telegram" },
    { key: "alerts.recipients", value: "" },
    { key: "api.telegramToken", value: "test-bot-token" },
    { key: "api.telegramChatId", value: "@isp_oncall" },
    { key: "alerts.lowSignalDbm", value: "-25" },
    { key: "alerts.lowSignalConsecutive", value: "2" },
  ]);
});

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.setting.deleteMany({ where: { key: { startsWith: "alerts.stateStore" } } });
  for (const ids of [routerIds, oltIds, onuIds]) {
    if (ids.length) await prisma.deviceAlert.deleteMany({ where: { deviceId: { in: ids } } });
  }
  if (routerIds.length) await prisma.router.deleteMany({ where: { id: { in: routerIds } } });
  if (oltIds.length) await prisma.olt.deleteMany({ where: { id: { in: oltIds } } });
  if (onuIds.length) await prisma.onu.deleteMany({ where: { id: { in: onuIds } } });
  await prisma.$disconnect();
});

async function makeRouter(status = "Online") {
  const r = await prisma.router.create({
    data: {
      name: `Alert Router ${routerIds.length + 1} ${stamp}`,
      ipAddress: `10.99.${routerIds.length}.1`,
      apiPort: 8728,
      status,
    },
    select: { id: true, name: true, status: true },
  });
  routerIds.push(r.id);
  return r;
}

async function makeOlt(status = "Online") {
  const o = await prisma.olt.create({
    data: { name: `Alert OLT ${oltIds.length + 1} ${stamp}`, status },
    select: { id: true, name: true, status: true },
  });
  oltIds.push(o.id);
  return o;
}

/** Alerts open for one device — the table is shared across this file's tests. */
const openFor = (id) =>
  prisma.deviceAlert.count({ where: { deviceId: id, status: "Open" } });
const totalFor = (id, kind) =>
  prisma.deviceAlert.count({ where: { deviceId: id, kind } });

const observe = (r) => ({
  deviceType: "Router",
  deviceId: r.id,
  deviceName: r.name,
  status: r.status,
  detail: "test",
});

/* ------------------------------------------------------------------ */

describe("Online → Offline", () => {
  test("one Down alert and one notification, however many runs follow", async () => {
    const router = await makeRouter();

    // First sight of an already-offline router raises nothing: nobody said anything
    // was wrong, so nothing is. This is what stops a fresh deployment paging for
    // every device already down.
    await evaluateTransitions([{ ...observe(router), status: "Offline" }]);

    // The transition: online, then offline.
    const online = await makeRouter("Online");
    await evaluateTransitions([observe(online)]);
    sent = [];
    await evaluateTransitions([{ ...observe(online), status: "Offline" }]);

    let alerts = await prisma.deviceAlert.findMany({ where: { deviceId: online.id, kind: "Down" } });
    assert.equal(alerts.length, 1, "one alert");
    assert.equal(alerts[0].status, "Open");
    assert.equal(sent.length, 1, "and exactly one notification");

    // Ten more monitor runs with the device still down.
    for (let i = 0; i < 10; i++) {
      await evaluateTransitions([{ ...observe(online), status: "Offline" }]);
    }

    alerts = await prisma.deviceAlert.findMany({ where: { deviceId: online.id, kind: "Down" } });
    assert.equal(alerts.length, 1, "ten more runs, still one alert");
    assert.equal(sent.length, 1, "and still one notification — an alert storm is worse than none");
  });

  test("a device already offline when the monitor starts raises nothing", async () => {
    const r = await makeRouter("Offline");
    const result = await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    assert.equal(result.raised, 0);
    assert.equal(sent.length, 0, "nothing was said about it, so it is not an incident");
    assert.equal(await openFor(r.id), 0);
  });

  test("the alert records who was notified, and how", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);

    const alert = await prisma.deviceAlert.findFirstOrThrow({ where: { deviceId: r.id } });
    assert.ok(alert.notifiedAt, "a page that went out is timestamped");
    assert.equal(alert.notifyChannel, "Telegram", "the adapter name, not the setting's");
    assert.equal(alert.notifyError, null);
  });

  test("a failed page still leaves the alert open, with the reason recorded", async () => {
    // "Nobody was told" and "nobody needed telling" must not look the same.
    notifyMode = "fail";
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);

    const alert = await prisma.deviceAlert.findFirstOrThrow({ where: { deviceId: r.id } });
    assert.equal(alert.status, "Open", "the device really is down");
    assert.equal(alert.notifiedAt, null, "and nobody was told");
    assert.match(alert.notifyError ?? "", /Telegram/);
  });

  test("an unconfigured channel records why rather than claiming success", async () => {
    await saveSettings([{ key: "api.telegramToken", value: "" }]);
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);

    const alert = await prisma.deviceAlert.findFirstOrThrow({ where: { deviceId: r.id } });
    assert.equal(alert.notifiedAt, null);
    assert.match(alert.notifyError ?? "", /not configured/i);
  });
});

/* ------------------------------------------------------------------ */

describe("Offline → Online", () => {
  test("a Recovered notice is raised and the Down alert is resolved", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    sent = [];

    const result = await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    assert.equal(result.recovered, 1);

    const down = await prisma.deviceAlert.findFirstOrThrow({
      where: { deviceId: r.id, kind: "Down" },
    });
    assert.equal(down.status, "Resolved");
    assert.ok(down.resolvedAt);
    assert.equal(down.dedupeKey, null, "freeing the key is what lets the next outage alert");

    const rec = await prisma.deviceAlert.findFirstOrThrow({
      where: { deviceId: r.id, kind: "Recovered" },
    });
    // Born Resolved, with no dedupe key: a recovery is a historical event, not an
    // open incident. Left Open it would sit in the dashboard's open count for ever,
    // and its key would swallow the *next* recovery notice.
    assert.equal(rec.status, "Resolved", "there is nothing outstanding about a device that is working");
    assert.ok(rec.resolvedAt);
    assert.equal(rec.dedupeKey, null);
    assert.equal(sent.length, 1, "exactly one recovery notice");
    assert.match(sent[0].body, /RECOVERED/);
  });

  test("a second Online run does not raise a second Recovered", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    sent = [];
    // Still online, and there is no open Down to resolve, so there is no recovery
    // to announce — the notice follows the incident, not the poll.
    await evaluateTransitions([{ ...observe(r), status: "Online" }]);

    assert.equal(
      await prisma.deviceAlert.count({ where: { deviceId: r.id, kind: "Recovered" } }),
      1
    );
    assert.equal(sent.length, 0);
  });

  test("a second outage and recovery gets its own notice — the case that was dropped", async () => {
    // The regression this fixes. With Recovered claiming a dedupe key, the first
    // recovery kept that key for ever; the second outage's recovery hit the unique
    // violation and was discarded, so the operator got paged "router down" and
    // never told it was fixed again.
    const r = await makeRouter("Online");
    const cycle = async () => {
      await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
      sent = [];
      await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    };

    await evaluateTransitions([observe(r)]);
    await cycle();
    assert.equal(await totalFor(r.id, "Down"), 1);
    assert.equal(await totalFor(r.id, "Recovered"), 1);
    assert.equal(sent.length, 1, "first recovery notified");

    sent = [];
    await cycle();

    assert.equal(await totalFor(r.id, "Down"), 2, "the second outage alerts again");
    assert.equal(
      await totalFor(r.id, "Recovered"),
      2,
      "and the second recovery gets its own row instead of being swallowed by the first"
    );
    assert.equal(sent.length, 1, "and notifies — an outage page with no all-clear is the failure");

    // Both recoveries are historical: neither is counted as open.
    const recoveries = await prisma.deviceAlert.findMany({
      where: { deviceId: r.id, kind: "Recovered" },
    });
    assert.ok(recoveries.every((x) => x.status === "Resolved"));
    assert.ok(recoveries.every((x) => x.dedupeKey === null));
    assert.equal(await openFor(r.id), 0, "nothing is open once the device is back");
  });

  test("three recoveries in a row each notify", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    let notices = 0;
    for (let i = 0; i < 3; i++) {
      await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
      sent = [];
      await evaluateTransitions([{ ...observe(r), status: "Online" }]);
      notices += sent.length;
    }
    assert.equal(await totalFor(r.id, "Recovered"), 3, "one row per incident, no dedupe between them");
    assert.equal(notices, 3, "and one notification each");
  });

  test("a second outage after a recovery alerts again", async () => {
    // The regression that freeing the dedupe key exists to prevent: leaving it set
    // would stop this router ever alerting again.
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    sent = [];

    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    assert.equal(await prisma.deviceAlert.count({ where: { deviceId: r.id, kind: "Down" } }), 2);
    assert.equal(sent.length, 1, "the second outage is a real incident and is paged");
  });
});

/* ------------------------------------------------------------------ */

describe("flapping", () => {
  test("off/online/off across runs leaves one open Down, not three", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);

    await evaluateTransitions([{ ...observe(r), status: "Offline" }]); // down
    await evaluateTransitions([{ ...observe(r), status: "Online" }]); // up, resolved
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]); // down again

    const open = await prisma.deviceAlert.findMany({
      where: { deviceId: r.id, kind: "Down", status: "Open" },
    });
    assert.equal(open.length, 1, "one incident is open at a time — the second outage is a second incident");

    const total = await prisma.deviceAlert.count({
      where: { deviceId: r.id, kind: "Down" },
    });
    assert.equal(total, 2, "two outages, so two rows: one resolved, one open");
  });

  test("rapid off/on/off/on never leaves two open Down alerts", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    for (let i = 0; i < 5; i++) {
      await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
      await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    }
    const open = await prisma.deviceAlert.count({
      where: { deviceId: r.id, kind: "Down", status: "Open" },
    });
    assert.equal(open, 0, "each recovery resolves the outage before the next one opens");
  });
});

/* ------------------------------------------------------------------ */

describe("concurrency", () => {
  test("two monitors on a fresh transition produce one alert row", async () => {
    // The race a check-then-insert loses and the unique key wins.
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    sent = [];

    await Promise.all([
      evaluateTransitions([{ ...observe(r), status: "Offline" }]),
      evaluateTransitions([{ ...observe(r), status: "Offline" }]),
    ]);

    const alerts = await prisma.deviceAlert.findMany({ where: { deviceId: r.id, kind: "Down" } });
    assert.equal(alerts.length, 1, "the index settled it, not a check");
    assert.equal(sent.length, 1, "and only one notification went out");
  });

  test("four concurrent monitors on a fresh transition still produce one row", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    sent = [];
    await Promise.all(
      Array.from({ length: 4 }, () => evaluateTransitions([{ ...observe(r), status: "Offline" }]))
    );
    assert.equal(await prisma.deviceAlert.count({ where: { deviceId: r.id, kind: "Down" } }), 1);
    assert.equal(sent.length, 1);
  });

  test("a second outage after a recovery, raced, still produces one alert", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    await evaluateTransitions([{ ...observe(r), status: "Online" }]);
    sent = [];

    await Promise.all(
      Array.from({ length: 3 }, () => evaluateTransitions([{ ...observe(r), status: "Offline" }]))
    );
    assert.equal(
      await prisma.deviceAlert.count({ where: { deviceId: r.id, kind: "Down", status: "Open" } }),
      1
    );
  });
});

/* ------------------------------------------------------------------ */

describe("OLTs are watched too", () => {
  test("an OLT going down alerts the same way", async () => {
    const olt = await makeOlt("Online");
    await evaluateTransitions([
      { deviceType: "OLT", deviceId: olt.id, deviceName: olt.name, status: "Online", detail: "t" },
    ]);
    sent = [];
    await evaluateTransitions([
      { deviceType: "OLT", deviceId: olt.id, deviceName: olt.name, status: "Offline", detail: "t" },
    ]);

    const alert = await prisma.deviceAlert.findFirstOrThrow({ where: { deviceId: olt.id } });
    assert.equal(alert.kind, "Down");
    assert.equal(alert.deviceType, "OLT");
    assert.equal(sent.length, 1);
  });
});

/* ------------------------------------------------------------------ */

describe("ONU low signal", () => {
  const onus = (rx) => [
    { id: SYNTHETIC_ONU, name: "ONU 1", serialNo: "SN1", rxPower: rx, status: "Online" },
  ];

  test("one bad reading does not alert; two consecutive do", async () => {
    // One reading is a dip. Alerting on it trains the operator to ignore the
    // signal, which is worse than not having it.
    const first = await evaluateSignal(onus(-28));
    assert.equal(first.raised, 0, "a single below-threshold reading is not a trend");
    assert.equal(await totalFor("onu-1", "LowSignal"), 0);

    const second = await evaluateSignal(onus(-28));
    assert.equal(second.raised, 1, "two in a row is a trend");
    assert.equal(await totalFor("onu-1", "LowSignal"), 1, "one alert for the bad-reading ONU");

    const alert = await prisma.deviceAlert.findFirstOrThrow({
      where: { kind: "LowSignal", deviceId: "onu-1" },
    });
    assert.equal(alert.deviceType, "ONU");
    assert.match(alert.detail ?? "", /-28\.0 dBm/);
    assert.match(alert.detail ?? "", /2 consecutive/);
  });

  test("a good reading between two bad ones resets the streak", async () => {
    await evaluateSignal(onus(-28));
    await evaluateSignal(onus(-20));
    const third = await evaluateSignal(onus(-28));
    assert.equal(third.raised, 0, "the streak restarted, so this is only the first bad reading again");
    assert.equal(await prisma.deviceAlert.count({ where: { kind: "LowSignal", deviceId: "onu-1" } }), 0);
  });

  test("signal recovering resolves the alert and frees the key", async () => {
    await evaluateSignal(onus(-28));
    await evaluateSignal(onus(-28));
    assert.equal(await totalFor("onu-1", "LowSignal"), 1);

    const result = await evaluateSignal(onus(-22));
    assert.equal(result.recovered, 1);
    assert.equal(await totalFor("onu-1", "LowSignal"), 1);

    const alert = await prisma.deviceAlert.findFirstOrThrow({
      where: { kind: "LowSignal", deviceId: "onu-1" },
    });
    assert.equal(alert.status, "Resolved");

    // And it can alert again afterwards.
    await evaluateSignal(onus(-28));
    await evaluateSignal(onus(-28));
    assert.equal(await totalFor("onu-1", "LowSignal"), 2, "a new bad streak is a new incident");
  });

  test("a third consecutive bad reading does not re-alert", async () => {
    await evaluateSignal(onus(-28));
    await evaluateSignal(onus(-28));
    sent = [];
    await evaluateSignal(onus(-29));
    assert.equal(sent.length, 0, "the alert is open; another bad reading is the same incident");
  });

  test("an ONU with no reading is not called low signal", async () => {
    // No reading means it is not reporting, which is a different failure handled
    // elsewhere — guessing a value here would page for the wrong thing.
    const r = await evaluateSignal([{ id: "onu-x", name: "ONU X", serialNo: "S", rxPower: null, status: "Offline" }]);
    assert.equal(r.raised, 0);
    assert.equal(await totalFor("onu-x", "LowSignal"), 0);
  });

  test("the threshold is the one configured", async () => {
    await saveSettings([{ key: "alerts.lowSignalDbm", value: "-30" }]);
    const r = await evaluateSignal(onus(-28));
    assert.equal(r.raised, 0, "-28 dBm is fine on a -30 threshold");
    await saveSettings([{ key: "alerts.lowSignalDbm", value: "-25" }]);
  });

  test("the streak survives between runs, as it must", async () => {
    // The counter lives in the database rather than in memory, so a monitor that
    // restarted on every deploy would never reach two and would never alert at all.
    await evaluateSignal(onus(-28));
    const stored = await prisma.setting.findFirst({
      where: { key: { startsWith: "alerts.stateStore" } },
    });
    assert.ok(stored, "the streak is persisted");
    assert.match(stored.value, new RegExp(`"${SYNTHETIC_ONU}":1`));
  });
});

/* ------------------------------------------------------------------ */

describe("the dedupe key", () => {
  test("it names the device and the open state", () => {
    assert.equal(dedupeKey("Router", "abc", "Down"), "Router:abc:Down:Open");
  });

  test("resolving frees it", async () => {
    const r = await makeRouter();
    await raiseAlert({
      deviceType: "Router",
      deviceId: r.id,
      deviceName: r.name,
      kind: "Down",
      detail: "x",
    });
    assert.equal(
      await prisma.deviceAlert.count({ where: { dedupeKey: dedupeKey("Router", r.id, "Down") } }),
      1
    );
    await resolveAlert("Router", r.id, "Down");
    assert.equal(
      await prisma.deviceAlert.count({ where: { dedupeKey: dedupeKey("Router", r.id, "Down") } }),
      0,
      "a stale key would silence the next outage for ever"
    );
  });

  test("raising twice directly produces one row", async () => {
    const r = await makeRouter();
    const args = { deviceType: "Router", deviceId: r.id, deviceName: r.name, kind: "Down", detail: "x" };
    await raiseAlert(args);
    const second = await raiseAlert(args);
    assert.equal(second.created, false, "the second call reports that it created nothing");
    assert.equal(await prisma.deviceAlert.count({ where: { deviceId: r.id, kind: "Down" } }), 1);
  });
});

/* ------------------------------------------------------------------ */

describe("the job as a whole", () => {
  test("it reads the real tables and reports what it did", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await prisma.router.update({ where: { id: r.id }, data: { status: "Offline" } });

    const result = await deviceHealthWatch();
    assert.match(result.skipped, /outage/);
    assert.ok(result.ran >= 1);
    assert.equal(await openFor(r.id), 1);
  });

  test("the dashboard's open count never includes Recovered rows", async () => {
    // The banner answers "what is broken right now". A recovery left Open would sit
    // in that count for ever, so a device fixed months ago keeps the dashboard red.
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    await evaluateTransitions([{ ...observe(r), status: "Online" }]);

    const open = await listAlerts({ status: "Open" });
    assert.ok(
      open.rows.every((a) => a.kind !== "Recovered"),
      "an Open list containing a Recovered means recoveries are not being resolved"
    );
    assert.equal(
      open.rows.filter((a) => a.deviceId === r.id).length,
      0,
      "a recovered device contributes nothing to the banner"
    );

    // And a device that is genuinely down still counts.
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);
    const afterOutage = await listAlerts({ status: "Open" });
    assert.equal(
      afterOutage.rows.filter((a) => a.deviceId === r.id).length,
      1,
      "a real outage still registers"
    );
  });

  test("reading the list filters by status and device", async () => {
    const r = await makeRouter("Online");
    await evaluateTransitions([observe(r)]);
    await evaluateTransitions([{ ...observe(r), status: "Offline" }]);

    const open = await listAlerts({ status: "Open" });
    assert.ok(open.rows.every((a) => a.status === "Open"));
    assert.ok(open.openCount >= 1);
    assert.ok(open.rows.some((a) => a.deviceId === r.id));

    const byType = await listAlerts({ deviceType: "Router" });
    assert.ok(byType.rows.every((a) => a.deviceType === "Router"));

    const none = await listAlerts({ deviceType: "Nope" });
    assert.equal(none.rows.length, 0);
  });
});