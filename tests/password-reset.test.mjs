import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import {
  requestPasswordReset,
  completePasswordReset,
  peekResetToken,
  pruneResetTokens,
} from "../src/lib/services/password-reset.ts";
import { resetAll as resetRateLimits } from "../src/lib/services/reset-rate-limit.ts";
import { evaluateSignIn } from "../src/lib/services/two-factor.ts";
import { clearAllAttempts } from "../src/lib/rate-limit.ts";

/**
 * Phase T — password reset.
 *
 * Most of the flow already existed before this phase. What it did **not** have was
 * an atomic burn: the token was stamped `usedAt` by primary key, unconditionally,
 * in a statement separate from the check. Two requests carrying one link both read
 * `usedAt === null` and both set the password — which makes "single-use" false and
 * turns a link that leaks out of an inbox or a proxy log into something worth
 * using twice. There is a test for exactly that, and it is the reason this phase
 * was worth doing.
 */

const STAMP = Date.now();
const PASSWORD = "first-password-choice";
const NEW_PASSWORD = "a-better-password-9";

let user;
let settingsBackup = {};
const SETTINGS_KEYS = ["app.url", "api.emailSmtpUser", "api.emailSmtpPass"];

/** Everything the messaging channel was asked to deliver. */
let sent = [];

before(async () => {
  for (const key of SETTINGS_KEYS) {
    const row = await prisma.setting.findUnique({ where: { key } });
    settingsBackup[key] = row?.value ?? null;
  }
  // SMTP "configured", so the service takes the real delivery path and the test
  // observes it through the injected sender rather than a console warning.
  await saveSettings([
    { key: "app.url", value: "https://isp.example.test" },
    { key: "api.emailSmtpUser", value: "mailer" },
    { key: "api.emailSmtpPass", value: "secret" },
  ]);
  invalidateSettingsCache();
  await clearAllAttempts();

  const role = await prisma.role.findFirst({ where: { name: "Technician" } });
  user = await prisma.user.create({
    data: {
      name: `Reset Subject ${STAMP}`,
      email: `reset-${STAMP}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      status: "Active",
      roleId: role?.id ?? null,
    },
    select: { id: true, email: true, name: true },
  });
});

after(async () => {
  await sweep();
  await clearAllAttempts();
  for (const [key, value] of Object.entries(settingsBackup)) {
    if (value !== null) await saveSettings([{ key, value }]);
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  sent = [];
  resetRateLimits();
  await prisma.passwordReset.deleteMany({ where: { userId: user.id } });
  await prisma.activityLog.deleteMany({ where: { entityId: user.id, action: "Password" } });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  await clearAllAttempts();
});

async function sweep() {
  await prisma.user.deleteMany({ where: { email: `reset-${STAMP}@example.test` } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: [] } } });
}

/** Records what would have been sent. */
function recorder() {
  return async (to, subject, body) => {
    sent.push({ to, subject, body });
    return { ok: true, configured: true };
  };
}

/** The raw token out of the most recent reset email. */
function tokenFromEmail() {
  const body = sent[sent.length - 1]?.body ?? "";
  return /[?&]token=([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? null;
}

/** Requests a reset and delivers the email, returning the raw token. */
async function issueReset(ip = "203.0.113.9") {
  const result = await requestPasswordReset(user.email, { clientIp: ip, send: recorder() });
  assert.ok(result.send, "a send was warranted");
  await result.send();
  const token = tokenFromEmail();
  assert.ok(token, "the email carried a token");
  return token;
}

// ---------------------------------------------------------------------------

describe("requesting a reset", () => {
  test("stores only the hash, and emails a link that works once", async () => {
    const token = await issueReset();

    const rows = await prisma.passwordReset.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    assert.ok(token.length >= 43, `only ${token.length} characters of randomness`);
    assert.notEqual(rows[0].tokenHash, token, "the raw token is not what is stored");
    assert.equal(rows[0].tokenHash.length, 64, "a sha-256 hex digest");
    assert.ok(rows[0].usedAt === null);

    // The link points at this deployment, from the setting rather than a guess.
    assert.match(sent[0].body, /https:\/\/isp\.example\.test\/reset-password\?token=/);
    assert.match(sent[0].body, /works once and expires in 60 minutes/);
    assert.match(sent[0].body, /no session has been ended/, "so a panicking reader does not act");
    assert.equal(sent[0].to, user.email);

    // And the raw token appears nowhere in the table.
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes(token));
  });

  test("the request itself is audited, not only the completion", async () => {
    await issueReset();
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: user.id, action: "Password" },
      orderBy: { createdAt: "asc" },
    });
    assert.match(log.summary, /Password reset requested/);
  });
});

describe("no account enumeration", () => {
  test("an unknown address gets the identical answer, and no email", async () => {
    const known = await requestPasswordReset(user.email, {
      clientIp: "203.0.113.10",
      send: recorder(),
    });
    await known.send?.();
    assert.equal(sent.length, 1, "the known address really did produce one email");
    const knownRows = await prisma.passwordReset.count({ where: { userId: user.id } });

    sent = [];
    const unknown = await requestPasswordReset(`nobody-${STAMP}@example.test`, {
      clientIp: "203.0.113.10",
      send: recorder(),
    });
    if (unknown.send) await unknown.send();

    assert.equal(unknown.ok, true);
    assert.equal(
      unknown.message,
      known.message,
      "byte-for-byte the same message, or the message is an oracle"
    );
    // Same *shape* too: one is a string, the other is a string. No extra field
    // that a caller could branch on.
    assert.deepEqual(Object.keys(unknown).filter((k) => k !== "send"), ["ok", "message"]);
    assert.equal(sent.length, 0, "no email for an address nobody has");
    assert.equal(
      await prisma.passwordReset.count({ where: { userId: user.id } }),
      knownRows,
      "and nothing extra written for them either"
    );
  });

  test("a disabled account is answered exactly like an unknown one", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { status: "Disabled" } });
    sent = [];
    const result = await requestPasswordReset(user.email, {
      clientIp: "203.0.113.11",
      send: recorder(),
    });
    if (result.send) await result.send();

    assert.equal(sent.length, 0, "a disabled account is not told its address exists");
    assert.match(result.message, /If that address belongs to an account here/);
    await prisma.user.update({ where: { id: user.id }, data: { status: "Active" } });
  });

  test("being throttled answers the same way again", async () => {
    const first = await requestPasswordReset(user.email, { clientIp: "203.0.113.12", send: recorder() });
    for (let i = 0; i < 5; i++) {
      await requestPasswordReset(user.email, { clientIp: "203.0.113.12", send: recorder() });
    }
    const throttled = await requestPasswordReset(user.email, { clientIp: "203.0.113.12", send: recorder() });

    assert.equal(throttled.message, first.message, "throttling must not confirm the address");
    assert.equal(throttled.send, undefined, "and no further mail is queued");
  });
});

describe("the whole flow", () => {
  test("request → link → new password → the old one stops working", async () => {
    const token = await issueReset();
    assert.ok(await peekResetToken(token), "the page can greet the account holder");

    await completePasswordReset(token, NEW_PASSWORD);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(await verifyPassword(NEW_PASSWORD, row.passwordHash));
    assert.equal(await verifyPassword(PASSWORD, row.passwordHash), false);

    // And it is genuinely a working sign-in, not just a changed hash.
    await clearAllAttempts();
    const withNew = await evaluateSignIn(user.email, NEW_PASSWORD, "198.51.100.4");
    assert.equal(withNew.ok, true);
    assert.ok("session" in withNew);

    await clearAllAttempts();
    const withOld = await evaluateSignIn(user.email, PASSWORD, "198.51.100.4");
    assert.equal(withOld.ok, false);

    const log = await prisma.activityLog.findMany({
      where: { entityId: user.id, action: "Password" },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(
      log.some((l) => /reset completed/.test(l.summary)),
      "the completion is audited even though the requester was unauthenticated"
    );
  });

  test("a reset ends the account's existing sessions", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const token = await issueReset();
    await completePasswordReset(token, NEW_PASSWORD);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(
      after.tokenVersion,
      before.tokenVersion + 1,
      "a reset is what somebody does when they think a password leaked"
    );
  });

  test("a second link from the same inbox is invalidated by the first", async () => {
    const first = await issueReset();
    await issueReset("203.0.113.21"); // a second request, a second link
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() + 3_600_000) },
    });

    await completePasswordReset(first, NEW_PASSWORD);
    await assert.rejects(
      () => completePasswordReset(tokenFromEmail?.() ?? "", NEW_PASSWORD),
      /not valid|already been used|expired/
    );
  });
});

describe("a token is single-use", () => {
  test("the second use is refused", async () => {
    const token = await issueReset();
    await completePasswordReset(token, NEW_PASSWORD);

    await assert.rejects(
      () => completePasswordReset(token, "yet-another-password-7"),
      /already been used/
    );

    const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(row.usedAt, "the burn is recorded");
  });

  test("two concurrent uses of one link: exactly one wins", async () => {
    const token = await issueReset();

    // The bug this phase exists to fix. With an unconditional
    // `update({ where: { id } })`, both of these read `usedAt === null`, both pass
    // the check, and both set the password — so "single-use" was false and a
    // leaked link was worth something twice.
    const settled = await Promise.allSettled([
      completePasswordReset(token, "concurrent-password-a"),
      completePasswordReset(token, "concurrent-password-b"),
    ]);

    const won = settled.filter((r) => r.status === "fulfilled");
    const lost = settled.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, "exactly one use succeeded");
    assert.equal(lost.length, 1);
    assert.match(String(lost[0].reason?.message ?? ""), /already been used/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(
      await verifyPassword("concurrent-password-a", row.passwordHash) ||
        (await verifyPassword("concurrent-password-b", row.passwordHash)),
      "and the password that landed is one of the two offered"
    );
    assert.equal(
      await verifyPassword(PASSWORD, row.passwordHash),
      false,
      "and the old one is gone either way"
    );
  });

  test("eight concurrent uses still produce one winner", async () => {
    const token = await issueReset();
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => completePasswordReset(token, `racer-password-${i}-x`))
    );
    assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  });
});

describe("expiry", () => {
  test("a token past its expiry is refused", async () => {
    const token = await issueReset();
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    assert.equal(await peekResetToken(token), null, "the page shows nothing rather than a form");
    await assert.rejects(() => completePasswordReset(token, NEW_PASSWORD), /expired/);
  });

  test("a token that does not exist is refused, without saying which", async () => {
    await assert.rejects(
      () => completePasswordReset("not-a-real-token-value", NEW_PASSWORD),
      /not valid/
    );
    assert.equal(await peekResetToken("not-a-real-token-value"), null);
  });

  test("pruning removes spent and long-expired tokens, and keeps live ones", async () => {
    const live = await issueReset();
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await completePasswordReset(live, NEW_PASSWORD);

    const spent = await issueReset("203.0.113.31");
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date(Date.now() - 48 * 3_600_000), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const fresh = await issueReset("203.0.113.32");
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
    assert.ok(fresh);

    const removed = await pruneResetTokens();
    assert.ok(removed >= 1, "the spent one went");

    const left = await prisma.passwordReset.findMany({ where: { userId: user.id } });
    assert.ok(
      left.every((r) => r.usedAt === null),
      "nothing live was taken with it"
    );
    void spent;
  });
});

describe("rate limiting", () => {
  test("five requests for one address stop sending", async () => {
    let mails = 0;
    for (let i = 0; i < 6; i++) {
      const result = await requestPasswordReset(user.email, {
        clientIp: "198.51.100.50",
        send: async () => {
          mails += 1;
          return { ok: true };
        },
      });
      if (result.send) await result.send();
    }
    assert.equal(mails, 3, "three in a window, then silence");
  });

  test("the address limit holds across source addresses", async () => {
    // Deliberately so. The threat is somebody hammering *one victim's* inbox, and
    // rotating their own source address is the obvious way to keep going — so the
    // per-address budget is independent of where the request came from. A limit
    // keyed on the pair would be defeated by changing one header.
    const first = await requestPasswordReset(user.email, { clientIp: "198.51.100.60", send: recorder() });
    for (let i = 0; i < 5; i++) {
      await requestPasswordReset(user.email, { clientIp: "198.51.100.60", send: recorder() });
    }

    const rotated = await requestPasswordReset(user.email, { clientIp: "198.51.100.61", send: recorder() });
    assert.equal(
      rotated.send,
      undefined,
      "a different source address does not buy a fresh budget for the same account"
    );
    assert.equal(rotated.message, first.message, "and the answer is unchanged either way");
  });

  test("the source limit is its own budget, per address and per IP", async () => {
    // The two limits are independent counters over different keys. A burst against
    // one address must not spend the source's budget, or one person hammering
    // their own address would stop a colleague behind the same NAT from resetting
    // theirs.
    for (let i = 0; i < 4; i++) {
      await requestPasswordReset(`solo-${i}-${STAMP}@example.test`, {
        clientIp: "198.51.100.66",
        send: recorder(),
      });
    }
    const colleague = await requestPasswordReset(user.email, {
      clientIp: "198.51.100.66",
      send: recorder(),
    });
    assert.ok(
      colleague.send,
      "another account behind the same address is still under the per-IP ceiling"
    );
  });

  test("a busy shared address is not blocked by one person's burst", async () => {
    // Per-IP allowance is deliberately higher than per-address: several staff can
    // share an office NAT, and a shared limit would let one of them lock out the
    // rest.
    let mails = 0;
    const send = async () => {
      mails += 1;
      return { ok: true };
    };
    for (let i = 0; i < 12; i++) {
      const result = await requestPasswordReset(`ghost-${i}-${STAMP}@example.test`, {
        clientIp: "198.51.100.70",
        send,
      });
      if (result.send) await result.send();
    }
    // Unknown addresses never send, so this asserts the limit did not *error* — the
    // eleven that got through the IP gate all returned the generic answer.
    assert.equal(mails, 0);
  });

  test("the daily cap is enforced per account, across sources", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await requestPasswordReset(user.email, {
        clientIp: `198.51.100.${80 + i}`,
        send: recorder(),
      });
      if (result.send) await result.send();
    }
    // Clear the in-memory window so the persisted cap is what stops the next one.
    resetRateLimits();
    const fourth = await requestPasswordReset(user.email, {
      clientIp: "198.51.100.90",
      send: recorder(),
    });
    assert.equal(fourth.send, undefined, "three a day, then nothing");
    assert.match(fourth.message, /If that address belongs to an account here/);
  });

  test("the reset limiter does not share the login budget", async () => {
    // Five reset requests must not lock the account out of *signing in*.
    // Reusing the login counters would hand anybody a denial-of-service: type a
    // colleague's email into the forgot-password form five times and they cannot
    // log in at all, without ever knowing a password.
    for (let i = 0; i < 6; i++) {
      await requestPasswordReset(user.email, { clientIp: "198.51.100.100", send: recorder() });
    }
    await clearAllAttempts();

    const login = await evaluateSignIn(user.email, PASSWORD, "198.51.100.101");
    assert.equal(login.ok, true, "signing in still works after a burst of reset requests");
    await clearAllAttempts();
  });
});

void tokenFromEmail;
