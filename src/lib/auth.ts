import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { type PermissionKey } from "@/lib/permissions";

const COOKIE = "isp_session";
const MAX_AGE = 60 * 60 * 12; // 12h

function secretKey() {
  const s = process.env.AUTH_SECRET ?? "";
  return new TextEncoder().encode(s);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId: string | null;
  permissions: string[];
  isAdmin: boolean;
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

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionUser;
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
    return payload as unknown as SessionUser;
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

export async function loginWithPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user) return null;
  if (user.status !== "Active") return null;

  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const permissions = user.role?.permissions.map((rp) => rp.permission.key) ?? [];
  const session: SessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role?.name ?? "Staff",
    roleId: user.roleId,
    permissions,
    isAdmin: user.role?.name === "Administrator",
  };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await setSessionCookie(session);
  return session;
}
