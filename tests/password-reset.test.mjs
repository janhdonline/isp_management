/**
 * Password reset. The properties that matter are the ones an attacker wants to
 * break: a token must not be readable from the database, must not work twice,
 and must not survive its window.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import {
  requestPasswordReset,
  peekResetToken,
  completePasswordReset,
  pruneResetTokens,
} from "../src/lib/services/password-reset.ts";

const EMAIL = "reset-test@example.com";
let userId;

const cleanup = async () => {
  await prisma.passwordReset.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
};

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      name: "Reset Test",
      email: EMAIL,
      // A hash of something known, so the post-reset check can verify it changed.
      passwordHash: "$2a$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
      status: "Active",
    },
    select: { id: true },
  });
  userId = user.id;
  return user;
}

describe("password reset", () => {
  test("an unknown address gets the same answer as a known one", async () => {
    const known = await requestPasswordReset(EMAIL);
    const unknown = await requestPasswordReset("nobody-at-all@example.com");
    // Identical wording: a different reply would be an account-enumeration
    // oracle.
    assert.equal(known.message, unknown.message);
  });

  test("a token is stored hashed, not in the clear", async () => {
    await makeUser();
    await prisma.passwordReset.deleteMany({ where: { userId } });

    await requestPasswordReset(EMAIL);

    const rows = await prisma.passwordReset.findMany({ where: { userId } });
    assert.ok(rows.length > 0, "a token row should exist");
    for (const row of rows) {
      // 64 hex characters: a SHA-256 digest.
      assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
      assert.equal(row.usedAt, null);
    }
  });

  test("an invalid token is refused", async () => {
    assert.equal(await peekResetToken("not-a-real-token"), null);
    assert.equal(await peekResetToken(""), null);
  });

  test("a reset changes the password and burns the token", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, tokenVersion: true },
    });

    // Grab the token the same way the emailed link would: the plaintext is
    // only in the server log, so here the flow is exercised through the public
    // functions using a token we control.
    const raw = "test-token-that-is-long-enough-to-be-valid";
    const { createHash } = await import("node:crypto");
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    const account = await peekResetToken(raw);
    assert.ok(account, "a live token should resolve to an account");
    assert.equal(account.email, EMAIL);

    await completePasswordReset(raw, "a-brand-new-password");

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, tokenVersion: true },
    });
    assert.notEqual(after.passwordHash, before.passwordHash, "the hash must change");
    assert.ok(
      after.tokenVersion > before.tokenVersion,
      "a reset must end existing sessions"
    );

    // Second use of the same link must fail.
    await assert.rejects(
      () => completePasswordReset(raw, "another-password"),
      /already been used/
    );
  });

  test("an expired token is refused", async () => {
    const { createHash } = await import("node:crypto");
    const raw = "expired-token-value-here";
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    assert.equal(await peekResetToken(raw), null, "an expired token should not resolve");
    await assert.rejects(() => completePasswordReset(raw, "some-password"), /expired/);
  });

  test("pruning clears spent and long-expired tokens", async () => {
    const { createHash } = await import("node:crypto");
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: createHash("sha256").update("old-spent-token").digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });

    const removed = await pruneResetTokens();
    assert.ok(removed >= 1, "a spent token should be removed");
  });
});
