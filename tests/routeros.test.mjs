import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockRouter } from "./mock-routeros.mjs";
import {
  parseRouterOsDuration,
  parseRouterOsBytes,
  RouterOsClient,
  RouterOsError,
} from "../src/lib/services/routeros.ts";

/* ------------------------------------------------------------------ */
/* Pure parsing — the part that has historically been wrong           */
/* ------------------------------------------------------------------ */

describe("parseRouterOsDuration", () => {
  test("reads the week/day/hour/minute/second form RouterOS actually uses", () => {
    assert.equal(parseRouterOsDuration("3w2d4h5m6s"), 3 * 604800 + 2 * 86400 + 4 * 3600 + 5 * 60 + 6);
    assert.equal(parseRouterOsDuration("2h14m9s"), 2 * 3600 + 14 * 60 + 9);
    assert.equal(parseRouterOsDuration("10s"), 10);
    assert.equal(parseRouterOsDuration("1w"), 604800);
    assert.equal(parseRouterOsDuration("4m30s"), 270);
  });

  test("accepts a plain number of seconds", () => {
    assert.equal(parseRouterOsDuration("3600"), 3600);
    assert.equal(parseRouterOsDuration(90), 90);
  });

  test("is zero for nothing, not NaN", () => {
    assert.equal(parseRouterOsDuration(undefined), 0);
    assert.equal(parseRouterOsDuration(null), 0);
    assert.equal(parseRouterOsDuration(""), 0);
    assert.equal(parseRouterOsDuration("not a duration"), 0);
  });

  test("does not read a colon-separated time as a RouterOS duration", () => {
    // The old parser treated this as h:m:s. RouterOS never emits it, and the
    // result looked plausible enough to hide the bug.
    assert.equal(parseRouterOsDuration("12:34:56"), 0);
  });
});

describe("parseRouterOsBytes", () => {
  test("reads the decimal strings RouterOS sends", () => {
    assert.equal(parseRouterOsBytes("104857600"), 104857600);
    assert.equal(parseRouterOsBytes("0"), 0);
    assert.equal(parseRouterOsBytes(1024), 1024);
  });

  test("is zero rather than negative or NaN for junk", () => {
    assert.equal(parseRouterOsBytes(undefined), 0);
    assert.equal(parseRouterOsBytes(""), 0);
    assert.equal(parseRouterOsBytes("abc"), 0);
    assert.equal(parseRouterOsBytes("-5"), 0);
  });
});

/* ------------------------------------------------------------------ */
/* Against a mock router                                               */
/* ------------------------------------------------------------------ */

describe("RouterOsClient", () => {
  let mock;
  let client;

  before(async () => {
    mock = await startMockRouter();
  });

  after(async () => {
    await mock.close();
  });

  beforeEach(() => {
    mock.reset();
    client = new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: mock.user,
      password: mock.password,
    });
  });

  test("testConnection reports the router identity and version", async () => {
    const r = await client.testConnection();
    assert.equal(r.ok, true);
    assert.equal(r.identity, "isp-core-01");
    assert.equal(r.version, "7.14.3 (stable)");
    assert.equal(r.uptime, "3w2d4h5m6s");
    assert.equal(r.activeSessions, 2);
  });

  test("testConnection fails loudly on a bad password, with a hint", async () => {
    const bad = new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: mock.user,
      password: "wrong",
    });
    const r = await bad.testConnection();
    assert.equal(r.ok, false);
    assert.match(r.error, /401/);
    assert.match(r.hint, /username or password/i);
  });

  test("testConnection says so when the host cannot be reached", async () => {
    const dead = new RouterOsClient({
      host: "127.0.0.1",
      port: 1, // nothing listens here
      username: "x",
      password: "y",
      timeoutMs: 1500,
    });
    const r = await dead.testConnection();
    assert.equal(r.ok, false);
    assert.match(r.error, /Cannot reach|No answer/);
  });

  test("maps PPPoE fields onto the normalised shape", async () => {
    const users = await client.listSessions();
    assert.equal(users.length, 2);

    const first = users[0];
    assert.equal(first.username, "rahim100");
    assert.equal(first.ipAddress, "100.64.10.5");
    assert.equal(first.macAddress, "64:4C:36:12:AB:01");
    assert.equal(first.interfaceName, "isp-pppoe");
    assert.equal(first.downloadBytes, 104857600);
    assert.equal(first.uploadBytes, 12582912);
    // 2h14m9s — this is the value the old parser returned as 0.
    assert.equal(first.uptimeSec, 2 * 3600 + 14 * 60 + 9);
  });

  test("a failed session read throws instead of looking like nobody online", async () => {
    const bad = new RouterOsClient({
      host: "127.0.0.1",
      port: mock.port,
      username: mock.user,
      password: "wrong",
    });
    // The old code caught this and returned [], which reads as "no customers
    // are online" rather than "I could not ask".
    await assert.rejects(() => bad.listSessions(), RouterOsError);
  });

  test("removeSession deletes the matching entry", async () => {
    const ok = await client.removeSession("rahim100");
    assert.equal(ok, true);
    assert.ok(
      mock.calls().some((c) => c.method === "DELETE" && c.path === "/ppp/active/*A"),
      "expected a DELETE for the session's id"
    );
  });

  test("removeSession throws when the user is not connected", async () => {
    await assert.rejects(
      () => client.removeSession("nobody-here"),
      (e) => e instanceof RouterOsError && /not connected/.test(e.message)
    );
  });

  test("setBlocked adds a firewall entry, then removes it", async () => {
    await client.setBlocked("100.64.10.5", true);
    let list = mock.addressList();
    assert.ok(
      list.some((r) => r.address === "100.64.10.5" && r.list === "isp-blocked"),
      "expected the address to be in the list"
    );

    await client.setBlocked("100.64.10.5", false);
    list = mock.addressList();
    assert.ok(
      !list.some((r) => r.address === "100.64.10.5"),
      "expected the address to be gone"
    );
  });

  test("unblocking an address that was never blocked is a no-op, not an error", async () => {
    assert.equal(await client.setBlocked("100.64.10.77", false), true);
  });

  test("blocking without an IP is refused with a clear message", async () => {
    await assert.rejects(
      () => client.setBlocked("", true),
      /IP address is needed/
    );
  });

  test("a timeout is reported as a timeout, not as a dead router", async () => {
    // A port that is open but never answers: 203.0.113.1 is reserved for
    // documentation and is not routable, so the connection hangs.
    const slow = new RouterOsClient({
      host: "203.0.113.1",
      port: 8728,
      username: "u",
      password: "p",
      timeoutMs: 400,
    });
    const r = await slow.testConnection();
    assert.equal(r.ok, false);
    assert.match(r.error, /No answer|Cannot reach/);
  });
});
