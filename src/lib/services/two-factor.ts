/**
 * The sign-in decision, with no cookies in it (ISP.md §42).
 *
 * ## Why this is not in `auth.ts`
 *
 * `auth.ts` opens with `import "server-only"`, so nothing in it can be tested —
 * `server-only` throws outside a `react-server` bundle. Two other services here
 * already carry a comment about working around that. This module is the same
 * workaround applied to sign-in: **the decision is here, the cookie is in
 * `auth.ts`.** `loginStep1` and `loginStep2` are now four lines each.
 *
 * The split is also the honest one. "Is this password right and does a second
 * factor still stand" is a question about the database. "Write a cookie" is a
 * question about the HTTP response. Only the second one needs `next/headers`.
 */

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { secretKey } from "@/lib/secret-key";
import { requiresTotp, verifySecondFactor, confirmTotpEnrollment } from "@/lib/services/totp";
import type { SessionUser } from "@/lib/session-shape";

/** A challenge token is good for five minutes. */
export const CHALLENGE_TTL_SEC = 300;

export type ChallengeKind = "verify" | "enroll";

export type Challenge = {
  userId: string;
  email: string;
  kind: ChallengeKind;
  exp: number;
  jti: string;
};

/** What the caller has to do next. No session is ever returned from here. */
export type ChallengePending = {
  kind: ChallengeKind;
  token: string;
  email: string;
  expiresInSec: number;
};

/**
 * `reason: "locked"` is carried all the way out so the route can answer 429 with a
 * `Retry-After`. Collapsing it into "invalid" would tell a locked-out user their
 * password was wrong, which sends them to reset it and wastes an administrator's
 * time.
 */
export type Failure =
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterSec: number };

export type Step1Result =
  /** `method` says how the caller got in, so a caller can log it or show it. */
  | { ok: true; kind: "session"; session: SessionUser; method: "password" }
  | { ok: true; kind: "pending"; pending: ChallengePending }
  | Failure;

export type Step2Result =
  | { ok: true; kind: "session"; session: SessionUser; method: "totp" | "backup"; backupRemaining?: number }
  | { ok: true; kind: "pending"; pending: ChallengePending }
  | Failure;

function signChallenge(payload: Omit<Challenge, "exp" | "jti">): string {
  const full: Challenge = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC,
    jti: randomBytes(9).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const mac = createHmac("sha256", secretKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/**
 * Verifies a challenge token, or returns `null`.
 *
 * The MAC is checked before the JSON is parsed, so a forged token never reaches a
 * parser, and an invalid or expired one is `null` rather than an exception — a
 * caller should not have to tell "forged" from "malformed" to answer an attacker
 * the same way either way.
 */
export function readChallenge(token: string): Challenge | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = createHmac("sha256", secretKey()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: Challenge;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Challenge;
  } catch {
    return null;
  }
  if (!parsed?.userId || !parsed?.email || typeof parsed.exp !== "number") return null;
  if (parsed.exp * 1000 < Date.now()) return null;
  return parsed;
}

/** Loads the session shape for a user, or null. */
export async function sessionFor(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role?.name ?? "Staff",
    roleId: user.roleId,
    permissions: user.role?.permissions.map((rp) => rp.permission.key) ?? [],
    isAdmin: user.role?.name === "Administrator",
    tokenVersion: user.tokenVersion,
  };
}

export type PasswordVerdict = { ok: true } | Failure;

/**
 * Checks the password, counting failures exactly as `loginWithPassword` does.
 *
 * The lockout is checked **before** the comparison, so a locked account costs no
 * bcrypt work — which is also what stops the endpoint being used to burn CPU.
 */
export async function verifyPasswordStep(
  email: string,
  password: string,
  clientIp = "unknown"
): Promise<PasswordVerdict> {
  const rateLimit = await import("@/lib/rate-limit");
  const inMemory = rateLimit.checkMemoryRateLimit(email, clientIp);
  if (!inMemory.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: inMemory.retryAfterSec ?? 60 };
  }
  const persisted = await rateLimit.checkDatabaseRateLimit(email);
  if (!persisted.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: persisted.retryAfterSec ?? 60 };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "Active") {
    rateLimit.recordFailedAttempt(email, clientIp);
    await rateLimit.recordDatabaseAttempt(email, clientIp);
    return { ok: false, reason: "invalid" };
  }

  const bcrypt = await import("bcryptjs");
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    rateLimit.recordFailedAttempt(email, clientIp);
    await rateLimit.recordDatabaseAttempt(email, clientIp);
    return { ok: false, reason: "invalid" };
  }

  rateLimit.clearAttempts(email, clientIp);
  await rateLimit.clearDatabaseAttempts(email);
  return { ok: true };
}

/**
 * The first half of a sign-in.
 *
 * Two independent reasons to owe a second factor — the user turned it on, or their
 * role is on `security.require2fa` — and an enrolment outranks both. There is no
 * third: once `totpEnabled` is true, the only way past it is a valid code.
 */
export async function evaluateSignIn(
  email: string,
  password: string,
  clientIp = "unknown"
): Promise<Step1Result> {
  const verdict = await verifyPasswordStep(email, password, clientIp);
  if (!verdict.ok) return verdict;

  const subject = await prisma.user.findUnique({
    where: { email },
    select: { id: true, totpEnabled: true, role: { select: { name: true } } },
  });
  if (!subject) return { ok: false, reason: "invalid" };

  const session = await sessionFor(subject.id);
  if (!session) return { ok: false, reason: "invalid" };

  const settings = await getSettings();
  const enforced = requiresTotp(subject.role?.name, settings["security.require2fa"] ?? "");
  if (!subject.totpEnabled && !enforced) {
    return { ok: true, kind: "session", session, method: "password" };
  }

  const kind: ChallengeKind = subject.totpEnabled ? "verify" : "enroll";
  return {
    ok: true,
    kind: "pending",
    pending: { kind, token: signChallenge({ userId: subject.id, email, kind }), email, expiresInSec: CHALLENGE_TTL_SEC },
  };
}

/**
 * The second half.
 *
 * Rate-limited on the account the challenge names, with the **same**
 * `checkMemoryRateLimit` / `checkDatabaseRateLimit` and the same five-attempt
 * budget the password step uses. A six-digit code is a million times smaller a
 * space than a password, so a second factor limited less harshly is not a second
 * factor.
 */
export async function completeChallenge(
  token: string,
  code: string,
  clientIp = "unknown"
): Promise<Step2Result> {
  const challenge = readChallenge(token);
  if (!challenge) return { ok: false, reason: "invalid" };

  const rateLimit = await import("@/lib/rate-limit");
  const inMemory = rateLimit.checkMemoryRateLimit(challenge.email, clientIp);
  if (!inMemory.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: inMemory.retryAfterSec ?? 60 };
  }
  const persisted = await rateLimit.checkDatabaseRateLimit(challenge.email);
  if (!persisted.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: persisted.retryAfterSec ?? 60 };
  }

  let method: "totp" | "backup" = "totp";
  let remaining: number | null = null;

  // Handled separately rather than in a ternary: the two calls return different
  // shapes, and merging them loses the discrimination that makes the branches
  // below checkable.
  if (challenge.kind === "enroll") {
    const confirmed = await confirmTotpEnrollment(challenge.userId, code);
    if (!confirmed.ok) return fail(rateLimit, challenge.email, clientIp);
    // Reporting this as a TOTP sign-in is not a simplification: confirming an
    // enrollment is what turned the second factor on, so by the time a session
    // existed it had been satisfied.
  } else {
    const verified = await verifySecondFactor(challenge.userId, code);
    if (!verified.ok) return fail(rateLimit, challenge.email, clientIp);
    method = verified.method;
    remaining = verified.method === "backup" ? verified.remaining : null;
  }

  rateLimit.clearAttempts(challenge.email, clientIp);
  await rateLimit.clearDatabaseAttempts(challenge.email);

  const session = await sessionFor(challenge.userId);
  if (!session) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    kind: "session",
    session,
    method,
    // `remaining` is a number on the backup path by construction; the `?? undefined`
    // is for the type, not the value.
    ...(method === "backup" && remaining !== null ? { backupRemaining: remaining } : {}),
  };
}

async function fail(
  rateLimit: typeof import("@/lib/rate-limit"),
  email: string,
  clientIp: string
): Promise<Failure> {
  rateLimit.recordFailedAttempt(email, clientIp);
  await rateLimit.recordDatabaseAttempt(email, clientIp);
  return { ok: false, reason: "invalid" };
}
