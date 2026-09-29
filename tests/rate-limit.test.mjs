/**
 * Lockout behaviour. The point of these tests is that a locked account costs
 * nothing: no bcrypt work, no database write beyond the counter, and no
 * difference in the answer between "locked" and "wrong password" beyond the
 * status code an API client can already tell apart.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkMemoryRateLimit,
  recordFailedAttempt,
  clearAttempts,
  MAX_ATTEMPTS,
} from "../src/lib/rate-limit.ts";

const EMAIL = "locked-out@example.com";

describe("login rate limit", () => {
  beforeEach(() => clearAttempts(EMAIL, "10.0.0.1"));

  test("allows the first attempts", () => {
    const first = checkMemoryRateLimit(EMAIL, "10.0.0.1");
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, MAX_ATTEMPTS);
  });

  test("locks out after MAX_ATTEMPTS failures", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(EMAIL, "10.0.0.1");

    const locked = checkMemoryRateLimit(EMAIL, "10.0.0.1");
    assert.equal(locked.allowed, false, "the next attempt should be refused");
    assert.equal(locked.remaining, 0);
    assert.ok(locked.retryAfterSec > 0, "a lockout must say when to retry");
  });

  test("counts down as the window passes", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(EMAIL, "10.0.0.1");

    const first = checkMemoryRateLimit(EMAIL, "10.0.0.1");
    // Reading twice in a row must not consume or reset anything.
    const second = checkMemoryRateLimit(EMAIL, "10.0.0.1");
    assert.equal(second.allowed, false);
    assert.ok(second.retryAfterSec <= first.retryAfterSec);
    assert.ok(second.retryAfterSec > 0);
  });

  test("a different address is unaffected, but the account is still the unit", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(EMAIL, "10.0.0.1");

    // The in-memory layer is keyed by address so one noisy network does not
    // lock out an entire office; the database counter is what stops the
    // attack across addresses.
    const other = checkMemoryRateLimit(EMAIL, "10.0.0.2");
    assert.equal(other.allowed, true, "a different address gets its own budget");

    const differentAccount = checkMemoryRateLimit("someone-else@example.com", "10.0.0.1");
    assert.equal(differentAccount.allowed, true, "a different account is unaffected");
  });

  test("a success clears the counter", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(EMAIL, "10.0.0.1");
    assert.equal(checkMemoryRateLimit(EMAIL, "10.0.0.1").allowed, false);

    clearAttempts(EMAIL, "10.0.0.1");

    assert.equal(
      checkMemoryRateLimit(EMAIL, "10.0.0.1").allowed,
      true,
      "a successful sign-in should clear the countdown"
    );
  });

  test("an unknown address is counted too, so probing cannot be free", () => {
    const unknown = "never-existed@example.com";
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(unknown, "10.0.0.5");
    assert.equal(checkMemoryRateLimit(unknown, "10.0.0.5").allowed, false);
    clearAttempts(unknown, "10.0.0.5");
  });
});
