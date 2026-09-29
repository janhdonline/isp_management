import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { type PermissionKey } from "@/lib/permissions";

const COOKIE = "isp_session";
const MAX_AGE = 60 * 60 * 12; // 12h

/**
 * The key that signs session cookies.
 *
 * There is deliberately no hardcoded fallback. A secret written into the source
 * is a secret in the repository: anyone who can read it can mint a cookie that
 * passes verification and sign in as an administrator. A missing AUTH_SECRET is
 * a deployment mistake, so it is reported loudly and, in production, refused
 * outright rather than quietly downgraded to something guessable.
 */
let cachedKey: Uint8Array | null = null;

function secretKey() {
  if (cachedKey) return cachedKey;

  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    const message =
      "AUTH_SECRET is not set. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"\n' +
      "and put it in .env — anyone who knows this value can forge a session cookie.";

    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    }
    console.warn(`[auth] ${message}\n[auth] Using a random per-process key; sessions end on restart.`);
    cachedKey = new TextEncoder().encode(randomBytes(32).toString("base64url"));
    return cachedKey;
  }

  if (configured.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters long.");
  }

  cachedKey = new TextEncoder().encode(configured);
  return cachedKey;
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId: string | null;
  permissions: string[];
  isAdmin: boolean;
  /**
   * Copied from the user row at sign-in. `getSession` compares it with the
   * current value, so a password change or a revoke ends every cookie that was
   * issued before it, without keeping a server-side session list.
   */
  tokenVersion: number;
};

export async function signToken(user: SessionUser) {
  return new SignJWT({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleId: user.roleId,
    permissions: user.permissions,
    isAdmin: user.isAdmin,
    tokenVersion: user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

/**
 * Whether to mark the session cookie `Secure`.
 *
 * A `Secure` cookie is only stored when the browser is on HTTPS, so tying this
 * to NODE_ENV breaks every local run of the production build: you sign in, the
 * cookie is silently dropped, and each click bounces back to /login.
 *
 * So the flag follows the actual transport instead: secure when a proxy tells
 * us the request arrived over HTTPS, and not secure otherwise. Set
 * `SESSION_COOKIE_SECURE=true` when TLS terminates somewhere that does not send
 * `x-forwarded-proto`.
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  const override = process.env.SESSION_COOKIE_SECURE?.toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export async function setSessionCookie(user: SessionUser) {
  const token = await signToken(user);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureCookie(),
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * Ends a session cookie early.
 *
 * A JWT is self-contained, so nothing about it can be edited to say "this has
 * been revoked". Instead the user row carries a `tokenVersion` that is copied
 * into the cookie at sign-in; bumping it makes every cookie issued before the
 * bump fail this comparison. One extra query on each session read is the price
 * of being able to actually turn someone off.
 */
async function isStillValid(user: SessionUser): Promise<boolean> {
  // A cookie issued before this column existed carries no version. Treat it as
  // valid so an upgrade does not sign everyone out at once.
  if (user.tokenVersion === undefined) return true;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { tokenVersion: true, status: true },
  });
  if (!row) return false;
  if (row.status !== "Active") return false;
  return row.tokenVersion === user.tokenVersion;
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const user = payload as unknown as SessionUser;
    return (await isStillValid(user)) ? user : null;
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(
  req: Request
): Promise<SessionUser | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const user = payload as unknown as SessionUser;
    return (await isStillValid(user)) ? user : null;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new AuthError();
  return s;
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ForbiddenError extends Error {
  constructor(permission?: PermissionKey) {
    super(permission ? `Missing permission: ${permission}` : "Forbidden");
  }
}

export async function can(permission: PermissionKey): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  if (s.isAdmin) return true;
  return s.permissions.includes(permission);
}

export async function requirePermission(permission: PermissionKey) {
  const s = await requireSession();
  if (s.isAdmin) return s;
  if (!s.permissions.includes(permission)) throw new ForbiddenError(permission);
  return s;
}

/** Same check for API route handlers, which read the cookie off the request. */
export async function requirePermissionFromRequest(
  req: Request,
  permission: PermissionKey
): Promise<SessionUser> {
  const s = await getSessionFromRequest(req);
  if (!s) throw new AuthError();
  if (s.isAdmin) return s;
  if (!s.permissions.includes(permission)) throw new ForbiddenError(permission);
  return s;
}

export type LoginFailure =
  | { ok: false; reason: "locked"; retryAfterSec: number }
  | { ok: false; reason: "invalid" }
  | { ok: true; session: SessionUser };

/**
 * Signs a user in, counting failures against the account.
 *
 * The lockout is checked before the password is compared, so a locked account
 * costs no bcrypt work — which is also what stops the endpoint being used to
 * burn CPU. A successful sign-in clears the counter, so one mistyped password
 * does not start a countdown that only an administrator can stop.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  clientIp = "unknown"
): Promise<LoginFailure> {
  const rateLimit = await import("@/lib/rate-limit");

  const inMemory = rateLimit.checkMemoryRateLimit(email, clientIp);
  if (!inMemory.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: inMemory.retryAfterSec ?? 60 };
  }
  const persisted = await rateLimit.checkDatabaseRateLimit(email);
  if (!persisted.allowed) {
    return { ok: false, reason: "locked", retryAfterSec: persisted.retryAfterSec ?? 60 };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user) {
    // Count a miss for an unknown address too: otherwise the response time
    // tells an attacker which addresses exist.
    rateLimit.recordFailedAttempt(email, clientIp);
    await rateLimit.recordDatabaseAttempt(email, clientIp);
    return { ok: false, reason: "invalid" };
  }
  if (user.status !== "Active") {
    rateLimit.recordFailedAttempt(email, clientIp);
    await rateLimit.recordDatabaseAttempt(email, clientIp);
    return { ok: false, reason: "invalid" };
  }

  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    rateLimit.recordFailedAttempt(email, clientIp);
    await rateLimit.recordDatabaseAttempt(email, clientIp);
    return { ok: false, reason: "invalid" };
  }

  rateLimit.clearAttempts(email, clientIp);
  await rateLimit.clearDatabaseAttempts(email);

  const permissions = user.role?.permissions.map((rp) => rp.permission.key) ?? [];
  const session: SessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role?.name ?? "Staff",
    roleId: user.roleId,
    permissions,
    isAdmin: user.role?.name === "Administrator",
    tokenVersion: user.tokenVersion,
  };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await setSessionCookie(session);
  return { ok: true, session };
}
