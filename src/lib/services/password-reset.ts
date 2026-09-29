import { prisma } from "@/lib/prisma";
import { randomBytes, createHash } from "node:crypto";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";
import { hashPassword } from "@/lib/password";
import { addMinutes } from "@/lib/datetime";

/**
 * Password reset by email link.
 *
 * The constraint that shapes this: a reset token is a temporary key to every
 * account, so it has to be unguessable, single-use, and short-lived. Three
 * things follow, and all three are load-bearing rather than decoration.
 *
 *  - the token stored is a SHA-256 hash, not the token itself, so reading the
 *    database does not hand out the ability to reset anyone's password;
 *  - it is consumed the moment it is used, so a link that leaks after the fact
 *    is worthless;
 *  - the reset also ends every existing session for that user, because a reset
 *    is exactly what someone does when they think a password has leaked.
 */

const RESET_MINUTES = 30;
const MAX_REQUESTS_PER_DAY = 3;

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export type RequestResult = {
  ok: true;
  /** Always the same, whether or not the address is known. */
  message: string;
};

/**
 * Starts a reset. The caller must send the email; this only records that a
 * token exists.
 */
export async function requestPasswordReset(email: string): Promise<RequestResult> {
  const generic =
    "If that address belongs to an account here, a reset link is on its way. It expires in 30 minutes.";

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, status: true },
  });

  // Same answer either way: telling a caller that an address is unknown hands
  // out a list of who has an account here.
  if (!user || user.status !== "Active") {
    return { ok: true, message: generic };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.passwordReset.count({
    where: { userId: user.id, createdAt: { gte: since } },
  });
  if (recent >= MAX_REQUESTS_PER_DAY) {
    return { ok: true, message: generic };
  }

  const raw = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: addMinutes(new Date(), RESET_MINUTES),
    },
  });

  // In production this hands off to the SMTP relay. Until it is wired to a real
  // send, the token is logged so a developer is not locked out of their own
  // system — which is a deliberate, temporary arrangement, not the end state.
  const s = await getSettings();
  if (s["api.emailSmtpUser"] && s["api.emailSmtpPass"]) {
    const { dispatch } = await import("@/lib/services/messaging");
    const host = s["app.url"] ?? "";
    await dispatch(
      "Email",
      user.email,
      "Reset your password",
      `Hello ${user.name},\n\nUse the link below to set a new password. It works once and expires in ${RESET_MINUTES} minutes.\n\n${host}/reset-password?token=${raw}\n\nIf you did not ask for this, no action is needed — your password has not changed.`
    );
  } else {
    console.warn(
      `[auth] password reset requested for ${user.email} but SMTP is not configured. ` +
        `Token: ${raw}`
    );
  }

  return { ok: true, message: generic };
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
 * Completes a reset: sets the new password, burns the token, and ends every
 * session the user holds.
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

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        // Ends every existing session: a reset is what someone does when they
        // think a password has leaked.
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.passwordReset.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);

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
    where: {
      OR: [{ usedAt: { not: null } }, { expiresAt: { lt: cutoff } }],
    },
  });
  return count;
}
