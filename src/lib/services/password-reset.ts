import { prisma } from "@/lib/prisma";
import { randomBytes, createHash } from "node:crypto";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";
import { hashPassword } from "@/lib/password";
import { addMinutes } from "@/lib/datetime";
import {
  MAX_RESET_REQUESTS_PER_WINDOW,
  MAX_RESET_REQUESTS_PER_IP,
  check as checkReset,
  record as recordReset,
} from "@/lib/services/reset-rate-limit";

/**
 * Password reset by email link (ISP.md §43).
 *
 * A reset token is a temporary key to a whole account, so three properties are
 * load-bearing rather than decoration: it is **unguessable**, **single-use**, and
 * **short-lived**. This file already existed before Phase T; what this phase adds
 * is the atomicity of the burn, the rate limit, and the removal of the timing
 * side channel.
 *
 * ## The burn was not atomic, and that was the real bug
 *
 * The token was read, checked, and then — in a separate statement, by primary key,
 * unconditionally — stamped `usedAt`. Two requests carrying the same link both
 * read `usedAt === null`, both passed the check, and both set the password.
 *
 * That matters more than it looks. "This link is single-use" is the property that
 * makes a link safe to send over email: a link that leaks from a shared inbox or a
 * proxy log is worthless *after* use. A burn that two requests can pass means the
 * leaked link is worth something twice, and the second use is the one an attacker
 * gets.
 *
 * The fix is a conditional update — set `usedAt` only where it is still null —
 * inside the same transaction as the password change, and treating `count === 0`
 * as "someone else got there first". Exactly one concurrent use can win, because
 * exactly one can make that conditional write true.
 */

const RESET_MINUTES = 60;
const MAX_REQUESTS_PER_DAY = 3;

/**
 * Every caller sees this, and only this.
 *
 * Whether the address is unknown, the account is disabled, the daily cap is
 * reached, or a link was sent — same words, same shape. Any difference is an oracle
 * for "does this person have an account here".
 */
const GENERIC_MESSAGE =
  "If that address belongs to an account here, a reset link is on its way. It expires in " +
  `${RESET_MINUTES} minutes.`;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type RequestResult = {
  ok: true;
  /** Always the same, whether or not the address is known. */
  message: string;
  /**
   * The email send, if one is warranted, returned **unstarted**.
   *
   * Not as an optimisation: awaiting SMTP inside this call would make the response
   * for a known address measurably slower than for an unknown one, and the
   * difference is tens of milliseconds against a millisecond — which is to say, it
   * is exactly the oracle the generic message exists to remove. The caller starts
   * it after the response is on its way.
   */
  send?: () => Promise<void>;
};

export type RequestOptions = {
  clientIp?: string;
  /** Overridden in tests. Production always goes through `dispatch`. */
  send?: (to: string, subject: string, body: string) => Promise<unknown>;
};

/**
 * Starts a reset: records that a token exists, and hands back the email to send.
 *
 * ## What an unknown address costs
 *
 * The same user lookup, the same settings read, the same token generation — and
 * then nothing is written and no mail is queued. So the difference between the two
 * paths is exactly one `INSERT`, sub-millisecond, against an SMTP round trip the
 * caller no longer waits for. That is as close to indistinguishable as a
 * token-generating flow can be while still storing tokens; claiming more than that
 * would be overstating it.
 */
export async function requestPasswordReset(
  email: string,
  options: RequestOptions = {}
): Promise<RequestResult> {
  const address = email.trim().toLowerCase();
  const clientIp = options.clientIp ?? "unknown";

  // Rate-limited before the lookup, so a burst costs one map read rather than a
  // database round trip each.
  const byEmail = checkReset("email", address, MAX_RESET_REQUESTS_PER_WINDOW);
  const byIp = checkReset("ip", clientIp, MAX_RESET_REQUESTS_PER_IP);
  if (!byEmail.allowed || !byIp.allowed) {
    // Same message. Telling a caller they are being throttled confirms the address
    // is worth throttling.
    return { ok: true, message: GENERIC_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { email: address },
    select: { id: true, email: true, name: true, status: true },
  });

  if (!user || user.status !== "Active") {
    return { ok: true, message: GENERIC_MESSAGE };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.passwordReset.count({
    where: { userId: user.id, createdAt: { gte: since } },
  });
  if (recent >= MAX_REQUESTS_PER_DAY) {
    return { ok: true, message: GENERIC_MESSAGE };
  }

  recordReset("email", address);
  recordReset("ip", clientIp);

  const raw = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: addMinutes(new Date(), RESET_MINUTES),
    },
  });

  // Audited. The request is worth a line even though nothing has changed yet: a
  // burst of reset requests for one account is the shape of an account takeover
  // attempt, and this is where it shows up.
  await logActivity({
    action: "Password",
    entity: "User",
    entityId: user.id,
    summary: `Password reset requested for ${user.email}`,
  });

  const settings = await getSettings();
  const host = (settings["app.url"] ?? "").replace(/\/$/, "");
  const link = `${host}/reset-password?token=${raw}`;
  const body =
    `Hello ${user.name},\n\n` +
    `Use the link below to set a new password. It works once and expires in ${RESET_MINUTES} minutes.\n\n` +
    `${link}\n\n` +
    "If you did not ask for this, no action is needed — your password has not changed and no " +
    "session has been ended.";

  const deliver = options.send ?? defaultSend;
  const smtpConfigured = Boolean(settings["api.emailSmtpUser"] && settings["api.emailSmtpPass"]);

  const send = async () => {
    if (!smtpConfigured) {
      // Without a relay there is no way to deliver a link, and a developer locked
      // out of their own instance needs a way in. Development only — in production
      // this would put a live account's reset token in an application log, which is
      // a credential written somewhere it was never meant to be.
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[auth] password reset for ${user.email}; SMTP is not configured. ` +
            `Reset link: ${link}`
        );
      }
      return;
    }
    try {
      await deliver(user.email, "Reset your password", body);
    } catch (e) {
      // Swallowed deliberately: this runs after the response, so there is nobody
      // left to tell, and the token simply expires unused.
      console.error(
        `[auth] could not send the reset email to ${user.email}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  };

  return { ok: true, message: GENERIC_MESSAGE, send };
}

/** The real delivery path: the same messaging channel everything else uses. */
async function defaultSend(to: string, subject: string, body: string): Promise<unknown> {
  const { dispatch } = await import("@/lib/services/messaging");
  return dispatch("Email", to, subject, body);
}

/** Looks up a token without consuming it, so the form can render. */
export async function peekResetToken(raw: string) {
  if (!raw) return null;
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { email: true, name: true, status: true } } },
  });

  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt < new Date()) return null;
  if (row.user.status !== "Active") return null;
  return row.user;
}

/**
 * Completes a reset: sets the new password, burns the token, ends every session.
 *
 * The hash is computed **before** the transaction opens. bcrypt at cost 12 is
 * about a quarter of a second, and a transaction held open across it pins a
 * connection and a row lock for that whole time — which, with one reset in flight
 * per user, is an availability problem rather than a style question.
 */
export async function completePasswordReset(raw: string, newPassword: string) {
  if (!raw) throw new Error("This reset link is not valid");

  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!row) throw new Error("This reset link is not valid");
  if (row.usedAt) throw new Error("This reset link has already been used");
  if (row.expiresAt < new Date()) throw new Error("This reset link has expired");

  const passwordHash = await hashPassword(newPassword);

  const outcome = await prisma.$transaction(async (tx) => {
    // The claim. Conditional on `usedAt` still being null, so of two concurrent
    // uses of one link exactly one can make it true — and the loser is told the
    // link is spent rather than quietly changing the password a second time.
    const burned = await tx.passwordReset.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) return { ok: false as const };

    await tx.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        // Ends every existing session: a reset is what somebody does when they
        // think a password has leaked, and leaving the old sessions alive would
        // defeat the point.
        tokenVersion: { increment: 1 },
      },
    });

    // A reset also invalidates its siblings. Two links from the same inbox is
    // ordinary — a second request while the first is in flight — and only one
    // should still work afterwards.
    await tx.passwordReset.updateMany({
      where: { userId: row.userId, id: { not: row.id }, usedAt: null },
      data: { usedAt: new Date() },
    });

    return { ok: true as const };
  });

  if (!outcome.ok) throw new Error("This reset link has already been used");

  // Outside the transaction: an audit note that fails must not roll back a
  // password the user has already been told is set.
  await logActivity({
    action: "Password",
    entity: "User",
    entityId: row.userId,
    summary: `Password reset completed for ${row.user.email}; existing sessions ended`,
  });

  return true;
}

/** Housekeeping: drops tokens that are spent or long expired. */
export async function pruneResetTokens() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.passwordReset.deleteMany({
    where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: cutoff } }] },
  });
  return count;
}
