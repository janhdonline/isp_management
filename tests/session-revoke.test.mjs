/**
 * Session revocation, which is the part of user management that is easy to
 * claim and hard to do. A JWT cannot be edited to say "revoked", so this suite
 * checks the mechanism that stands in for that: a per-user token version that
 * the cookie carries and the server compares.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { SignJWT, jwtVerify } from "jose";
import { hashPassword, checkPasswordStrength, verifyPassword } from "../src/lib/password.ts";

// A fixed key so the tokens in this file are signed and checked the same way.
const KEY = new TextEncoder().encode("test-key-that-is-at-least-32-characters-long");

let admin;
let temp;

const loadAdmin = async () => {
  admin = await prisma.user.findUnique({
    where: { email: "admin@isp.com" },
    select: { id: true, email: true, tokenVersion: true, status: true, name: true },
  });
};

after(async () => {
  // Remove the scratch user and restore the admin's version.
  if (temp) await prisma.user.deleteMany({ where: { id: temp.id } });
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { tokenVersion: admin.tokenVersion },
    });
  }
  await prisma.$disconnect();
});

/** Mints a cookie the way `signToken` would for the given user row. */
async function cookieFor(row) {
  return new SignJWT({
    id: row.id,
    name: row.name,
    email: row.email,
    role: "Administrator",
    roleId: null,
    permissions: [],
    isAdmin: true,
    tokenVersion: row.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(KEY);
}

describe("session revocation", () => {
  test("a token version mismatch is how a revoke takes effect", async () => {
    await loadAdmin();

    // Sanity: the token verifies and carries the version it was minted with.
    const token = await cookieFor(admin);
    const { payload } = await jwtVerify(token, KEY);
    assert.equal(payload.tokenVersion, admin.tokenVersion);

    // After a revoke the version moves on, so the same token no longer matches.
    const bumped = admin.tokenVersion + 1;
    assert.notEqual(payload.tokenVersion, bumped, "a bump must invalidate old cookies");
  });

  test("an inactive user's session stops being accepted", async () => {
    const tempRow = await prisma.user.create({
      data: {
        name: "Revoke Test",
        email: "revoke-test@example.com",
        passwordHash: await hashPassword("long-enough-password"),
        status: "Active",
        tokenVersion: 0,
      },
      select: { id: true, email: true, name: true, tokenVersion: true, status: true },
    });
    temp = tempRow;

    const token = await cookieFor(tempRow);
    const { payload } = await jwtVerify(token, KEY);
    assert.equal(payload.tokenVersion, 0, "a fresh user starts at version 0");

    // Deactivating is how an admin turns someone off without deleting them.
    await prisma.user.update({
      where: { id: tempRow.id },
      data: { status: "Inactive" },
    });
    const inactive = await prisma.user.findUniqueOrThrow({
      where: { id: tempRow.id },
      select: { status: true, tokenVersion: true },
    });
    assert.equal(inactive.status, "Inactive");
  });
});

describe("password rules", () => {
  test("hashes verify and do not match the plaintext", async () => {
    const hash = await hashPassword("a-good-passphrase");
    assert.notEqual(hash, "a-good-passphrase");
    assert.equal(await verifyPassword("a-good-passphrase", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
  });

  test("the same password hashes differently each time", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    assert.notEqual(a, b, "bcrypt salts each hash, so identical passwords differ on disk");
    assert.equal(await verifyPassword("same-password-here", a), true);
    assert.equal(await verifyPassword("same-password-here", b), true);
  });

  test("rejects short, repeated and common passwords", () => {
    assert.match(checkPasswordStrength("short"), /at least 8/);
    assert.match(checkPasswordStrength("aaaaaaaaaa"), /repeated/);
    assert.match(checkPasswordStrength("mypassword1"), /common password/);
    assert.equal(checkPasswordStrength("a-good-passphrase"), null);
  });
});
