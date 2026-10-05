/**
 * Rate limiting for password-reset *requests* (ISP.md §43).
 *
 * ## Deliberately not the login counters
 *
 * `rate-limit.ts` keys on the account email and shares its budget with the
 * password step. That is right for sign-in — five wrong passwords should stop a
 * guesser — and **catastrophic for resets**: anybody could type a colleague's
 * email into the forgot-password form five times and lock them out of signing in
 * entirely, without ever knowing a password. A reset request is unauthenticated by
 * definition, so it cannot be allowed to spend an authenticated budget.
 *
 * So this is the same *shape* — an in-memory window, keyed, with the count and
 * window the caller configures — over its own keyspace, prefixed so it cannot
 * collide with the login keys.
 *
 * ## In memory, and what that costs
 *
 * Counters die on restart and are per process, so a multi-instance deployment
 * gets roughly one window per instance. That is a deliberate trade: the persisted
 * half of this problem is already covered by `MAX_REQUESTS_PER_DAY` in the
 * service, which is a database counter and therefore survives a restart. The
 * in-memory window here is the fast layer that stops a burst before it reaches the
 * database at all.
 */

type Window = { count: number; firstAt: number };

const memory = new Map<string, Window>();

export type LimitResult = { allowed: boolean; retryAfterSec?: number };

export const RESET_WINDOW_MS = 15 * 60_000;
export const MAX_RESET_REQUESTS_PER_WINDOW = 3;
/** Per source address, higher: several people can share an office NAT. */
export const MAX_RESET_REQUESTS_PER_IP = 10;

function keyFor(scope: "email" | "ip", value: string): string {
  return `reset:${scope}:${value.trim().toLowerCase()}`;
}

/** Counts a request against one scope without recording it. */
export function check(scope: "email" | "ip", value: string, max: number): LimitResult {
  const now = Date.now();
  const w = memory.get(keyFor(scope, value));
  if (!w) return { allowed: true };
  // The window restarts once it has elapsed, rather than decaying gradually — a
  // gradual decay needs per-request timestamps, which is more state than this is
  // worth for stopping a burst.
  if (now - w.firstAt >= RESET_WINDOW_MS) {
    memory.delete(keyFor(scope, value));
    return { allowed: true };
  }
  if (w.count >= max) {
    return { allowed: false, retryAfterSec: Math.ceil((w.firstAt + RESET_WINDOW_MS - now) / 1000) };
  }
  return { allowed: true };
}

export function record(scope: "email" | "ip", value: string): void {
  const now = Date.now();
  const k = keyFor(scope, value);
  const w = memory.get(k);
  if (!w || now - w.firstAt >= RESET_WINDOW_MS) {
    memory.set(k, { count: 1, firstAt: now });
    return;
  }
  w.count += 1;
}

export function clear(scope: "email" | "ip", value: string): void {
  memory.delete(keyFor(scope, value));
}

/** Test and diagnostic helper. */
export function resetAll(): void {
  memory.clear();
}
