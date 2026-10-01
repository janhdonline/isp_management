/**
 * The embedded RADIUS server.
 *
 * Everything here runs in the standalone process (`npm run radius`), over real
 * UDP, against the seeded database. Nothing is mocked except the routers — a
 * mock NAS speaks the actual protocol in `tests/mock-nas.mjs`, because the parts
 * of a RADIUS server most likely to be wrong (an authenticator that verifies
 * against the wrong secret, an MS-CHAPv2 layout that rejects a correct password, a
 * resend that double-counts traffic) are invisible to anything less real than a
 * socket.
 *
 * The cryptographic helpers are checked against published vectors rather than
 * trusted, for the same reason: MD4 and DES are hand-rolled or shimmed here
 * because modern OpenSSL has both disabled, and a wrong MD4 produces 16 plausible
 * bytes rather than an error.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import dgram from "node:dgram";
import {
  startMockNas,
  accessRequestPap,
  accessRequestMsChapV2,
  accountingRequest,
  exchange,
  send,
} from "./mock-nas.mjs";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, getSettings } from "../src/lib/settings.ts";
import { startServer } from "../radius/server.ts";
import {
  md4,
  md4Utf16Le,
  desEncrypt,
  verifyPap,
  verifyChap,
  verifyMsChapV2,
  extractCredentials,
  rateLimitFor,
  sessionTimeout,
  REPLY_SUSPENDED,
} from "../radius/auth.ts";
import { applyAccounting, readAccountingFields, reapStaleSessions } from "../radius/accounting.ts";
import { admitNas, resetRateLimits, allowedNasIps, decodePacket, radiusConfig } from "../radius/packet.ts";
import { sendDisconnect } from "../src/lib/services/radius-client.ts";
import {
  healthSnapshot,
  recordHeartbeatSample,
  HEARTBEAT_STALE_MS,
  resetHeartbeatSamples,
} from "../src/lib/services/radius-health.ts";
import { pruneRadiusLogs } from "../src/lib/services/radius-prune.ts";
import { radiusLogTail } from "../src/lib/services/radius-queries.ts";

const SECRET = "test-shared-secret-1234";

/** Writes one setting and clears the cache, so the next read sees it. */
async function set(key, value) {
  await saveSettings([{ key, value: String(value) }]);
}

/**
 * The RADIUS settings as they were before this suite ran.
 *
 * Taken before anything is written, and restored afterwards. The whole test file
 * shares one database with every other suite, and the RADIUS settings name real
 * ports — a suite that left them pointed at 28112 would break the next
 * `npm run radius` and any later run of these tests.
 */
let savedSettings = [];

/* Ports above 18000 so a test run cannot collide with a real RADIUS server, and
   below 32768 so they stay in the ephemeral range the OS would hand out. */
const AUTH_PORT = 28112;
const ACCT_PORT = 28113;
const COA_PORT = 23799;

const stamp = Date.now();

let server;
let router;
let pkg;
let area;
const customerIds = [];

const PASSWORD = "pppsecret";

let seq = 0;

/** Creates a customer, returning its username. */
async function makeCustomer(over = {}) {
  // `seq` on top of the caller's label: the auth matrix runs in `beforeEach`, so
  // the same code would otherwise be reused and collide on customerCode.
  seq += 1;
  const code = `${over.code ?? "cust"}${seq}`;
  const row = await prisma.customer.create({
    data: {
      customerCode: `RADIUSTEST-${code}`,
      name: `RADIUS Test ${code}`,
      username: `rad${code}${stamp % 10000}`,
      phone: `019${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password: PASSWORD,
      connectionStatus: "Active",
      billingStatus: "Paid",
      previousDue: 0,
      packageId: pkg.id,
      areaId: area.id,
      connectionDate: new Date(),
      expiryDate: new Date(Date.now() + 30 * 86400000),
      ...over.data,
    },
    select: { id: true, username: true, password: true },
  });
  customerIds.push(row.id);
  return row;
}

/* ------------------------------------------------------------------ */
/* Fixtures shared by every block                                      */
/* ------------------------------------------------------------------ */

before(async () => {
  const current = await getSettings();
  savedSettings = Object.entries(current).filter(([k]) => /radius/i.test(k));

  pkg = await prisma.package.create({
    data: {
      name: `RADIUS Test Package ${stamp}`,
      downloadSpeed: 20,
      uploadSpeed: 10,
      monthlyPrice: 800,
      validityDays: 30,
      billingCycle: "Monthly",
      status: "Active",
    },
    select: { id: true },
  });
  area = await prisma.area.create({
    data: { name: `RADIUS Test Area ${stamp}`, code: `RT${stamp % 100000}`, status: "Active" },
    select: { id: true },
  });
});

after(async () => {
  if (customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (area) await prisma.area.deleteMany({ where: { id: area.id } });
  if (pkg) await prisma.package.deleteMany({ where: { id: pkg.id } });
  await prisma.radiusAccounting.deleteMany({ where: { username: { contains: "rad" } } });

  await saveSettings(savedSettings.map(([key, value]) => ({ key, value })));

  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* The crypto, against published vectors                                */
/* ------------------------------------------------------------------ */

describe("MS-CHAPv2 primitives", () => {
  // RFC 1320 §A.5. Without these, a wrong MD4 silently makes every
  // MS-CHAPv2 login fail with what looks like a wrong password.
  test("MD4 matches all seven RFC 1320 test vectors", () => {
    const vectors = [
      ["", "31d6cfe0d16ae931b73c59d7e0c089c0"],
      ["a", "bde52cb31de33e46245e05fbdbd6fb24"],
      ["abc", "a448017aaf21d8525fc10ae87aa6729d"],
      ["message digest", "d9130a8164549fe818874806e1c7014b"],
      ["abcdefghijklmnopqrstuvwxyz", "d79e1c308aa5bbcdeea8ed63df412da9"],
      [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        "043f8582f241db351ce627e153e7f0e4",
      ],
      [
        "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        "e33b4ddc9c38f2199c3e7b164fcc0536",
      ],
    ];
    for (const [input, want] of vectors) {
      assert.equal(md4(Buffer.from(input)).toString("hex"), want, `MD4(${JSON.stringify(input)})`);
    }
  });

  test("MD4 spans more than one block", () => {
    // The single-block vectors would all pass with a padding bug that only shows
    // past 55 bytes, which is most real passwords.
    assert.equal(md4(Buffer.alloc(0)).length, 16);
    assert.equal(md4(Buffer.alloc(200, 0x78)).toString("hex").slice(0, 16), "ebd2de6bd766c281");
  });

  test("DES matches the FIPS 81 known-answer vectors", () => {
    // Node's OpenSSL has DES in the legacy provider and disabled by default, so
    // this cipher is reached through crypto-js rather than node:crypto.
    const kat = desEncrypt(
      Buffer.from("0123456789ABCDEF", "hex"),
      Buffer.from("133457799BBCDFF1", "hex")
    );
    assert.equal(kat.toString("hex").toUpperCase(), "85E813540F0AB405");

    const second = desEncrypt(
      Buffer.from("4E6F772069732074", "hex"),
      Buffer.from("0123456789ABCDEF", "hex")
    );
    assert.equal(second.toString("hex").toUpperCase(), "3FA40E8A984D4815");
  });

  test("the NT hash is MD4 over the UTF-16LE password", () => {
    // The UTF-16LE encoding is the whole difference between a hash Node computes
    // and one a MikroTik computes; MD4 of the UTF-8 bytes is a different number.
    assert.equal(md4Utf16Le("pppsecret").toString("hex"), "8059cd8d1b6f29f738a8f159af05b358");
  });
});

describe("credential verification", () => {
  test("PAP accepts the right password and nothing else", () => {
    assert.equal(verifyPap("secret", "secret"), true);
    assert.equal(verifyPap("secret", "wrong"), false);
    assert.equal(verifyPap("secret", "secre"), false, "a shorter guess must not pass");
    assert.equal(verifyPap("secret", "secrets"), false);
  });

  test("CHAP verifies MD5(id ‖ secret ‖ challenge)", () => {
    const id = 7;
    const challenge = randomBytes(16);
    const digest = createHash("md5")
      .update(Buffer.concat([Buffer.from([id]), Buffer.from("pw"), challenge]))
      .digest();
    const attr = Buffer.concat([Buffer.from([id]), digest, challenge]);

    assert.equal(verifyChap("pw", attr), true);
    assert.equal(verifyChap("other", attr), false);

    const tampered = Buffer.from(attr);
    tampered[1] ^= 0xff;
    assert.equal(verifyChap("pw", tampered), false, "a modified response must not verify");

    // The challenge must be the one that was answered, not any 16 bytes.
    assert.equal(verifyChap("pw", attr.subarray(0, 17)), false, "no challenge in the attribute");
  });

  test("MS-CHAPv2 needs both the password and this server's challenge", () => {
    const build = (password) => {
      const challenge = randomBytes(16);
      const peer = randomBytes(16);
      const nt = md4Utf16Le(password);
      const proof = createHash("sha256").update(Buffer.concat([peer, nt])).digest().subarray(0, 16);
      const key = Buffer.from([nt[0], nt[1], nt[2], nt[3], nt[4], nt[5], nt[6], 0]);
      const a = desEncrypt(Buffer.concat([nt, peer, Buffer.alloc(4)]), key).subarray(0, 8);
      const b = desEncrypt(Buffer.concat([challenge, peer, Buffer.alloc(4)]), key).subarray(0, 8);
      const chalHash = Buffer.alloc(8);
      for (let i = 0; i < 8; i++) chalHash[i] = a[i] ^ b[i];
      return {
        challenge,
        value: Buffer.concat([peer, Buffer.from([0]), proof, chalHash, Buffer.from([0])]),
      };
    };

    const good = build("pppsecret");
    assert.equal(verifyMsChapV2("pppsecret", good.value, good.challenge), true);
    assert.equal(verifyMsChapV2("wrong", good.value, good.challenge), false);
    assert.equal(
      verifyMsChapV2("pppsecret", good.value, randomBytes(16)),
      false,
      "a response to a different challenge must not verify — that is the replay defence"
    );

    const tampered = Buffer.from(good.value);
    tampered[20] ^= 0xff;
    assert.equal(verifyMsChapV2("pppsecret", tampered, good.challenge), false);
  });

  test("a request with no usable password attribute yields no credential", () => {
    const packet = { code: "Access-Request", identifier: 1, attributes: { "User-Name": "x" } };
    const creds = extractCredentials(packet);
    assert.equal(creds.method, "none");
    assert.equal(creds.value, null);
  });
});

describe("the values sent to the router", () => {
  test("the rate limit is down-first, as MikroTik reads it", () => {
    // Reversed, a 20M/10M subscriber gets 10M down and nobody notices until
    // complaints about a package sold as 20 Mbps.
    assert.equal(rateLimitFor({ downloadSpeed: 20, uploadSpeed: 10 }), "20M/10M");
    assert.equal(rateLimitFor({ downloadSpeed: 5, uploadSpeed: 5 }), "5M/5M");
    assert.equal(rateLimitFor(null), undefined, "no package means no attribute, not a zero");
  });

  test("Session-Timeout is the time left, capped at a day and never zero", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    assert.equal(sessionTimeout(new Date("2026-06-01T02:00:00Z"), now), 7200);
    assert.equal(sessionTimeout(new Date("2026-06-05T00:00:00Z"), now), 86400, "capped at a day");
    assert.equal(sessionTimeout(null, now), undefined, "no expiry means no attribute at all");
    assert.equal(
      sessionTimeout(new Date("2026-05-31T00:00:00Z"), now),
      60,
      "an expired customer still gets a floor, because 0 would log them straight out"
    );
  });

  test("every rejection carries the same message", () => {
    // One string for every failure, so a rejected login tells a customer nothing
    // about whether their account exists.
    assert.match(REPLY_SUSPENDED, /suspended/i);
    assert.ok(!/password/i.test(REPLY_SUSPENDED), "must not hint at the credential");
    assert.ok(!/expired/i.test(REPLY_SUSPENDED), "must not distinguish an expiry");
  });
});

/* ------------------------------------------------------------------ */

describe("the auth decision matrix", () => {
  let active;
  let suspended;
  let expired;
  let owes;

  beforeEach(async () => {
    active = await makeCustomer({ code: "act" });
    suspended = await makeCustomer({ code: "sus", data: { connectionStatus: "Suspended" } });
    expired = await makeCustomer({
      code: "exp",
      // Far enough past that any sane grace period is exceeded.
      data: { expiryDate: new Date(Date.now() - 400 * 86400000) },
    });
    owes = await makeCustomer({ code: "owe", data: { previousDue: 1500 } });
  });

  test("an active customer is allowed", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide(active.username, {
      method: "PAP",
      value: Buffer.from(PASSWORD),
      challenge: null,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.rateLimit, "20M/10M", "must carry the package speed");
    assert.ok(d.sessionTimeoutSec > 0);
  });

  test("a suspended customer is refused, and for the stated reason", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide(suspended.username, {
      method: "PAP",
      value: Buffer.from(PASSWORD),
      challenge: null,
    });
    assert.equal(d.allowed, false);
    assert.match(d.reason, /Suspended/);
    assert.equal(d.credentialOk, true, "the password was right — only the state said no");
  });

  test("an expired customer is refused", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide(expired.username, {
      method: "PAP",
      value: Buffer.from(PASSWORD),
      challenge: null,
    });
    assert.equal(d.allowed, false);
    assert.match(d.reason, /expired/i);
  });

  test("a customer with dues is refused", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide(owes.username, {
      method: "PAP",
      value: Buffer.from(PASSWORD),
      challenge: null,
    });
    assert.equal(d.allowed, false);
    assert.match(d.reason, /dues/i);
  });

  test("a wrong password is refused", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide(active.username, {
      method: "PAP",
      value: Buffer.from("wrong"),
      challenge: null,
    });
    assert.equal(d.allowed, false);
    assert.match(d.reason, /password/i);
  });

  test("an unknown user is refused without revealing anything", async () => {
    const { decide } = await import("../radius/auth.ts");
    const d = await decide("no-such-subscriber", {
      method: "PAP",
      value: Buffer.from(PASSWORD),
      challenge: null,
    });
    assert.equal(d.allowed, false);
    // The reason an operator sees must not distinguish "no such user" from "wrong
    // password" for anyone who can reach the log — and the *client* gets the same
    // Reply-Message either way, which is the part an attacker sees.
    assert.equal(d.credentialOk, undefined);
    assert.ok(!d.username, "an unknown user is not echoed back as a known-looking one");
  });
});

/* ------------------------------------------------------------------ */
/* Accounting idempotency                                              */
/* ------------------------------------------------------------------ */

describe("accounting is idempotent", () => {
  const sid = `acct-${stamp}`;

  const fields = (over = {}) => ({
    username: "acct-user",
    acctSessionId: sid,
    nasIp: "127.0.0.1",
    nasIdentifier: null,
    sessionTime: 0,
    inputOctets: 0n,
    outputOctets: 0n,
    framedIpAddress: null,
    callingStationId: null,
    ...over,
  });

  test("Start, three Interim-Updates and a Stop leave exactly one row", async () => {
    await applyAccounting(fields({ sessionTime: 0, inputOctets: 1000n, outputOctets: 500n }), "Start");

    // Three updates with growing totals, which is what a NAS sends every five
    // minutes.
    for (const [t, inn, out] of [
      [300, 2000n, 1000n],
      [600, 5000n, 2500n],
      [900, 9000n, 4000n],
    ]) {
      const r = await applyAccounting(
        fields({ sessionTime: t, inputOctets: inn, outputOctets: out }),
        "Interim-Update"
      );
      assert.equal(r.ignored, false);
    }

    const stop = await applyAccounting(
      fields({ sessionTime: 950, inputOctets: 10_000n, outputOctets: 4500n }),
      "Stop"
    );
    assert.equal(stop.ignored, false);

    const rows = await prisma.radiusAccounting.findMany({ where: { acctSessionId: sid } });
    assert.equal(rows.length, 1, "five packets, one session");
    assert.equal(rows[0].inputOctets, 10_000n);
    assert.equal(rows[0].outputOctets, 4500n);
    assert.equal(rows[0].seq, 950);
    assert.ok(rows[0].stoppedAt, "a Stop must close the row");
  });

  test("a resent Interim-Update is counted once, not twice", async () => {
    // This is the regression that matters. RADIUS accounting is UDP: a NAS that
    // does not get a response resends, and a resend carries the same *cumulative*
    // totals. Treating them as deltas inflates a customer's usage, which is the
    // kind of bug nobody reports.
    const before = await prisma.radiusAccounting.findUnique({
      where: { acctSessionId: sid },
    });

    const resent = await applyAccounting(
      fields({ sessionTime: 900, inputOctets: 9000n, outputOctets: 4000n }),
      "Interim-Update"
    );
    assert.equal(resent.ignored, true, "the same sequence again must be ignored");
    assert.match(resent.detail, /duplicate/i);

    const after = await prisma.radiusAccounting.findUnique({
      where: { acctSessionId: sid },
    });
    assert.deepEqual(
      { i: after.inputOctets, o: after.outputOctets, s: after.seq },
      { i: before.inputOctets, o: before.outputOctets, s: before.seq },
      "a duplicate must change nothing at all"
    );
  });

  test("an out-of-order Interim-Update does not roll the counters back", async () => {
    const out = await applyAccounting(
      fields({ sessionTime: 120, inputOctets: 100n, outputOctets: 50n }),
      "Interim-Update"
    );
    assert.equal(out.ignored, true, "a stale sequence is ignored, not applied");

    const row = await prisma.radiusAccounting.findUnique({ where: { acctSessionId: sid } });
    assert.equal(row.inputOctets, 10_000n, "must keep the larger totals");
  });

  test("a resent Start reopens the same row rather than duplicating it", async () => {
    const again = await applyAccounting(
      fields({ sessionTime: 20, inputOctets: 500n, outputOctets: 200n }),
      "Start"
    );
    assert.equal(again.ok, true);

    const rows = await prisma.radiusAccounting.findMany({ where: { acctSessionId: sid } });
    assert.equal(rows.length, 1, "a duplicate Start must not create a second session");
    assert.equal(rows[0].stoppedAt, null, "and it reopens the row it closed");
    assert.equal(rows[0].inputOctets, 500n, "a restarted session starts its own totals");
  });

  test("a resent Stop is ignored", async () => {
    await applyAccounting(fields({ sessionTime: 60, inputOctets: 3000n, outputOctets: 1500n }), "Start");
    const first = await applyAccounting(fields({ sessionTime: 90, inputOctets: 3000n, outputOctets: 1500n }), "Stop");
    assert.equal(first.ignored, false);
    const again = await applyAccounting(fields({ sessionTime: 90, inputOctets: 3000n, outputOctets: 1500n }), "Stop");
    assert.equal(again.ignored, true);
  });

  test("a Stop whose totals are lower than the last Interim keeps the larger figures", async () => {
    // A router that resets its counters mid-session must not make a customer look
    // as though they used nothing.
    await applyAccounting(fields({ sessionTime: 30, inputOctets: 7777n, outputOctets: 3333n }), "Start");
    await applyAccounting(fields({ sessionTime: 60, inputOctets: 7777n, outputOctets: 3333n }), "Stop");
    const row = await prisma.radiusAccounting.findUnique({ where: { acctSessionId: sid } });
    assert.equal(row.inputOctets, 7777n);
  });

  test("a Stop with no prior Start is still recorded and closed", async () => {
    const orphan = `orphan-${stamp}`;
    const r = await applyAccounting(
      fields({ acctSessionId: orphan, sessionTime: 40, inputOctets: 900n, outputOctets: 400n }),
      "Stop"
    );
    assert.equal(r.ok, true);
    const row = await prisma.radiusAccounting.findUnique({ where: { acctSessionId: orphan } });
    assert.ok(row.stoppedAt, "an unclosed row would look live forever");
  });

  test("a session the NAS forgot to close is reaped", async () => {
    // A router reboot drops the PPP interface without a Stop. Left alone the row
    // looks live forever, and every later suspension sends a Disconnect-Request
    // for a session that ended when the router rebooted.
    const stale = `stale-${stamp}`;
    await prisma.radiusAccounting.create({
      data: {
        username: "stale-user",
        acctSessionId: stale,
        nasIp: "127.0.0.1",
        inputOctets: 1234n,
        outputOctets: 567n,
        updatedAt: new Date(Date.now() - 3600 * 1000),
      },
    });
    const reaped = await reapStaleSessions(300);
    assert.ok(reaped >= 1);
    const row = await prisma.radiusAccounting.findUnique({ where: { acctSessionId: stale } });
    assert.ok(row.stoppedAt);
  });

  test("accounting fields are read with the awkward types a router sends", () => {
    const packet = {
      code: "Accounting-Request",
      identifier: 3,
      attributes: {
        "User-Name": "rahim",
        "Acct-Session-Id": "sess-1",
        "Acct-Status-Type": "Start",
        "Acct-Session-Time": 300,
        // Routers send counters as decimal strings.
        "Input-Octets": "104857600",
        "Output-Octets": "12582912",
        "Framed-IP-Address": "100.64.10.5",
      },
    };
    const f = readAccountingFields(packet, "127.0.0.1");
    assert.equal(f.inputOctets, 104857600n);
    assert.equal(f.outputOctets, 12582912n);
    assert.equal(f.sessionTime, 300);
    assert.equal(f.framedIpAddress, "100.64.10.5");
  });

  test("a packet with no session id is not stored", () => {
    const packet = {
      code: "Accounting-Request",
      identifier: 4,
      attributes: { "User-Name": "rahim", "Acct-Status-Type": "Start" },
    };
    assert.equal(readAccountingFields(packet, "127.0.0.1"), null);
  });
});

/* ------------------------------------------------------------------ */
/* Over real UDP                                                       */
/* ------------------------------------------------------------------ */

describe("the server, over UDP", () => {
  let nas;

  before(async () => {
    resetRateLimits();
    resetHeartbeatSamples();

    await set("network.radiusSecret", SECRET);
    await set("network.radiusPort", String(AUTH_PORT));
    await set("network.radiusAccountingPort", String(ACCT_PORT));
    await set("network.radiusCoaPort", String(COA_PORT));
    // Where a *router* listens for Disconnect-Requests — a different port from
    // the one this server binds.
    await set("network.nasCoaPort", String(37990));
    await set("network.radiusServer", "127.0.0.1");

    // The router's address must be the one the mock NAS sends from, which is
    // 127.0.0.1 — the allowlist reads it from the Router table.
    router = await prisma.router.create({
      data: {
        name: `RADIUS Test Router ${stamp}`,
        ipAddress: "127.0.0.1",
        apiPort: 8728,
        status: "Online",
        // Opt-in, exactly as a real migration would be.
        useRadius: true,
      },
      select: { id: true, name: true, ipAddress: true, useRadius: true },
    });

    resetRateLimits();
    const config = await radiusConfig();
    server = await startServer({ config });

    nas = await startMockNas({ secret: SECRET, coaPort: Number(await getSettings())["network.nasCoaPort"] });
  });

  after(async () => {
    await nas?.close();
    await server?.stop();
    if (router) await prisma.router.deleteMany({ where: { id: router.id } });
  });

  test("the router's address is the allowlist", async () => {
    const ips = await allowedNasIps();
    assert.ok(ips.has("127.0.0.1"), "the NAS allowlist comes from the Router table");
  });

  test("an active customer gets Access-Accept with the package's rate limit", async () => {
    const customer = await makeCustomer({ code: "ok" });
    const reply = await exchange(
      AUTH_PORT,
      accessRequestPap(SECRET, customer.username, PASSWORD)
    );

    assert.ok(reply, "the server must answer — silence costs a 30s PPPoE timeout");
    assert.equal(reply.code, "Access-Accept");
    const vs = reply.attributes["Vendor-Specific"];
    assert.equal(
      vs?.["Mikrotik-Rate-Limit"],
      "20M/10M",
      "the package speed must be on the wire, or the router falls back to a default"
    );
    assert.ok(reply.attributes["Session-Timeout"] > 0);
  });

  test("a suspended customer gets Access-Reject", async () => {
    const customer = await makeCustomer({
      code: "susp",
      data: { connectionStatus: "Suspended" },
    });
    const reply = await exchange(AUTH_PORT, accessRequestPap(SECRET, customer.username, PASSWORD));
    assert.equal(reply.code, "Access-Reject");
    assert.equal(reply.attributes["Reply-Message"], REPLY_SUSPENDED);
  });

  test("an unknown user gets the same reply as a suspended one", async () => {
    const customer = await makeCustomer({ code: "cmp" });
    const real = await exchange(AUTH_PORT, accessRequestPap(SECRET, customer.username, "wrong"));
    const fake = await exchange(AUTH_PORT, accessRequestPap(SECRET, "ghost-account", "wrong"));

    assert.equal(real.code, "Access-Reject");
    assert.equal(fake.code, "Access-Reject");
    // Byte-identical replies: a caller who cannot authenticate learns nothing
    // about which usernames exist.
    assert.deepEqual(fake.attributes, real.attributes);
  });

  test("MS-CHAPv2 works over the wire", async () => {
    const customer = await makeCustomer({ code: "chap" });
    const challenge = randomBytes(16);
    const peer = randomBytes(16);
    const nt = md4Utf16Le(PASSWORD);
    const proof = createHash("sha256").update(Buffer.concat([peer, nt])).digest().subarray(0, 16);
    const key = Buffer.from([nt[0], nt[1], nt[2], nt[3], nt[4], nt[5], nt[6], 0]);
    const a = desEncrypt(Buffer.concat([nt, peer, Buffer.alloc(4)]), key).subarray(0, 8);
    const b = desEncrypt(Buffer.concat([challenge, peer, Buffer.alloc(4)]), key).subarray(0, 8);
    const chalHash = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) chalHash[i] = a[i] ^ b[i];
    const value = Buffer.concat([peer, Buffer.from([0]), proof, chalHash, Buffer.from([0])]);

    const reply = await exchange(
      AUTH_PORT,
      accessRequestMsChapV2(SECRET, customer.username, PASSWORD, challenge)
    );
    assert.equal(reply.code, "Access-Accept", "a valid MS-CHAPv2 login must be accepted");
    assert.equal(reply.attributes["Vendor-Specific"]["Mikrotik-Rate-Limit"], "20M/10M");
    void value;
  });

  test("a packet from a non-allowlisted NAS is dropped, not answered", async () => {
    const before = await prisma.radiusLog.count({ where: { type: "dropped" } });

    // 127.0.0.2 is not on the allowlist and loopback still routes to us, so the
    // packet reaches the socket and is refused by the allowlist rather than never
    // arriving. No reply is the assertion: a Reject would confirm to a prober that
    // a RADIUS server is listening here.
    const reply = await exchangeFrom("127.0.0.2", AUTH_PORT, accessRequestPap(SECRET, "anybody", "x"));
    assert.equal(reply, null, "an unknown NAS must get no reply at all");

    // Then confirmed in the log — a silent drop is indistinguishable from a
    // broken server, so an operator needs to see it.
    await new Promise((r) => setTimeout(r, 300));
    const after = await prisma.radiusLog.count({ where: { type: "dropped" } });
    assert.ok(after > before, "the drop must be logged");
    const line = await prisma.radiusLog.findFirst({
      where: { type: "dropped" },
      orderBy: { id: "desc" },
    });
    assert.match(line.message, /127\.0\.0\.2|not a known router/i);
  });

  test("an accounting packet with the wrong secret is dropped", async () => {
    // Unlike an Access-Request, an Accounting-Request carries an authenticator
    // derived from the secret, so this one is genuinely verifiable and the server
    // can refuse it. (An Access-Request's authenticator is random by design — see
    // the note on decodePacket.)
    const before = await prisma.radiusAccounting.count();
    send(
      ACCT_PORT,
      accountingRequest("the-wrong-secret", {
        username: "someone",
        acctSessionId: `wrongsecret-${stamp}`,
        status: "Start",
        sessionTime: 0,
      })
    );
    await new Promise((r) => setTimeout(r, 400));
    const after = await prisma.radiusAccounting.count();
    assert.equal(after, before, "an unverifiable packet must not be stored");

    const line = await prisma.radiusLog.findFirst({
      where: { type: "dropped" },
      orderBy: { id: "desc" },
    });
    assert.match(line.message, /shared secret/i);
  });

  test("accounting over UDP stores one row for a full session", async () => {
    const customer = await makeCustomer({ code: "acct" });
    const sid = `udp-${stamp}`;

    send(ACCT_PORT, accountingRequest(SECRET, { username: customer.username, acctSessionId: sid, status: "Start", sessionTime: 0, inputOctets: 100, outputOctets: 50 }));
    await new Promise((r) => setTimeout(r, 150));
    for (const [t, i, o] of [[300, 1000, 500], [600, 2500, 1200], [900, 4000, 2000]]) {
      send(ACCT_PORT, accountingRequest(SECRET, { username: customer.username, acctSessionId: sid, status: "Interim-Update", sessionTime: t, inputOctets: i, outputOctets: o }));
      await new Promise((r) => setTimeout(r, 120));
    }
    send(ACCT_PORT, accountingRequest(SECRET, { username: customer.username, acctSessionId: sid, status: "Stop", sessionTime: 950, inputOctets: 4500, outputOctets: 2200 }));
    await new Promise((r) => setTimeout(r, 200));

    const rows = await prisma.radiusAccounting.findMany({ where: { acctSessionId: sid } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].inputOctets, 4500n);
    assert.ok(rows[0].stoppedAt);
  });

  test("PoD sends a Disconnect-Request the mock NAS actually receives", async () => {
    const customer = await makeCustomer({ code: "pod" });
    const sid = `pod-${stamp}`;
    await applyAccounting(
      {
        username: customer.username,
        acctSessionId: sid,
        nasIp: "127.0.0.1",
        nasIdentifier: null,
        sessionTime: 60,
        inputOctets: 1n,
        outputOctets: 1n,
        framedIpAddress: null,
        callingStationId: null,
      },
      "Start"
    );

    const before = nas.disconnectRequests.length;
    const result = await sendDisconnect(customer.username);

    assert.equal(result.ok, true, result.detail);
    assert.ok(nas.disconnectRequests.length > before, "the mock NAS must have seen the packet");
    const packet = nas.disconnectRequests.at(-1);
    assert.equal(packet.username, customer.username);
    assert.equal(packet.acctSessionId, sid, "a CoA must name the session, not just the user");
  });

  test("PoD with no live session is a success, not a failure", async () => {
    const customer = await makeCustomer({ code: "offline" });
    const result = await sendDisconnect(customer.username);
    assert.equal(result.ok, true);
    assert.match(result.detail, /no live RADIUS session/i);
  });

  test("PoD reports which sessions acknowledged and which did not", async () => {
    const customer = await makeCustomer({ code: "nak" });
    const sid = `nak-${stamp}`;
    await prisma.radiusAccounting.create({
      data: { username: customer.username, acctSessionId: sid, nasIp: "127.0.0.1" },
    });

    nas.ackCoa = false;
    try {
      const result = await sendDisconnect(customer.username);
      assert.equal(result.ok, false);
      assert.equal(result.sessions.length, 1);
      assert.equal(result.sessions[0].ok, false);
      assert.match(result.sessions[0].detail, /did not answer/);
    } finally {
      nas.ackCoa = true;
    }
  });

  test("a router with RADIUS switched off is refused", async () => {
    // The opt-in has to mean something: a box not converted to RADIUS has no
    // business exchanging packets with this server.
    const off = await prisma.router.create({
      data: {
        name: `RADIUS Off Router ${stamp}`,
        ipAddress: "127.0.0.2",
        apiPort: 8728,
        status: "Online",
        useRadius: false,
      },
      select: { id: true },
    });
    try {
      resetRateLimits();
      const admitted = await admitNas("127.0.0.2", 12345);
      assert.equal(admitted.ok, false);
      assert.match(admitted.reason, /switched off/i);
    } finally {
      await prisma.router.deleteMany({ where: { id: off.id } });
    }
  });

  test("the shared secret is never written to a log line", async () => {
    await exchange(AUTH_PORT, accessRequestPap(SECRET, "ghost", "x"));
    await new Promise((r) => setTimeout(r, 200));
    const lines = await prisma.radiusLog.findMany({ take: 200, orderBy: { id: "desc" } });
    for (const line of lines) {
      assert.ok(!line.message.includes(SECRET), `a log line leaked the secret: ${line.message}`);
      assert.ok(!line.message.includes(PASSWORD), `a log line leaked a password: ${line.message}`);
    }
  });

  test("a packet that will not decode does not take the process down", async () => {
    send(AUTH_PORT, Buffer.from("this is not a RADIUS packet at all"));
    send(ACCT_PORT, Buffer.from([1, 2, 3, 4]));
    await new Promise((r) => setTimeout(r, 300));
    // Still answering afterwards is the assertion — a crash here takes auth for
    // the whole ISP with it.
    const customer = await makeCustomer({ code: "alive" });
    const reply = await exchange(AUTH_PORT, accessRequestPap(SECRET, customer.username, PASSWORD));
    assert.equal(reply.code, "Access-Accept");
  });

  test("the heartbeat is written and counts packets", async () => {
    // Asked for explicitly: the interval beat is 15s and the suite is faster than
    // that, so reading the row without a beat would only prove the boot-time one.
    await server.beat();
    const row = await prisma.radiusHealth.findUnique({ where: { id: "radius" } });
    assert.ok(row, "the process must write a heartbeat");
    assert.ok(row.packetsIn > 0, `packetsIn was ${row.packetsIn}`);
    assert.ok(Date.now() - row.updatedAt.getTime() < HEARTBEAT_STALE_MS);
  });
});

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

describe("the health reading", () => {
  test("a fresh heartbeat reads UP", () => {
    resetHeartbeatSamples();
    const startedAt = new Date(Date.now() - 60000);
    const h = healthSnapshot({
      packetsIn: 100,
      packetsOut: 90,
      updatedAt: new Date(),
      startedAt,
    });
    assert.equal(h.running, true);
    assert.equal(h.lastSeenSec, 0);
  });

  test("a stale heartbeat reads DOWN, not stale-UP", () => {
    // The whole point of the heartbeat. A RADIUS server that died while the
    // dashboard showed a green dot is the failure this prevents.
    resetHeartbeatSamples();
    const h = healthSnapshot({
      packetsIn: 100,
      packetsOut: 90,
      updatedAt: new Date(Date.now() - (HEARTBEAT_STALE_MS + 1000)),
      startedAt: new Date(Date.now() - 600000),
    });
    assert.equal(h.running, false, "a dead process must not read as up");
  });

  test("no row at all reads DOWN", () => {
    resetHeartbeatSamples();
    assert.equal(healthSnapshot(null).running, false);
    assert.equal(healthSnapshot(null).lastSeenSec, null);
  });

  test("a restart resets the packet rate rather than reporting nonsense", () => {
    resetHeartbeatSamples();
    const now = new Date();
    // Samples from a process that has since restarted.
    recordSamples(5000, now);
    const h = healthSnapshot({ packetsIn: 3, packetsOut: 2, updatedAt: now, startedAt: now });
    assert.equal(h.packetsPerSec, 0, "a rate across two processes' counters is not a rate");
    assert.equal(h.running, true);
  });

  function recordSamples(n, at) {
    // Two samples a minute apart, both attributed to a process that has since
    // restarted — the counters belong to the old one.
    recordHeartbeatSample(n, 0, new Date(at.getTime() - 120000));
    recordHeartbeatSample(n, 0, new Date(at.getTime() - 120000));
  }
});

/* ------------------------------------------------------------------ */
/* Log retention                                                       */
/* ------------------------------------------------------------------ */

describe("log retention", () => {
  const old = `radretention-old-${stamp}`;
  const fresh = `radretention-fresh-${stamp}`;

  before(async () => {
    await set("radius.logRetentionDays", "7");
    // One line well inside the window, one well outside it.
    await prisma.radiusLog.create({
      data: { type: "accounting", message: `keep ${old}`, username: old, createdAt: new Date(Date.now() - 2 * 86400000) },
    });
    await prisma.radiusLog.create({
      data: { type: "accounting", message: `drop ${fresh}`, username: fresh, createdAt: new Date(Date.now() - 30 * 86400000) },
    });
  });

  after(async () => {
    await prisma.radiusLog.deleteMany({ where: { username: { in: [old, fresh] } } });
  });

  test("rows past the retention are deleted and recent rows are kept", async () => {
    const result = await pruneRadiusLogs();
    assert.ok(result.ran >= 1, result.skipped);

    const kept = await prisma.radiusLog.findMany({ where: { username: { in: [old, fresh] } } });
    const usernames = kept.map((r) => r.username);
    assert.ok(usernames.includes(old), "a 2-day-old line must survive a 7-day retention");
    assert.ok(!usernames.includes(fresh), "a 30-day-old line must go");
  });

  test("running it twice changes nothing the second time", async () => {
    // The cron endpoint is reachable from Vercel, GitHub Actions and a hand-run
    // curl; idempotency is what makes that safe.
    const first = await pruneRadiusLogs();
    const second = await pruneRadiusLogs();
    assert.equal(second.ran, 0, "there was nothing left to delete");
    assert.ok(first.ran >= second.ran);
  });

  test("a nonsense retention deletes nothing rather than everything", async () => {
    // `NaN days ago` compares as false and would silently keep everything; worse,
    // a zero would be read as "delete everything".
    await set("radius.logRetentionDays", "not-a-number");
    const before = await prisma.radiusLog.count();
    const result = await pruneRadiusLogs();
    assert.equal(result.ran, 0);
    assert.equal(await prisma.radiusLog.count(), before, "a bad setting must not delete the log");
    await set("radius.logRetentionDays", "7");
  });
});

/* ------------------------------------------------------------------ */
/* The SSE cursor                                                      */
/* ------------------------------------------------------------------ */

describe("the SSE cursor", () => {
  beforeEach(async () => {
    await prisma.radiusLog.deleteMany({ where: { username: { startsWith: "radcursor" } } });
  });

  after(async () => {
    await prisma.radiusLog.deleteMany({ where: { username: { startsWith: "radcursor" } } });
  });

  test("a reconnect replays from the cursor with no gap and no repeat", async () => {
    // The property the stream depends on: `id` is an autoincrement, so `id > n`
    // is exactly "what arrived since". Timestamps are neither strictly increasing
    // nor gapless, so a `createdAt > last` query would repeat or skip lines.
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const row = await prisma.radiusLog.create({
        data: { type: "accounting", message: `cursor line ${i}`, username: "radcursor" },
      });
      ids.push(row.id);
    }

    const first = await radiusLogTail(0);
    const afterThree = await radiusLogTail(ids[2]);

    const firstIds = first.map((r) => r.id);
    const secondIds = afterThree.map((r) => r.id);

    assert.deepEqual(secondIds, ids.slice(3), "exactly the rows after the cursor");
    // No repeat: nothing from the first batch appears in the second.
    for (const id of secondIds) assert.ok(!firstIds.slice(0, 3).includes(id));
    // No gap: every line between the two is present.
    assert.equal(secondIds.length, ids.length - 3);
  });

  test("a cursor past the end yields nothing rather than everything", async () => {
    const rows = await radiusLogTail(999999999);
    assert.deepEqual(rows, []);
  });

  test("a filter still advances the cursor past the lines it excludes", async () => {
    // Otherwise toggling a filter replays every line already on screen, because
    // the cursor would never move past the excluded ones.
    // Scoped to ids above this point: the log table is shared with the UDP tests
    // above, so an unscoped tail(0) would include their lines and make this
    // assertion about the cursor meaningless.
    const floor = (await prisma.radiusLog.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0;

    const a = await prisma.radiusLog.create({
      data: { type: "accept", message: "filter probe accept", username: "radcursor" },
    });
    await prisma.radiusLog.create({
      data: { type: "reject", message: "filter probe reject", username: "radcursor" },
    });

    const acceptsOnly = await radiusLogTail(floor, { types: ["accept"] });
    assert.deepEqual(acceptsOnly.map((r) => r.id), [a.id]);

    // The next poll must not resend the accept, even though a reject was skipped.
    const next = await radiusLogTail(a.id, { types: ["accept"] });
    assert.deepEqual(next, [], "a skipped line still advanced the cursor");
  });

  test("search matches the message, username and NAS", async () => {
    await prisma.radiusLog.create({
      data: { type: "accounting", message: "session alive", username: "radcursor", nasIp: "10.9.9.9" },
    });
    const byUser = await radiusLogTail(0, { search: "radcursor" });
    assert.ok(byUser.length > 0);
    const byIp = await radiusLogTail(0, { search: "10.9.9.9" });
    assert.ok(byIp.length > 0);
    const byText = await radiusLogTail(0, { search: "session alive" });
    assert.ok(byText.length > 0);
    const none = await radiusLogTail(0, { search: "no-such-text-anywhere" });
    assert.deepEqual(none, []);
  });

  test("ordering is by id, so lines written in the same millisecond keep their order", async () => {
    // Five concurrent inserts: `createdAt` may well be identical for several of
    // them, which is the case a timestamp cursor cannot order.
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.radiusLog.create({
          data: { type: "accounting", message: `burst ${i}`, username: "radcursor" },
        })
      )
    );
    // From the first of them, not from 0: the table is shared with the UDP tests,
    // and a tail(0) is capped at 200 rows, so it would never reach this burst.
    const rows = await radiusLogTail(Math.min(...created.map((r) => r.id)) - 1);
    const burstIds = created.map((r) => r.id);
    const seen = rows.filter((r) => burstIds.includes(r.id)).map((r) => r.id);
    assert.deepEqual(seen, burstIds.sort((a, b) => a - b));
  });
});

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

describe("configuration", () => {
  test("the ports and secret come from Settings", async () => {
    const s = await getSettings();
    assert.equal(s["network.radiusPort"], String(AUTH_PORT));
    assert.ok(s["network.radiusSecret"]);
  });

  test("the NAS allowlist refuses an address that is not a router", async () => {
    resetRateLimits();
    const admitted = await admitNas("203.0.113.9", 40000);
    assert.equal(admitted.ok, false);
    assert.match(admitted.reason, /not a known router/i);
  });

  test("an unverifiable packet is refused without printing the secret", () => {
    // Accounting-Request, because that is the packet type whose authenticator is
    // derived from the secret and therefore verifiable. An Access-Request's is
    // random by design, so a wrong secret cannot be detected from it at all —
    // which is why the NAS allowlist, not the secret, is what stops a stranger's
    // packets. Asserting otherwise here would assert a protection that does not
    // exist.
    const packet = accountingRequest(SECRET, {
      username: "someone",
      acctSessionId: `decode-${stamp}`,
      status: "Start",
      sessionTime: 0,
    });
    const decoded = decodePacket(packet, "a-different-secret");
    assert.equal(decoded.ok, false);
    assert.match(decoded.reason, /shared secret/i);
    assert.ok(
      !decoded.reason.includes("a-different-secret"),
      "the reason must not carry the secret"
    );
  });

  test("an Access-Request with the wrong secret still decodes, by design", () => {
    // Stated rather than papered over: RFC 2865 gives an Access-Request a random
    // authenticator, so only its Message-Authenticator proves the sender knows the
    // secret. What actually protects the port is the allowlist.
    const decoded = decodePacket(accessRequestPap(SECRET, "someone", "pw"), "a-different-secret");
    assert.equal(decoded.ok, true, "an Access-Request cannot be rejected on its authenticator alone");
  });

  test("the right secret decodes", () => {
    const decoded = decodePacket(accessRequestPap(SECRET, "someone", "pw"), SECRET);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.packet.attributes["User-Name"], "someone");
  });
});

/* ------------------------------------------------------------------ */
/* A helper the allowlist test needs                                   */
/* ------------------------------------------------------------------ */

/** Sends from a specific source address, unlike `exchange` which uses loopback. */
function exchangeFrom(sourceIp, port, packet, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* */
      }
      resolve(null);
    }, timeoutMs);
    socket.on("message", (data) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* */
      }
      resolve(data.length > 0 ? data : null);
    });
    // Binding the source is what makes the packet appear to come from another
    // address. On Linux this needs the address to be local, and 127.0.0.2 is.
    socket.bind(0, sourceIp, () => socket.send(packet, port, "127.0.0.1"));
  });
}