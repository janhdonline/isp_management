import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Customer portal sessions.
 *
 * ## The one thing this must never do
 *
 * `Customer.password` is the PPPoE secret. It is stored in the clear because a
 * MikroTik needs it in the clear, and it is sent to the router in the clear on
 * every provisioning call. Treating it as a login credential would mean a
 * credential that exists in two places — here and on the router — is a
 * credential an attacker can read off the wire, and a customer whose IT provider
 * can see it can impersonate them here. So the portal has its own credential:
 * `portalPasswordHash`, a bcrypt hash, set by the customer or by staff.
 *
 * ## Isolation from staff sessions
 *
 * A separate cookie (`portal_session`), a separate payload shape, and a separate
 * verifier. The staff guard reads only `isp_session` and the portal guard reads
 * only `portal_session`, so neither can be satisfied by the other. That is what
 * stops a customer browsing the whole billing system by logging in to their own
 * account.
 */

const COOKIE = "portal_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours, as staff

export type PortalSession = {
  customerId: string;
  portalTokenVersion: number;
};

let cachedKey: Uint8Array | null = null;

/**
 * The signing key. Falls back to a per-process random key in development, which
 * means restarting the server signs every portal customer out — that is the
 * correct trade for a fallback, and it throws in production rather than shipping a
 * hardcoded key.
 */
function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  // The same variable and the same rules as the staff session in `auth.ts`. The
  // minimum-length check is repeated rather than shared because a short secret
  // accepted here and refused there would be a very confusing deployment: staff
  // would fail to sign in with an error naming AUTH_SECRET, while the portal
  // silently worked with a weak key.
  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    const message =
      "AUTH_SECRET is not set. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"';

    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${message}\nWithout it every restart invalidates every portal session, and a hardcoded ` +
          `key would be readable by anyone with the source.`
      );
    }
    console.warn(
      `[portal] ${message}\n[portal] Using a random per-process key; portal sessions end on restart.`
    );
    cachedKey = new TextEncoder().encode(randomBytes(32).toString("base64url"));
    return cachedKey;
  }

  if (configured.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters long.");
  }

  cachedKey = new TextEncoder().encode(configured);
  return cachedKey;
}

/**
 * Mirrors the staff cookie's `secure` decision.
 *
 * Keyed on the actual transport rather than NODE_ENV, because NODE_ENV breaks
 * every local run of a production build: the cookie is silently dropped and every
 * page bounces back to the login screen.
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  const override = process.env.SESSION_COOKIE_SECURE?.toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

/* ------------------------------------------------------------------ */
/* Signing in                                                          */
/* ------------------------------------------------------------------ */

/**
 * Authenticates a customer on the username they already have for their line.
 *
 * Two failure messages, and the distinction is deliberate. "No portal access" is
 * actionable — the customer can go and ask staff to turn it on. "Wrong username
 * or password" is not, and it must not reveal whether the account exists. So an
 * unknown username returns the same error as a wrong password, and a real account
 * with no portal access returns a different one that only someone who genuinely
 * holds that username can elicit.
 */
export async function portalLogin(
  username: string,
  password: string
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const uname = username.trim();
  if (!uname || !password) {
    return { ok: false, error: "Enter your username and password." };
  }

  const customer = await prisma.customer.findUnique({
    where: { username: uname },
    select: { id: true, name: true, username: true, portalPasswordHash: true, connectionStatus: true },
  });

  if (!customer) {
    // Still spends the time a bcrypt compare would, so the response does not
    // reveal that the username does not exist.
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, error: "Wrong username or password." };
  }

  if (customer.connectionStatus === "Disconnected") {
    return {
      ok: false,
      error: "This account is closed. Please contact your provider.",
    };
  }

  if (!customer.portalPasswordHash) {
    return {
      ok: false,
      error:
        "There is no portal password on this account yet. Please ask your provider to set one up.",
    };
  }

  const matches = await bcrypt.compare(password, customer.portalPasswordHash);
  if (!matches) {
    return { ok: false, error: "Wrong username or password." };
  }

  return { ok: true, customerId: customer.id };
}

/** A real bcrypt hash of a value nobody knows, used to burn the same time. */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/* ------------------------------------------------------------------ */
/* The session cookie                                                  */
/* ------------------------------------------------------------------ */

export async function setPortalSessionCookie(customerId: string) {
  const row = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { portalTokenVersion: true },
  });

  const token = await new SignJWT({
    customerId,
    portalTokenVersion: row.portalTokenVersion,
  } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureCookie(),
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearPortalSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * Reads the portal session, or null.
 *
 * Reads only `portal_session`, never `isp_session` — that is the whole of the
 * isolation, and it is why the cookie names are not configurable into the same
 * value. The customer's current `portalTokenVersion` must match the one in the
 * cookie, so changing the password ends every session issued before it.
 */
export async function getPortalSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  let session: PortalSession;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    session = payload as unknown as PortalSession;
  } catch {
    return null;
  }
  if (!session?.customerId) return null;

  const row = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { portalTokenVersion: true, connectionStatus: true },
  });
  // A deleted customer, a disconnected line, or a password changed since the
  // cookie was issued.
  if (!row) return null;
  if (row.connectionStatus === "Disconnected") return null;
  if (row.portalTokenVersion !== session.portalTokenVersion) return null;

  return session;
}

/** The guard every portal page calls. */
export async function requirePortalCustomer(): Promise<PortalSession> {
  const session = await getPortalSession();
  if (!session) redirect("/portal/login");
  return session;
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sets or replaces the portal password and ends every existing portal session.
 *
 * Bumping the version is not optional. Staff set this password on the customer's
 * behalf, so a customer who has been reading their own invoice in the portal
 * while staff change it would otherwise stay signed in under the old one.
 */
export async function setPortalPassword(customerId: string, next: string) {
  const hash = await bcrypt.hash(next, 10);
  await prisma.customer.update({
    where: { id: customerId },
    data: { portalPasswordHash: hash, portalTokenVersion: { increment: 1 } },
  });
  return true;
}

/**
 * Changes the password when the customer knows the current one.
 *
 * Also bumps the version, so changing it from the portal signs out the other
 * devices too — which is the point of changing a password.
 */
export async function changePortalPassword(
  customerId: string,
  current: string,
  next: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { portalPasswordHash: true },
  });

  if (!row.portalPasswordHash) {
    return { ok: false, error: "There is no portal password on this account. Please ask your provider to set one up." };
  }

  const matches = await bcrypt.compare(current, row.portalPasswordHash);
  if (!matches) {
    return { ok: false, error: "That is not your current password." };
  }

  const hash = await bcrypt.hash(next, 10);
  await prisma.customer.update({
    where: { id: customerId },
    data: { portalPasswordHash: hash, portalTokenVersion: { increment: 1 } },
  });

  // The caller is now signed out; the version bump above is what does it. A
  // fresh cookie is not issued, so the customer signs in again with the new
  // password — the same as any other credential change.
  return { ok: true };
}

/** Used by the staff side and the tests. */
export async function hasPortalAccess(customerId: string): Promise<boolean> {
  const row = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { portalPasswordHash: true },
  });
  return Boolean(row?.portalPasswordHash);
}
