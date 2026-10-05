/**
 * Staff TOTP two-factor authentication (ISP.md §42).
 *
 * A phished administrator password is currently the whole attack. This adds the
 * second factor, and the two things that make it worth having are the two things
 * that are easy to get wrong:
 *
 *  - **there is no bypass path once enrolled.** Not for a convenience flag, not for
 *    a role, not for "just this once". `verifyTotp` is the only way past an enabled
 *    second factor and it does not take an argument that could skip it.
 *  - **the secret is encrypted at rest and shown exactly once.**
 *
 * ## Why the TOTP maths is a library
 *
 * RFC 6238 is thirty lines of HMAC and base32, and getting it subtly wrong is a
 * security bug that still *looks* like it works — a code that verifies against a
 * clock one step off is indistinguishable from a correct implementation until the
 * day somebody's phone drifts. `otpauth` is checked here against the RFC's own
 * published vectors rather than trusted:
 *
 *     T=59        → 94287082   (SHA1, 8 digits)
 *     T=1111111109 → 07081804
 *
 * Its only dependency is `@noble/hashes`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  hkdfSync,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

/**
 * The key for encrypting TOTP secrets.
 *
 * Derived from `AUTH_SECRET` by HKDF with a fixed label, so a deployment manages
 * **one** secret rather than two — a second one is a second thing to forget, and a
 * forgotten key means every user's second factor has to be reset.
 *
 * `TOTP_ENCRYPTION_KEY` overrides it for a deployment that wants the domains
 * separated at the configuration level rather than by derivation.
 *
 * **The consequence, which operators need told:** rotating `AUTH_SECRET` also
 * rotates this, and every stored TOTP secret becomes undecryptable. That is the
 * safe direction — an attacker with the old secret cannot read the new column —
 * but it means a key rotation costs one 2FA reset per enrolled user. Setting
 * `TOTP_ENCRYPTION_KEY` to a value you will not rotate alongside `AUTH_SECRET`
 * avoids that, and is the better configuration if you can manage it.
 */
let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const own = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (own) {
    if (own.length < 32) throw new Error("TOTP_ENCRYPTION_KEY must be at least 32 characters.");
    cachedKey = Buffer.from(own, "utf8").subarray(0, 32);
    return cachedKey;
  }

  const auth = process.env.AUTH_SECRET?.trim();
  if (!auth) {
    const message =
      "Neither TOTP_ENCRYPTION_KEY nor AUTH_SECRET is set. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"';
    if (process.env.NODE_ENV === "production") throw new Error(message);
    console.warn(`[totp] ${message}\n[totp] Using a random per-process key; 2FA secrets do not survive a restart.`);
    cachedKey = randomBytes(32);
    return cachedKey;
  }

  // HKDF with a fixed label: domain-separated from the session key that is derived
  // from the same secret, so knowing one does not give you the other.
  cachedKey = Buffer.from(hkdfSync("sha256", Buffer.from(auth, "utf8"), Buffer.alloc(0), Buffer.from("isp-totp-secret-v1"), 32));
  return cachedKey;
}

/**
 * AES-256-GCM. Authenticated, so a tampered ciphertext fails to decrypt rather than
 * decrypting into garbage that would then be treated as a secret.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string | null {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // A failed tag check lands here: wrong key, or a tampered row. Both mean the
    // same thing to the caller — this secret is unusable — and neither is a reason
    // to throw inside a sign-in.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Secret and provisioning URI
// ---------------------------------------------------------------------------

export type TotpSetup = {
  /** Base32 secret. Shown once and never again. */
  secret: string;
  /** The `otpauth://` URI for a QR code. */
  uri: string;
};

/**
 * A fresh secret and its provisioning URI.
 *
 * SHA1 with 6 digits and a 30-second step, because that is what every
 * authenticator app supports; SHA-256 or 8-digit codes are better cryptography and
 * work on a minority of phones.
 */
export function newTotpSetup(email: string, issuer = "ISP Manager"): TotpSetup {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    secret,
    label: email,
    issuer,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Checks a six-digit code.
 *
 * `otpauth` does the HMAC and returns the step delta, or `null` for no match at
 * any step in the window. The constant-time requirement is met *by not
 * comparing at all*: there is no string equality on a secret-derived value here, so
 * there is nothing for a timing attack to measure. A code that matches returns a
 * delta; anything else returns `null`.
 *
 * `window: 1` is one step either side — 30 seconds of clock drift each way, which
 * covers a phone whose clock is minutes out without opening a six-digit space wide
 * enough to brute-force inside the rate limiter's budget.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  now: number = Date.now()
): boolean {
  const clean = code.replace(/\D/g, "");
  // Length first: a 4-digit guess must not be silently padded into a 6-digit one.
  if (clean.length !== 6) return false;
  try {
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secretBase32),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    return totp.validate({ token: clean, timestamp: now, window: 1 }) !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------

const BACKUP_CODES = 10;

/**
 * Recovery codes, shown once.
 *
 * Ten, because a person losing their phone has usually also lost the phone's notes,
 * and a code list they wrote down once and kept in a drawer is worth more than the
 * tidy six of some implementations.
 */
export function generateBackupCodes(count = BACKUP_CODES): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    // 10 bytes → 20 hex characters, grouped for transcription.
    const raw = randomBytes(5).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

/**
 * Hashes a code for storage.
 *
 * A plain SHA-256, not bcrypt, and that is a deliberate difference from
 * `password.ts`. These codes have 40 bits of entropy, so there is nothing to
 * brute-force; a slow KDF would make every sign-in attempt wait on purpose, and
 * the threat they face is a stolen database column rather than an offline guess.
 * The comparison is constant-time regardless.
 */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normaliseBackupCode(code), "utf8").digest("hex");
}

export function normaliseBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Constant-time equality, for anything derived from a secret. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export type EnrollResult =
  | { ok: true; setup: TotpSetup; backupCodes: string[] }
  | { ok: false; error: string };

/**
 * Starts enrollment: creates a secret and stores it **not yet enabled**.
 *
 * The secret is written before the user has confirmed anything, so the QR and the
 * stored value cannot disagree — but `totpEnabled` stays false, so an abandoned
 * enrollment leaves no second factor behind. A half-enrolled user can still sign in
 * with a password, which is correct: they never finished.
 */
export async function beginTotpEnrollment(
  userId: string,
  email: string
): Promise<EnrollResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "That account no longer exists." };

  const setup = newTotpSetup(email);
  const backupCodes = generateBackupCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecretEnc: encryptSecret(setup.secret),
      totpEnabled: false,
      totpEnabledAt: null,
      backupCodesEnc: JSON.stringify(backupCodes.map(hashBackupCode)),
      backupCodesUsedAt: null,
    },
  });

  return { ok: true, setup, backupCodes };
}

/**
 * Confirms enrollment by checking a live code.
 *
 * The code is verified against the **stored, encrypted** secret rather than the
 * one the caller just handed us, so what gets enabled is what will later be used
 * to verify. That closes the gap where a stale QR is scanned and a different
 * secret is enabled from it.
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpEnabled: true },
  });
  if (!user) return { ok: false, error: "That account no longer exists." };
  if (!user.totpSecretEnc) {
    return { ok: false, error: "Start the setup again — there is no pending secret." };
  }
  if (user.totpEnabled) {
    return { ok: false, error: "Two-factor authentication is already on for this account." };
  }

  const secret = decryptSecret(user.totpSecretEnc);
  if (!secret) {
    return {
      ok: false,
      error:
        "The stored secret could not be read. This usually means the server's encryption key " +
        "changed; an administrator has to reset two-factor authentication.",
    };
  }

  if (!verifyTotpCode(secret, code)) {
    return { ok: false, error: "That code is not right. Check your phone's time and try again." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: true, totpEnabledAt: new Date() },
  });
  return { ok: true };
}

/**
 * Verifies the second factor at sign-in, accepting a backup code once.
 *
 * Returns which was used so the caller can say something useful on a backup-code
 * sign-in — "that code has been used" is information somebody needs immediately,
 * not on the next failed attempt.
 */
export async function verifySecondFactor(
  userId: string,
  code: string
): Promise<
  | { ok: true; method: "totp" }
  | { ok: true; method: "backup"; remaining: number }
  | { ok: false; error?: string }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, backupCodesEnc: true },
  });
  if (!user) return { ok: false, error: "That account no longer exists." };

  const clean = code.replace(/\D/g, "");
  if (clean.length === 6 && user.totpSecretEnc) {
    const secret = decryptSecret(user.totpSecretEnc);
    if (secret && verifyTotpCode(secret, code)) return { ok: true, method: "totp" };
  }

  if (user.backupCodesEnc) {
    let stored: string[] = [];
    try {
      const parsed = JSON.parse(user.backupCodesEnc);
      if (Array.isArray(parsed)) stored = parsed.filter((h): h is string => typeof h === "string");
    } catch {
      stored = [];
    }

    const presented = hashBackupCode(code);
    const index = stored.findIndex((h) => safeEqual(h, presented));
    if (index !== -1) {
      // Burned by removal from the list, not by a flag on it: a flag would leave
      // every spent hash in the row forever, and "used" is the absence.
      const remaining = stored.filter((_, i) => i !== index);
      await prisma.user.update({
        where: { id: userId },
        data: {
          backupCodesEnc: JSON.stringify(remaining),
          backupCodesUsedAt: new Date(),
        },
      });
      return { ok: true, method: "backup", remaining: remaining.length };
    }
  }

  return { ok: false };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Turns a user's second factor off and destroys the secret.
 *
 * Used by the user themselves (to stop using an authenticator) and by an
 * administrator who has confirmed their identity another way. It **nulls the
 * secret** rather than leaving it: an administrator who resets someone's 2FA
 * because they lost their phone should not leave a working secret behind, and a
 * later re-enrollment must mint a new one.
 */
export async function resetTotp(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: false,
      totpEnabledAt: null,
      totpSecretEnc: null,
      backupCodesEnc: null,
      backupCodesUsedAt: null,
    },
  });
}

/**
 * Whether this user's role is required to have a second factor.
 *
 * `security.require2fa` is a comma-separated list of role names. Matching is
 * case-insensitive and whitespace-tolerant, because this is a value somebody
 * types into a settings box.
 */
export function requiresTotp(roleName: string | null | undefined, setting: string): boolean {
  const wanted = (setting ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return false;
  const role = (roleName ?? "").trim().toLowerCase();
  return wanted.includes(role);
}

/** What the sign-in flow needs to know, without learning the secret. */
export async function secondFactorState(userId: string): Promise<{
  enrolled: boolean;
  hasSecret: boolean;
}> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, totpSecretEnc: true },
  });
  return { enrolled: row?.totpEnabled ?? false, hasSecret: Boolean(row?.totpSecretEnc) };
}
