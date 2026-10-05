import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings, invalidateSettingsCache } from "../src/lib/settings.ts";
import { hashPassword } from "../src/lib/password.ts";
import { readChallenge, evaluateSignIn, completeChallenge } from "../src/lib/services/two-factor.ts";
import { clearAllAttempts } from "../src/lib/rate-limit.ts";
import {
  encryptSecret,
  decryptSecret,
  newTotpSetup,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  normaliseBackupCode,
  requiresTotp,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  resetTotp,
  secondFactorState,
} from "../src/lib/services/totp.ts";
import * as OTPAuth from "otpauth";

/**
 * Phase S — staff TOTP two-factor authentication.
 *
 * Two things are worth testing that are not obvious from the feature: that the
 * maths is *correct* rather than merely self-consistent (so the library is checked
 * against RFC 6238's published vectors), and that there is **no way past an
 * enabled second factor** — which is a claim about the absence of a path, and
 * therefore only provable by looking for the paths that might exist.
 */

const STAMP = Date.now();
const PASSWORD = "correct-horse-battery-staple";
const SECRET = "JBSWY3DPEHPK3PXP";

let roleStaff;
let roleManager;
let user;
let created = [];

before(async () => {
  originalRequire2fa = (
    await prisma.setting.findUnique({ where: { key: "security.require2fa" } })
  )?.value;

  await clearAllAttempts();
  await setRequire2fa("");

  const existing = await prisma.role.findFirst({ where: { name: "Technician" } });
  roleStaff = existing ?? (await prisma.role.create({ data: { name: "Technician", isSystem: false } }));
  roleManager = await prisma.role.findFirst({ where: { name: "Account Manager" } });
  await sweep();

  user = await prisma.user.create({
    data: {
      name: `TOTP Subject ${STAMP}`,
      email: `totp-${STAMP}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      status: "Active",
      roleId: roleStaff.id,
    },
    select: { id: true, email: true, name: true, totpEnabled: true },
  });
  created.push(user.id);
});

let originalRequire2fa = null;

after(async () => {
  await sweep();
  await clearAllAttempts();
  if (originalRequire2fa !== null) await setRequire2fa(originalRequire2fa);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetSubject();
  await clearAllAttempts();
  await setRequire2fa("");
});

async function setRequire2fa(value) {
  await saveSettings([{ key: "security.require2fa", value }]);
  invalidateSettingsCache();
}

async function sweep() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `totp-${STAMP}` } },
    select: { id: true },
  });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function resetSubject() {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpEnabled: false,
      totpEnabledAt: null,
      totpSecretEnc: null,
      backupCodesEnc: null,
      backupCodesUsedAt: null,
    },
  });
}

/** Enrolls the subject with a known secret, so a test can compute a live code. */
async function enroll(secretBase32 = SECRET) {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEnc: encryptSecret(secretBase32),
      totpEnabled: true,
      totpEnabledAt: new Date(),
      backupCodesEnc: JSON.stringify(generateBackupCodes().map(hashBackupCode)),
    },
  });
}

/** A code the authenticator would be showing right now. */
function liveCode(secretBase32 = SECRET, at = Date.now()) {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({ timestamp: at });
}

// ---------------------------------------------------------------------------

describe("the maths, checked against RFC 6238", () => {
  test("the library produces the RFC's published vectors", () => {
    // A TOTP implementation that is wrong in a self-consistent way still verifies
    // its own codes forever. These are the RFC's own numbers.
    const secret = OTPAuth.Secret.fromBase32("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const eight = new OTPAuth.TOTP({
      secret,
      algorithm: "SHA1",
      digits: 8,
      period: 30,
    });
    assert.equal(eight.generate({ timestamp: 59_000 }), "94287082", "T=59");
    assert.equal(eight.generate({ timestamp: 1_111_111_109_000 }), "07081804", "T=1111111109");
  });

  test("a live six-digit code verifies, and a wrong one does not", () => {
    assert.equal(verifyTotpCode(SECRET, liveCode()), true);
    assert.equal(verifyTotpCode(SECRET, "000000") === true, liveCode() === "000000");
  });

  test("one step of clock drift is accepted either way, two is not", () => {
    const base = 1_700_000_000_000;
    const token = liveCode(SECRET, base);
    assert.equal(verifyTotpCode(SECRET, token, base - 30_000), true, "30s behind");
    assert.equal(verifyTotpCode(SECRET, token, base + 30_000), true, "30s ahead");
    assert.equal(verifyTotpCode(SECRET, token, base - 60_000), false, "60s is outside the window");
    assert.equal(verifyTotpCode(SECRET, token, base + 60_000), false);
  });

  test("a short code is refused rather than zero-padded into one", () => {
    assert.equal(verifyTotpCode(SECRET, "12345"), false);
    assert.equal(verifyTotpCode(SECRET, "1234567"), false);
    assert.equal(verifyTotpCode(SECRET, ""), false);
  });

  test("spaces in a pasted code are tolerated", () => {
    const token = liveCode();
    assert.equal(verifyTotpCode(SECRET, ` ${token.slice(0, 3)} ${token.slice(3)} `), true);
  });
});

describe("the secret at rest", () => {
  test("it round-trips through AES-256-GCM", () => {
    const sealed = encryptSecret(SECRET);
    assert.notEqual(sealed, SECRET, "the column does not hold the plaintext");
    assert.match(sealed, /^v1\./);
    assert.equal(decryptSecret(sealed), SECRET);
  });

  test("each encryption uses a fresh IV, so the same secret twice looks different", () => {
    assert.notEqual(encryptSecret(SECRET), encryptSecret(SECRET));
  });

  test("a tampered or truncated ciphertext fails rather than decrypting to garbage", () => {
    const sealed = encryptSecret(SECRET);
    const parts = sealed.split(".");
    // Flip a byte of the ciphertext.
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64url")].join(".");
    assert.equal(decryptSecret(tampered), null, "the GCM tag check is the point");
    assert.equal(decryptSecret("nonsense"), null);
    assert.equal(decryptSecret("v1.only.three"), null);
  });

  test("a fresh setup is 160 bits of secret", () => {
    const setup = newTotpSetup("someone@example.test");
    assert.match(setup.uri, /^otpauth:\/\/totp\//);
    assert.match(setup.uri, /secret=/);
    // Base32, uppercase, no padding — what every authenticator expects.
    assert.match(setup.secret, /^[A-Z2-7]+$/);
    assert.ok(setup.secret.length >= 32, `only ${setup.secret.length} chars`);
  });
});

describe("backup codes", () => {
  test("are generated, hashed, and never stored in plaintext", async () => {
    const codes = generateBackupCodes();
    assert.equal(codes.length, 10);
    for (const c of codes) {
      assert.match(c, /^[A-F0-9]{5}-[A-F0-9]{5}$/);
      assert.equal(hashBackupCode(c).length, 64, "a sha-256 hex digest");
      assert.notEqual(hashBackupCode(c), c);
    }
    assert.equal(new Set(codes).size, codes.length, "no duplicates in one batch");
  });

  test("normalise spacing and case, so a typed-back code works", () => {
    const code = generateBackupCodes()[0];
    assert.equal(normaliseBackupCode(` ${code.toLowerCase()} `), normaliseBackupCode(code));
    assert.equal(hashBackupCode(`  ${code.toLowerCase()}`), hashBackupCode(code));
  });
});

describe("a user with 2FA on", () => {
  test("cannot complete sign-in without a code", async () => {
    await enroll();

    const first = await evaluateSignIn(user.email, PASSWORD, "10.0.0.1");
    assert.equal(first.ok, true);
    assert.ok("pending" in first, "the password step stops at the challenge");

    const token = first.pending.token;
    assert.equal(readChallenge(token)?.kind, "verify");
    assert.equal(first.pending.kind, "verify");
    // Nothing was signed in: no session was handed back.
    assert.equal("session" in first, false);
  });

  test("a wrong code is refused", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.0.0.2");
    const res = await completeChallenge(first.pending.token, "000000", "10.0.0.2");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid");
  });

  test("a valid code completes it", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.0.0.3");
    const res = await completeChallenge(first.pending.token, liveCode(), "10.0.0.3");
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.method, "totp");
    assert.ok(res.ok && res.session.id === user.id);
    assert.equal(res.ok && res.session.isAdmin, false);
  });

  test("a wrong password never reaches the challenge at all", async () => {
    await enroll();
    const res = await evaluateSignIn(user.email, "not-the-password", "10.0.0.4");
    assert.equal(res.ok, false, "there is no challenge token to attack separately");
  });

  test("a forged or expired challenge is refused", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.0.0.5");
    const good = first.pending.token;

    assert.equal(readChallenge(`${good}tampered`), null);
    assert.equal(readChallenge("nonsense"), null);
    assert.equal(readChallenge(""), null);

    const res = await completeChallenge("forged.token", liveCode(), "10.0.0.5");
    assert.equal(res.ok, false);
  });

  test("the challenge token cannot be used without the right code, repeatedly", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.0.0.6");
    for (let i = 0; i < 4; i++) {
      const res = await completeChallenge(first.pending.token, "111111", "10.0.0.6");
      assert.equal(res.ok, false, `attempt ${i + 1} must not pass`);
    }
  });
});

describe("backup codes at sign-in", () => {
  test("work once and are burned", async () => {
    await enroll();
    const codes = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { backupCodesEnc: JSON.stringify(codes.map(hashBackupCode)) },
    });

    const first = await evaluateSignIn(user.email, PASSWORD, "10.1.0.1");
    const used = await completeChallenge(first.pending.token, codes[0], "10.1.0.1");
    assert.equal(used.ok, true);
    assert.equal(used.ok && used.method, "backup");
    assert.equal(used.ok && used.backupRemaining, 9, "and the count is reported");

    // Second sign-in with the same code.
    await clearAllAttempts();
    const second = await evaluateSignIn(user.email, PASSWORD, "10.1.0.1");
    const again = await completeChallenge(second.pending.token, codes[0], "10.1.0.1");
    assert.equal(again.ok, false, "a backup code is single-use");

    // A different, unused one still works.
    await clearAllAttempts();
    const third = await evaluateSignIn(user.email, PASSWORD, "10.1.0.1");
    const other = await completeChallenge(third.pending.token, codes[1], "10.1.0.1");
    assert.equal(other.ok, true, "burning one code does not burn the rest");
    assert.equal(other.ok && other.backupRemaining, 8);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(JSON.parse(stored.backupCodesEnc).length, 8, "the spent hashes are gone, not flagged");
  });

  test("a spent code's hash is not left anywhere in the row", async () => {
    await enroll();
    const codes = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { backupCodesEnc: JSON.stringify(codes.map(hashBackupCode)) },
    });
    const first = await evaluateSignIn(user.email, PASSWORD, "10.1.0.2");
    await completeChallenge(first.pending.token, codes[0], "10.1.0.2");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const remaining = JSON.parse(row.backupCodesEnc);
    assert.ok(
      !remaining.includes(hashBackupCode(codes[0])),
      "removal, not a flag: a spent hash has no reason to still be stored"
    );
    assert.ok(row.backupCodesUsedAt, "but the fact that one was used is recorded");
  });
});

describe("role enforcement", () => {
  test("the role list is parsed the way an operator would type it", () => {
    assert.equal(requiresTotp("Administrator", ""), false);
    assert.equal(requiresTotp("Administrator", "Administrator"), true);
    assert.equal(
      requiresTotp("Administrator", " administrator , Manager "),
      true,
      "case and surrounding spaces, because this is a value somebody types"
    );
    assert.equal(requiresTotp("Technician", "Administrator"), false);
    assert.equal(requiresTotp(null, "Administrator"), false, "no role, no requirement");
    assert.equal(requiresTotp("Admin", "Administrator"), false, "no fuzzy matching");
    assert.equal(requiresTotp("Administrator", " , , "), false, "a list of nothing is nothing");
  });

  test("a role on the list is sent to enroll and cannot reach anything", async () => {
    assert.ok(roleManager, "the Account Manager role exists in this fixture");
    await prisma.user.update({ where: { id: user.id }, data: { roleId: roleManager.id } });
    await setRequire2fa("Account Manager");

    const first = await evaluateSignIn(user.email, PASSWORD, "10.2.0.1");
    assert.equal(first.ok, true);
    assert.ok("pending" in first);
    assert.equal(first.pending.kind, "enroll", "enrollment, not a code they do not have");
    assert.equal("session" in first, false, "and nothing to browse with");

    // A code cannot shortcut it: there is no secret to match yet.
    const res = await completeChallenge(first.pending.token, "123456", "10.2.0.1");
    assert.equal(res.ok, false);

    await prisma.user.update({ where: { id: user.id }, data: { roleId: roleStaff.id } });
  });

  test("a user outside the list signs in with a password as before", async () => {
    await setRequire2fa("Account Manager");
    const res = await evaluateSignIn(user.email, PASSWORD, "10.2.0.2");
    assert.equal(res.ok, true);
    assert.ok("session" in res, "no second factor for a role that is not listed");
    assert.equal(res.ok && res.method, "password");
  });

  test("enrollment does not outrank the policy", async () => {
    // Once enabled, a user keeps their second factor whatever the setting says.
    // The alternative is a role change silently removing somebody's MFA.
    await enroll();
    await setRequire2fa("");
    const res = await evaluateSignIn(user.email, PASSWORD, "10.2.0.3");
    assert.ok("pending" in res, "still challenged with an empty policy");
    assert.equal(res.pending.kind, "verify");
  });
});

describe("brute force on the code step", () => {
  test("five wrong codes lock the account out, like a password", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.3.0.1");
    const token = first.pending.token;

    for (let i = 0; i < 5; i++) {
      const res = await completeChallenge(token, "000001", "10.3.0.1");
      assert.equal(res.ok, false, `attempt ${i + 1} refused`);
    }

    const sixth = await completeChallenge(token, liveCode(), "10.3.0.1");
    assert.equal(sixth.ok, false, "even the right code, once locked out");
    assert.equal(sixth.reason, "locked");

    // And the password step is locked too — the budget is per account, not per step.
    const pw = await evaluateSignIn(user.email, PASSWORD, "10.3.0.1");
    assert.equal(pw.ok, false);
    assert.equal(pw.reason, "locked");

    await clearAllAttempts();
  });

  test("a successful code clears the counter", async () => {
    await enroll();
    const first = await evaluateSignIn(user.email, PASSWORD, "10.3.0.2");
    const bad = await completeChallenge(first.pending.token, "000002", "10.3.0.2");
    assert.equal(bad.ok, false);

    const second = await evaluateSignIn(user.email, PASSWORD, "10.3.0.2");
    const good = await completeChallenge(second.pending.token, liveCode(), "10.3.0.2");
    assert.equal(good.ok, true, "one wrong code does not start a countdown that only an admin can stop");
    await clearAllAttempts();
  });
});

describe("enrollment", () => {
  test("a secret is stored not-yet-enabled, so an abandoned setup leaves nothing behind", async () => {
    const begin = await beginTotpEnrollment(user.id, user.email);
    assert.equal(begin.ok, true);
    assert.ok("setup" in begin);

    const state = await secondFactorState(user.id);
    assert.equal(state.enrolled, false, "not enabled until confirmed");
    assert.equal(state.hasSecret, true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(row.totpSecretEnc, "the secret is stored, encrypted");
    assert.ok(!row.totpSecretEnc.includes("JBSWY3DP"), "and not in plaintext");
    assert.equal(decryptSecret(row.totpSecretEnc), begin.setup.secret);
  });

  test("confirmation checks the code against the *stored* secret", async () => {
    const begin = await beginTotpEnrollment(user.id, user.email);
    const code = liveCode(begin.setup.secret);

    const wrong = await confirmTotpEnrollment(user.id, "000000");
    assert.equal(wrong.ok, false);
    assert.equal((await secondFactorState(user.id)).enrolled, false);

    const right = await confirmTotpEnrollment(user.id, code);
    assert.equal(right.ok, true);
    assert.equal((await secondFactorState(user.id)).enrolled, true);
  });

  test("confirming twice is refused", async () => {
    await enroll();
    const res = await confirmTotpEnrollment(user.id, liveCode());
    assert.equal(res.ok, false);
    assert.match(res.error, /already on/);
  });

  test("confirming with no pending secret says to start again", async () => {
    const res = await confirmTotpEnrollment(user.id, "123456");
    assert.equal(res.ok, false);
    assert.match(res.error, /Start the setup again/);
  });

  test("confirmation is checked against the stored secret, not the caller's", async () => {
    // The gap this closes: enrollment shows a secret and stores one, and if
    // confirmation used the caller's copy then a stale or tampered one could be
    // confirmed and *that* secret enabled — while the one that was scanned does
    // nothing. The stored value is the only one that counts.
    const begin = await beginTotpEnrollment(user.id, user.email);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const storedSecret = decryptSecret(row.totpSecretEnc);
    assert.equal(storedSecret, begin.setup.secret, "what was shown is what was stored");

    await resetTotp(user.id);
    const second = await beginTotpEnrollment(user.id, user.email);
    assert.notEqual(second.setup.secret, begin.setup.secret, "a new setup mints a new secret");

    // A code from the *previous* setup — the stale-QR case — must not confirm it.
    const stale = await confirmTotpEnrollment(user.id, liveCode(begin.setup.secret));
    assert.equal(stale.ok, false, "a code from the old secret does not confirm the new one");
    assert.equal((await secondFactorState(user.id)).enrolled, false);

    // The code from the one that was actually shown does.
    const right = await confirmTotpEnrollment(user.id, liveCode(second.setup.secret));
    assert.equal(right.ok, true);
    assert.equal((await secondFactorState(user.id)).enrolled, true);
  });
});

describe("reset", () => {
  test("destroys the secret rather than just disabling it", async () => {
    await enroll();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(before.totpSecretEnc);
    const secretBefore = decryptSecret(before.totpSecretEnc);

    await resetTotp(user.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.totpEnabled, false);
    assert.equal(after.totpEnabledAt, null);
    assert.equal(after.totpSecretEnc, null, "a working secret must not survive a reset");
    assert.equal(after.backupCodesEnc, null);
    assert.notEqual(after.totpSecretEnc, secretBefore);

    // And the account signs in with a password again.
    const res = await evaluateSignIn(user.email, PASSWORD, "10.4.0.1");
    assert.ok("session" in res, "a reset account is a password-only account");
  });

  test("the stored secret is never readable through the state helper", async () => {
    await enroll();
    const state = await secondFactorState(user.id);
    assert.deepEqual(Object.keys(state).sort(), ["enrolled", "hasSecret"]);
    assert.equal(JSON.stringify(state).includes("JBSWY3DP"), false);
  });
});

describe("no bypass path", () => {
  test("every way of reaching a session is behind the code once enrolled", async () => {
    await enroll();

    // 1. The password step alone hands back a challenge, never a session.
    const step1 = await evaluateSignIn(user.email, PASSWORD, "10.5.0.1");
    assert.equal("session" in step1, false);

    // 2. A challenge token with no code does not pass.
    assert.equal((await completeChallenge(step1.pending.token, "", "10.5.0.1")).ok, false);

    // 3. The enroll branch cannot be used to skip: it is only minted for an account
    //    with nothing enabled, and this one has something enabled.
    assert.equal(step1.pending.kind, "verify");

    // 4. An empty policy does not disable an enrolled user's second factor.
    await setRequire2fa("");
    const again = await evaluateSignIn(user.email, PASSWORD, "10.5.0.1");
    assert.ok("pending" in again);

    // 5. Neither does removing the role.
    await prisma.user.update({ where: { id: user.id }, data: { roleId: null } });
    const noRole = await evaluateSignIn(user.email, PASSWORD, "10.5.0.1");
    assert.ok("pending" in noRole, "no role is not a reason to skip a second factor");
    await prisma.user.update({ where: { id: user.id }, data: { roleId: roleStaff.id } });
    await clearAllAttempts();
  });

  test("a backup code is not a standing key either", async () => {
    const codes = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: encryptSecret(SECRET),
        totpEnabled: true,
        backupCodesEnc: JSON.stringify([hashBackupCode(codes[0])]),
      },
    });

    const first = await evaluateSignIn(user.email, PASSWORD, "10.5.0.2");
    assert.equal((await completeChallenge(first.pending.token, codes[0], "10.5.0.2")).ok, true);
    await clearAllAttempts();

    const second = await evaluateSignIn(user.email, PASSWORD, "10.5.0.2");
    const replay = await completeChallenge(second.pending.token, codes[0], "10.5.0.2");
    assert.equal(replay.ok, false, "and it cannot be replayed");
    await clearAllAttempts();
  });
});
