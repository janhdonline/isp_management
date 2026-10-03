import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import {
  portOf,
  isUnassigned,
  UNASSIGNED,
  readPonSettings,
  splitRatioFor,
  tallyPorts,
  firstFreeSlot,
  ponUsageFor,
  listPorts,
  nearCapacityPorts,
  suggestPort,
  assignOnuPort,
  ponUtilisationReport,
  DEFAULT_SPLIT,
} from "../src/lib/services/pon.ts";

/**
 * Phase O — PON port capacity planning.
 *
 * The scenario is one customer: an ONU arrives, an operator picks a port, and the
 * port is full. The customer does not get service and nobody can say why. Every
 * test here is about making that impossible rather than merely visible.
 */

const STAMP = Date.now();
const SETTINGS_KEYS = ["pon.defaultSplitRatio", "pon.nearCapacityPercent"];
let originalSettings = {};

let olt;
let area;
let user;
const created = { onus: [], olts: [], customers: [] };

before(async () => {
  for (const key of SETTINGS_KEYS) {
    const row = await prisma.setting.findUnique({ where: { key } });
    originalSettings[key] = row?.value ?? null;
  }
  await sweep();
  await setSettings({ "pon.defaultSplitRatio": "64", "pon.nearCapacityPercent": "90" });

  area = await prisma.area.findFirstOrThrow();
  user = await prisma.user.findFirstOrThrow({ select: { id: true } });

  olt = await prisma.olt.create({
    data: {
      name: `pon-olt-${STAMP}`,
      vendor: "Huawei",
      status: "Online",
      ponPorts: 8,
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
  await clearOnus();
  invalidateSettingsCache();
});

/** Takes a plain `{ key: value }` map, which is how the call sites read best. */
async function setSettings(map) {
  await saveSettings(Object.entries(map).map(([key, value]) => ({ key, value })));
  invalidateSettingsCache();
}

/** Removes what a previous *interrupted* run left behind — `after` cannot do it. */
async function sweep() {
  await prisma.olt.deleteMany({ where: { name: { startsWith: "pon-olt-" } } });
  await prisma.onu.deleteMany({ where: { serialNo: { startsWith: "PONT" } } });
  await prisma.customer.deleteMany({ where: { customerCode: { startsWith: "PON-" } } });
}

async function clearOnus() {
  if (created.onus.length) {
    await prisma.onu.deleteMany({ where: { id: { in: created.onus } } });
  }
  created.onus.length = 0;
}

/**
 * Adds `count` ONUs to `port`, continuing from the highest slot already on it.
 *
 * Continuing rather than restarting from 1 is what lets a test build a port up in
 * steps — `fill(p, 10)` then `fill(p, 54)` to reach 64 — without two calls
 * colliding on `Onu.serialNo`, and it matches how an operator would think about
 * "put another 54 on that port".
 */
async function fill(port, count, over = {}) {
  const existing = await prisma.onu.findMany({
    where: { oltId: olt.id, ponIndex: { startsWith: `${port}:` } },
    select: { ponIndex: true },
  });
  let slot = existing.reduce((max, row) => {
    const n = Number(/:(\d+)$/.exec(row.ponIndex ?? "")?.[1] ?? 0);
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);

  const ids = [];
  for (let i = 0; i < count; i++) {
    slot += 1;
    const row = await prisma.onu.create({
      data: {
        serialNo: `PONT${STAMP}${port.replace(/\W/g, "")}${String(slot).padStart(3, "0")}`,
        oltId: olt.id,
        ponIndex: `${port}:${slot}`,
        status: "Online",
        ...over,
      },
      select: { id: true, serialNo: true },
    });
    created.onus.push(row.id);
    ids.push(row.id);
  }
  return ids;
}

/** An ONU with no port — the gap an operator must be shown. */
async function unassigned(count) {
  const ids = [];
  for (let i = 1; i <= count; i++) {
    const row = await prisma.onu.create({
      data: {
        serialNo: `PONT${STAMP}U${String(i).padStart(5, "0")}`,
        oltId: olt.id,
        ponIndex: null,
        status: "Provisioning",
      },
      select: { id: true },
    });
    created.onus.push(row.id);
    ids.push(row.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------

describe("a port is the part before the colon", () => {
  test("0/1/1:2 is port 0/1/1, ONU slot 2", () => {
    assert.equal(portOf("0/1/1:2"), "0/1/1");
    assert.equal(portOf("0/1/1:64"), "0/1/1");
  });

  test("counting the whole string would put every ONU on its own port", () => {
    // The reason the parse exists: 64 ONUs on one port, seen as 64 ports.
    const rows = tallyPorts(
      Array.from({ length: 64 }, (_, i) => ({ ponIndex: `0/1/1:${i + 1}`, serialNo: `S${i}` })),
      64,
      90
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].used, 64);
    assert.equal(rows[0].percent, 100);
    assert.equal(rows[0].atCapacity, true);
  });

  test("an index with no colon is taken whole", () => {
    // Phase N's SNMP driver writes `slot:3` when a vendor does not report the
    // frame. That is still one bucket, and it must not be dropped.
    assert.equal(portOf("slot:3"), "slot");
    assert.equal(portOf("0/1/1"), "0/1/1");
  });

  test("nothing unparseable vanishes", () => {
    assert.equal(portOf(null), UNASSIGNED);
    assert.equal(portOf(undefined), UNASSIGNED);
    assert.equal(portOf(""), UNASSIGNED);
    assert.equal(portOf("   "), UNASSIGNED);
    assert.equal(portOf(":5"), UNASSIGNED, "a port with no head is not a port");
    assert.equal(isUnassigned(UNASSIGNED), true);
    assert.equal(isUnassigned("0/1/1"), false);
  });

  test("unassigned sorts last, because it is the worst row", () => {
    const rows = tallyPorts(
      [
        { ponIndex: null, serialNo: "U" },
        { ponIndex: "0/1/1:1", serialNo: "A" },
        { ponIndex: "0/1/2:1", serialNo: "B" },
      ],
      64,
      90
    );
    assert.deepEqual(rows.map((r) => r.port), ["0/1/1", "0/1/2", UNASSIGNED]);
  });
});

describe("thresholds", () => {
  test("defaults are 64 and 90", () => {
    const s = readPonSettings({});
    assert.equal(s.defaultSplitRatio, 64);
    assert.equal(DEFAULT_SPLIT, 64);
    assert.equal(s.nearCapacityPercent, 90);
  });

  test("a nonsense value cannot break the form", () => {
    // A split of 0 would make every port permanently full, and the suggestion
    // would return nothing with no explanation for the operator.
    assert.equal(readPonSettings({ "pon.defaultSplitRatio": "0" }).defaultSplitRatio, 64);
    assert.equal(readPonSettings({ "pon.defaultSplitRatio": "-8" }).defaultSplitRatio, 64);
    assert.equal(readPonSettings({ "pon.defaultSplitRatio": "x" }).defaultSplitRatio, 64);
    assert.equal(readPonSettings({ "pon.nearCapacityPercent": "0" }).nearCapacityPercent, 90);
    assert.equal(readPonSettings({ "pon.nearCapacityPercent": "500" }).nearCapacityPercent, 90);
    assert.equal(readPonSettings({ "pon.nearCapacityPercent": "75" }).nearCapacityPercent, 75);
    assert.equal(readPonSettings({ "pon.defaultSplitRatio": "32.9" }).defaultSplitRatio, 32);
  });

  test("a cabinet's own ratio wins over the network default", () => {
    assert.equal(splitRatioFor({ splitRatio: 32 }, 64), 32);
    assert.equal(splitRatioFor({ splitRatio: null }, 64), 64);
    assert.equal(splitRatioFor({ splitRatio: 0 }, 64), 64, "zero is unset, not a zero split");
    assert.equal(splitRatioFor({ splitRatio: -1 }, 64), 64);
  });

  test("slots are 1-based, because that is what vendors use", () => {
    assert.equal(firstFreeSlot([], 64), 1);
    assert.equal(firstFreeSlot([{ ponIndex: "0/1/1:1" }], 64), 2);
    // A hole is reused rather than skipped: the OLT does not care, and reusing it
    // keeps a port from reporting 60 used with 4 free.
    assert.equal(
      firstFreeSlot([{ ponIndex: "0/1/1:1" }, { ponIndex: "0/1/1:3" }], 64),
      2
    );
    const full = Array.from({ length: 64 }, (_, i) => ({ ponIndex: `0/1/1:${i + 1}` }));
    assert.equal(firstFreeSlot(full, 64), null);
  });
});

describe("a cabinet with three ports", () => {
  beforeEach(async () => {
    await fill("0/1/1", 64);
    await fill("0/1/2", 58);
    await fill("0/1/3", 10);
  });

  test("the suggestion is the least-loaded port, never the full one", async () => {
    const suggestion = await suggestPort(olt.id);
    assert.ok(suggestion, "a port is available");
    assert.equal(suggestion.port, "0/1/3", "not the full one, and not the 58/64 one");
    assert.equal(suggestion.used, 10);
    assert.equal(suggestion.free, 54);
  });

  test("a full port is absent from the suggestions entirely", async () => {
    const ports = await listPorts(olt.id);
    const full = ports.find((p) => p.port === "0/1/1");
    assert.equal(full.used, 64);
    assert.equal(full.atCapacity, true);
    assert.equal(full.free, 0);
    assert.equal(full.percent, 100);

    // The backend, not the UI: the suggestion function cannot return it.
    for (let i = 0; i < 25; i++) {
      const s = await suggestPort(olt.id);
      assert.notEqual(s?.port, "0/1/1");
    }
  });

  test("the port at 90% is flagged, and the full one is too", async () => {
    const ports = await listPorts(olt.id);
    const busy = ports.find((p) => p.port === "0/1/2");
    assert.equal(busy.used, 58);
    assert.equal(busy.percent, 91, "58 of 64 is 90.6%, rounded up");
    assert.equal(busy.nearCapacity, true, "warned before it is full");
    assert.equal(busy.atCapacity, false, "and still assignable");

    const near = await nearCapacityPorts(olt.id);
    assert.deepEqual(near.map((p) => p.port), ["0/1/1", "0/1/2"]);
  });

  test("the numbers reconcile exactly with the ONU table", async () => {
    const inDb = await prisma.onu.count({ where: { oltId: olt.id } });
    const usage = await ponUsageFor(olt.id);
    assert.equal(usage.totals.onus, inDb);
    assert.equal(usage.ports.reduce((sum, p) => sum + p.used, 0), inDb);
    assert.equal(usage.totals.capacity, 3 * 64);
    assert.equal(usage.totals.percent, Math.round((132 / 192) * 100));

    // Per port, straight from a count rather than from the same tally.
    for (const p of usage.ports) {
      const direct = await prisma.onu.count({
        where: { oltId: olt.id, ponIndex: { startsWith: `${p.port}:` } },
      });
      assert.equal(p.used, direct, `port ${p.port}`);
    }
  });

  test("moving an ONU off a port is reflected on the next read", async () => {
    const before_ = await suggestPort(olt.id);
    assert.equal(before_.port, "0/1/3");

    const moved = await prisma.onu.findFirstOrThrow({
      where: { oltId: olt.id, ponIndex: { startsWith: "0/1/3:" } },
    });
    await prisma.onu.update({ where: { id: moved.id }, data: { ponIndex: null } });

    const after_ = await ponUsageFor(olt.id);
    assert.equal(after_.ports.find((p) => p.port === "0/1/3").used, 9);
    assert.equal(after_.unassigned, 1, "and it shows up as unassigned rather than vanishing");
  });

  test("changing the split ratio recomputes immediately", async () => {
    // 64 → 32. The port with 58 ONUs is now *over* capacity, not at 91%.
    await prisma.olt.update({ where: { id: olt.id }, data: { splitRatio: 32 } });

    const usage = await ponUsageFor(olt.id);
    assert.equal(usage.splitRatio, 32, "the cabinet's own ratio is in force");
    assert.equal(usage.ports.find((p) => p.port === "0/1/2").atCapacity, true,
      "58 on a 1:32 port is over capacity, and saying otherwise would be the bug");
    assert.equal(usage.totals.capacity, 3 * 32);

    const near = await nearCapacityPorts(olt.id);
    assert.ok(!near.some((p) => p.port === "0/1/3"), "10 of 32 is not near capacity");
    assert.ok(near.some((p) => p.port === "0/1/2"));

    const suggestion = await suggestPort(olt.id);
    assert.equal(suggestion.port, "0/1/3");
    assert.equal(suggestion.splitRatio, 32);

    await prisma.olt.update({ where: { id: olt.id }, data: { splitRatio: null } });
    assert.equal((await ponUsageFor(olt.id)).splitRatio, 64, "back to the network default");
  });

  test("a cabinet with every port full suggests nothing, and says why", async () => {
    await prisma.olt.update({ where: { id: olt.id }, data: { splitRatio: 1 } });
    // Every port now holds more than one ONU, so all three are over capacity.
    const suggestion = await suggestPort(olt.id);
    assert.equal(suggestion, null, "null is a real answer: the cabinet needs another port");
    await prisma.olt.update({ where: { id: olt.id }, data: { splitRatio: null } });
  });
});

describe("ONUs with no port", () => {
  test("they are counted, not lost", async () => {
    await fill("0/1/1", 5);
    await unassigned(7);

    const usage = await ponUsageFor(olt.id);
    assert.equal(usage.unassigned, 7);
    assert.equal(usage.totals.onus, 12, "every ONU on the cabinet is accounted for");

    const bucket = usage.ports.find((p) => isUnassigned(p.port));
    assert.equal(bucket.used, 7);
    assert.equal(bucket.atCapacity, true, "no port is the problem, so it reads as full");
    assert.equal(bucket.percent, 100, "and a full bar is the loudest honest way to say so");

    // They are excluded from the suggestion: an unassigned bucket is not somewhere
    // to put the next ONU.
    const suggestion = await suggestPort(olt.id);
    assert.equal(suggestion.port, "0/1/1");
  });

  test("the report carries the total across every cabinet", async () => {
    await fill("0/1/1", 3);
    await unassigned(4);
    const other = await prisma.olt.create({
      data: { name: `pon-olt-b-${STAMP}`, status: "Online", areaId: area.id },
      select: { id: true, name: true },
    });
    created.olts.push(other.id);
    await prisma.onu.create({
      data: { serialNo: `PONT${STAMP}B00001`, oltId: other.id, ponIndex: null, status: "Online" },
    });

    const report = await ponUtilisationReport();
    const mine = report.rows.find((r) => r.oltId === olt.id);
    assert.equal(mine.unassigned, 4);
    assert.equal(report.totals.unassigned, 5, "including the other cabinet");

    // A cabinet with nothing on it is reported as empty rather than omitted — it
    // is the cabinet the next customer should go on.
    assert.ok(report.rows.some((r) => r.oltId === other.id));
    assert.ok(report.totals.olts >= 2);
  });
});

describe("assigning an ONU to a port", () => {
  test("the suggested port is accepted and the slot is the lowest free one", async () => {
    await fill("0/1/1", 3);
    const [free] = await unassigned(1);

    const suggestion = await suggestPort(olt.id);
    const result = await assignOnuPort({
      onuId: free,
      port: suggestion.port,
      actorId: user.id,
    });

    assert.equal(result.ok, true);
    const row = await prisma.onu.findUniqueOrThrow({ where: { id: free } });
    assert.equal(row.ponIndex, "0/1/1:4", "after three, the fourth slot");
  });

  test("a full port is refused, with somewhere else to go", async () => {
    await fill("0/1/1", 64);
    await fill("0/1/2", 10);
    const [free] = await unassigned(1);

    const result = await assignOnuPort({ onuId: free, port: "0/1/1", actorId: user.id });

    assert.equal(result.ok, false);
    assert.match(result.reason, /full — 64 of 64/);
    assert.equal(result.suggested, "0/1/2", "the operator is handed the alternative");

    const row = await prisma.onu.findUniqueOrThrow({ where: { id: free } });
    assert.equal(row.ponIndex, null, "and nothing was written");
  });

  test("an ONU that is not on an OLT is refused, not guessed at", async () => {
    const stray = await prisma.onu.create({
      data: { serialNo: `PONT${STAMP}STRAY`, status: "Provisioning" },
      select: { id: true },
    });
    created.onus.push(stray.id);

    const result = await assignOnuPort({ onuId: stray.id, port: "0/1/1", actorId: user.id });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not on an OLT/);
    assert.equal(result.suggested, null);
  });

  test("moving an ONU between ports does not double-count it", async () => {
    const ids = await fill("0/1/1", 64);
    const moving = ids[0];
    const result = await assignOnuPort({ onuId: moving, port: "0/1/2", actorId: user.id });

    assert.equal(result.ok, true);
    const row = await prisma.onu.findUniqueOrThrow({ where: { id: moving } });
    assert.equal(row.ponIndex, "0/1/2:1");
    // It vacated slot 1, which is then free again.
    const ports = await listPorts(olt.id);
    assert.equal(ports.find((p) => p.port === "0/1/1").used, 63);
    assert.equal(ports.find((p) => p.port === "0/1/2").used, 1);
  });
});

describe("two operators, one slot left", () => {
  test("exactly one wins and the other is re-suggested, with no overfill", async () => {
    // A port with 63 ONUs on a 64 split: one slot left.
    await prisma.olt.update({ where: { id: olt.id }, data: { splitRatio: 64 } });
    const existing = await fill("0/1/1", 63);
    const [a, b] = await unassigned(2);
    await fill("0/1/2", 5);

    // Both operators pick the same port at the same moment. A count-then-insert
    // would let both through and put 65 ONUs on a 64 split — which is the failure
    // this whole module exists to prevent, reached *through* the check.
    const [first, second] = await Promise.all([
      assignOnuPort({ onuId: a, port: "0/1/1", actorId: user.id }),
      assignOnuPort({ onuId: b, port: "0/1/1", actorId: user.id }),
    ]);

    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);
    assert.equal(winners.length, 1, "exactly one operator got the slot");
    assert.equal(losers.length, 1);
    assert.equal(losers[0].suggested, "0/1/2", "the other is pointed at a port with room");

    // 63 on the contended port, 5 on the other, and the two that raced. Both
    // exist; one just did not get that port.
    const inDb = await prisma.onu.count({ where: { oltId: olt.id } });
    assert.equal(inDb, 63 + 5 + 2, "both ONUs exist; one just did not get that port");

    const ports = await listPorts(olt.id);
    const full = ports.find((p) => p.port === "0/1/1");
    assert.equal(full.used, 64, "exactly at capacity");
    assert.ok(
      full.used <= 64,
      `overfilled: ${full.used} ONUs on a 64 split — the exact bug this guards`
    );
    assert.equal(full.atCapacity, true);

    // The loser is still unassigned, and still counted as such.
    assert.equal(ports.find((p) => isUnassigned(p.port))?.used ?? 0, 1);
    void existing;
  });

  test("six operators racing for one slot leave it at one", async () => {
    await fill("0/1/1", 63);
    const ids = await unassigned(6);

    const results = await Promise.all(
      ids.map((id) => assignOnuPort({ onuId: id, port: "0/1/1", actorId: user.id }))
    );

    assert.equal(results.filter((r) => r.ok).length, 1);
    const used = (await listPorts(olt.id)).find((p) => p.port === "0/1/1").used;
    assert.equal(used, 64);
  });

  test("the port is still not over capacity afterwards, on a fresh read", async () => {
    await fill("0/1/1", 63);
    const [a, b] = await unassigned(2);
    await Promise.all([
      assignOnuPort({ onuId: a, port: "0/1/1", actorId: user.id }),
      assignOnuPort({ onuId: b, port: "0/1/1", actorId: user.id }),
    ]);

    const direct = await prisma.onu.count({
      where: { oltId: olt.id, ponIndex: { startsWith: "0/1/1:" } },
    });
    assert.equal(direct, 64, "counted straight from the table, not from the tally");
  });
});

describe("the suggestion is never stale", () => {
  test("it is recomputed on every call, not remembered", async () => {
    await fill("0/1/1", 10);
    await fill("0/1/2", 40);

    const first = await suggestPort(olt.id);
    assert.equal(first.port, "0/1/1", "10 beats 40");
    assert.equal(first.used, 10);

    // Load the *other* port up behind the suggestion's back. Nothing about the
    // answer should change, and nothing should be recomputed either.
    await fill("0/1/3", 30);
    assert.equal((await suggestPort(olt.id)).port, "0/1/1", "a busier neighbour changes nothing");

    // Now fill the suggested one. The answer has to move on its own, because there
    // is no cache to expire.
    await fill("0/1/1", 54);
    const moved = await suggestPort(olt.id);
    assert.equal(moved.port, "0/1/3", "the suggestion followed the live data");
    assert.equal(moved.used, 30);

    // And two calls in a row agree, so an operator writing down what they were told
    // and coming back later gets the same answer for the same state.
    assert.deepEqual(await suggestPort(olt.id), moved, "stable for a stable state");
  });
});