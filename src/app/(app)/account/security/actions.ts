"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  resetTotp,
} from "@/lib/services/totp";

export type TotpActionState = {
  success?: string;
  error?: string;
  /** Returned once, at enrollment, and never again. */
  secret?: string;
  uri?: string;
  backupCodes?: string[];
  enabled?: boolean;
};

/**
 * Starts enrollment for the signed-in user.
 *
 * The secret and the backup codes go back in this one response and are never
 * retrievable again. That is the design, not a limitation of it: a second factor
 * whose secret an administrator can read out of the database is a second factor an
 * attacker who reads the database can pass.
 */
export async function beginTotpAction(): Promise<TotpActionState> {
  try {
    const session = await requireSession();
    const result = await beginTotpEnrollment(session.id, session.email);
    if (!result.ok) return { error: result.error };

    await logActivity({
      action: "Update",
      entity: "User",
      entityId: session.id,
      summary: `${session.name} started two-factor setup — awaiting confirmation`,
    });

    return {
      secret: result.setup.secret,
      uri: result.setup.uri,
      backupCodes: result.backupCodes,
      enabled: false,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start setup." };
  }
}

/** Confirms enrollment with a live code from the authenticator app. */
export async function confirmTotpAction(
  _prev: TotpActionState,
  formData: FormData
): Promise<TotpActionState> {
  try {
    const session = await requireSession();
    const code = String(formData.get("code") ?? "");
    const result = await confirmTotpEnrollment(session.id, code);
    if (!result.ok) return { error: result.error };

    await logActivity({
      action: "Update",
      entity: "User",
      entityId: session.id,
      summary: `${session.name} turned on two-factor authentication`,
    });
    revalidatePath("/account/security");
    return { success: "Two-factor authentication is on for your account.", enabled: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not confirm setup." };
  }
}

/**
 * Turns the signed-in user's own second factor off.
 *
 * Separate from the administrative reset on purpose: this one needs no permission
 * beyond holding a session, because it is the person giving up their own
 * protection — and it is still audit-logged, because "when did this account lose
 * its second factor" is the first question asked after an incident.
 */
export async function disableOwnTotpAction(): Promise<TotpActionState> {
  try {
    const session = await requireSession();
    await resetTotp(session.id);
    await logActivity({
      action: "Update",
      entity: "User",
      entityId: session.id,
      summary: `${session.name} turned off their own two-factor authentication`,
    });
    revalidatePath("/account/security");
    return { success: "Two-factor authentication is off for your account.", enabled: false };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not turn it off." };
  }
}

/**
 * An administrator turning off somebody else's second factor.
 *
 * `users.edit`, audit-logged against the target, and it **destroys the secret**
 * rather than disabling it: a reset because they lost their phone must not leave a
 * working secret behind for whoever reads the row next.
 */
export async function resetUserTotpAction(userId: string): Promise<TotpActionState> {
  try {
    await requirePermission("users.edit");
    const target = await (await import("@/lib/prisma")).prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, totpEnabled: true },
    });
    if (!target) return { error: "That user no longer exists." };

    await resetTotp(userId);
    await logActivity(
      {
        action: "Update",
        entity: "User",
        entityId: userId,
        summary: `Two-factor authentication reset for ${target.name} (${target.email}) — secret destroyed${
          target.totpEnabled ? "" : " (was not enabled)"
        }`,
      },
      undefined
    );
    revalidatePath("/settings/users");
    revalidatePath("/account/security");
    return {
      success: `Two-factor authentication reset for ${target.name}. They will be asked to set it up again next time they sign in.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reset it." };
  }
}
