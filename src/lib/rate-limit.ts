/**
 * Login throttling.
 *
 * An ISP login page with no limit is a free password-guessing oracle: a
 * script can try millions of passwords a second against a known email address.
 * This counts failed attempts per email (and per client address) and refuses
 * further tries until the window passes.
 *
 * Two layers, because they fail differently:
 *
 *  - the database counter survives a restart and is shared across instances,
 *    so a lockout cannot be cleared by bouncing the process;
 *  - the in-memory layer refuses work before the database is touched, so a
 *    flood does not turn into a flood of queries.
 *
 * The in-memory layer is a safety net for one process, not the real control —
 * on more than one instance the database count is what actually applies.
 */
import { prisma } from "@/lib/prisma";

/** Attempts allowed inside the window. */
export const MAX_ATTEMPTS = 5;
/** How long a lockout lasts, in milliseconds. */
const WINDOW_MS = 15 * 60 * 1000;

type Bucket = { count: number; firstAt: number };
const memory = new Map<string, Bucket>();

function keyFor(email: string, ip: string) {
  return `${email.toLowerCase()}|${ip}`;
}

/** Drops buckets that can no longer block anything, so the map cannot grow. */
function sweep() {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, b] of memory) {
    if (b.firstAt < cutoff) memory.delete(k);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the next attempt is permitted, when locked out. */
  retryAfterSec?: number;
};

export function checkMemoryRateLimit(email: string, ip: string): RateLimitResult {
  if (memory.size > 10_000) sweep();

  const b = memory.get(keyFor(email, ip));
  if (!b) return { allowed: true, remaining: MAX_ATTEMPTS };

  if (Date.now() - b.firstAt >= WINDOW_MS) {
    memory.delete(keyFor(email, ip));
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  if (b.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (Date.now() - b.firstAt)) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - b.count };
}

export function recordFailedAttempt(email: string, ip: string) {
  const k = keyFor(email, ip);
  const b = memory.get(k);
  if (!b || Date.now() - b.firstAt >= WINDOW_MS) {
    memory.set(k, { count: 1, firstAt: Date.now() });
    return;
  }
  b.count += 1;
}

/** A successful login clears the counter for that key. */
export function clearAttempts(email: string, ip: string) {
  memory.delete(keyFor(email, ip));
}

/**
 * The persistent half. Counters are keyed by email alone in the database,
 * because an attacker who rotates source addresses is still attacking one
 * account, and the IP key here is best-effort behind whatever proxy is in front.
 */
export async function checkDatabaseRateLimit(email: string): Promise<RateLimitResult> {
  const row = await prisma.loginAttempt.findUnique({ where: { email } });
  if (!row) return { allowed: true, remaining: MAX_ATTEMPTS };

  const age = Date.now() - row.firstAt.getTime();
  if (age >= WINDOW_MS) {
    await prisma.loginAttempt.deleteMany({ where: { email } });
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  if (row.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((WINDOW_MS - age) / 1000),
    };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - row.count };
}

export async function recordDatabaseAttempt(email: string, ip: string) {
  const existing = await prisma.loginAttempt.findUnique({ where: { email } });
  if (!existing || Date.now() - existing.firstAt.getTime() >= WINDOW_MS) {
    await prisma.loginAttempt.upsert({
      where: { email },
      create: { email, count: 1, firstAt: new Date(), ip },
      update: { count: 1, firstAt: new Date(), ip },
    });
    return;
  }
  await prisma.loginAttempt.update({
    where: { email },
    data: { count: { increment: 1 }, ip },
  });
}

export async function clearDatabaseAttempts(email: string) {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}

/** Clears every counter. For an administrator who has locked themselves out. */
export async function clearAllAttempts() {
  await prisma.loginAttempt.deleteMany({});
  memory.clear();
}
