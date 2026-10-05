import "server-only";

/**
 * Re-exported rather than defined here: `secretKey` is pure, and keeping it in this
 * file made it unreachable from a test. See `src/lib/secret-key.ts`.
 */
export { secretKey } from "@/lib/secret-key";
export type { SessionUser } from "@/lib/session-shape";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { secretKey } from "@/lib/secret-key";
import {
  completeChallenge,
  evaluateSignIn,
  type Step1Result,
  type Step2Result,
} from "@/lib/services/two-factor";
import type { SessionUser } from "@/lib/session-shape";
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

/**
 * Password-only sign-in, for callers that do not go through the two-step flow.
 *
 * Kept because the login *form* action still uses it for accounts with no second
 * factor, and because it is the behaviour the whole application had before Phase S.
 * Anything that should honour `security.require2fa` must call `loginStep1`
 * instead — this function has no idea a second factor exists, which is exactly why
 * it is not what the login route uses.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  clientIp = "unknown"
): Promise<LoginFailure> {
  const result = await loginStep1(email, password, clientIp);
  if (!result.ok) return result;
  if (result.kind === "pending") {
    // A second factor is owed, and this function cannot serve one — so it must not
    // pretend the sign-in succeeded, and it must not leave a cookie behind either.
    // `loginStep1` has already cleared it.
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, session: result.session, method: "password" };
}

export type LoginFailure =
  | { ok: false; reason: "locked"; retryAfterSec: number }
  | { ok: false; reason: "invalid" }
  /**
   * `method` is how the second factor was satisfied, or `"password"` when there was
   * none. Reported rather than inferred afterwards: a backup code's *shape* cannot
   * be told from a TOTP code's by looking at it, and a caller that guesses gets it
   * wrong exactly when somebody needs telling that they have two codes left.
   */
  | { ok: true; session: SessionUser; method: "password" | "totp" | "backup" };

/**
 * The outcome of the password step when a second factor is still owed.
 *
 * `kind: "enroll"` is not a soft failure and must not be readable as one: the user
 * has proved who they are and is being asked to finish setting up. They have **no
 * session**, so there is nothing to bypass the challenge with.
 */
export type PendingSecondFactor = {
  ok: true;
  pending: {
    token: string;
    kind: "verify" | "enroll";
    email: string;
    /** How long the challenge is good for. Five minutes is long enough to find a
     *  phone and short enough that a token left in a browser is not a standing key. */
    expiresInSec: number;
  };
};

export type LoginStep1 = LoginFailure | PendingSecondFactor;

/**
 * The first half of a sign-in, cookie included.
 *
 * A pending challenge clears any session cookie on the way through. It has to:
 * `verifyPasswordStep` may have just been called by a flow that left one behind,
 * and "you have proved your password but you are not signed in" has to be true of
 * the browser as well as of this function's return value.
 */
export async function loginStep1(
  email: string,
  password: string,
  clientIp = "unknown"
): Promise<Step1Result> {
  const result = await evaluateSignIn(email, password, clientIp);

  if (!result.ok) return result;

  if (result.kind === "pending") {
    await clearSessionCookie();
    return result;
  }

  await prisma.user.update({
    where: { id: result.session.id },
    data: { lastLoginAt: new Date() },
  });
  await setSessionCookie(result.session);
  return result;
}

/**
 * The second half, cookie included. The decision is in
 * `src/lib/services/two-factor.ts`; this is the part that needs `next/headers`.
 */
export async function loginStep2(
  token: string,
  code: string,
  clientIp = "unknown"
): Promise<Step2Result> {
  const result = await completeChallenge(token, code, clientIp);
  if (result.ok && result.kind === "session") {
    await prisma.user.update({
      where: { id: result.session.id },
      data: { lastLoginAt: new Date() },
    });
    await setSessionCookie(result.session);
  }
  return result;
}
