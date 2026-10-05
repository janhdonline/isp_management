"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requestPasswordReset,
  completePasswordReset,
  peekResetToken,
} from "@/lib/services/password-reset";
import { checkPasswordStrength } from "@/lib/password";

export type ResetState = { success?: string; formError?: string; errors?: Record<string, string[]> };

const requestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

/**
 * Starts a reset.
 *
 * The email is sent **after** this returns, and that ordering is a security
 * property rather than a latency one: awaiting SMTP here would make the response
 * for a known address measurably slower than for an unknown one, and the caller can
 * time that. So `requestPasswordReset` hands back the message plus a not-yet-started
 * send, and the message goes back to the browser first.
 *
 * The failures are logged rather than surfaced — there is nobody left to tell, and
 * the token simply expires unused.
 */
export async function requestResetAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
      formError: "Please check the email address.",
    };
  }

  try {
    const result = await requestPasswordReset(parsed.data.email, {
      clientIp: await clientIp(),
    });
    if (result.send) {
      // Not awaited, and its rejection handled: this runs past the response.
      void result.send().catch((e) => {
        console.error("[auth] reset email failed:", e instanceof Error ? e.message : e);
      });
    }
    return { success: result.message };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not start the reset" };
  }
}

/** The address the request came from, for the per-IP half of the rate limit. */
async function clientIp(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    // Rightmost, as in the login route: the leftmost is client-supplied and would
    // let a caller rotate apparent addresses past the limit.
    if (parts.length > 1) return parts[parts.length - 1];
    return parts[0] ?? "unknown";
  }
  return h.get("x-real-ip") ?? "unknown";
}

const resetSchema = z
  .object({
    token: z.string().min(10, "This link is not valid"),
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string().min(1, "Confirm the password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

export async function completeResetAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
      formError: "Please fix the highlighted fields.",
    };
  }

  // The strength rule is re-checked here because the client-side check is a
  // convenience, not a control.
  const weakness = checkPasswordStrength(parsed.data.password);
  if (weakness) {
    return { errors: { password: [weakness] }, formError: "Please choose a stronger password." };
  }

  try {
    await completePasswordReset(parsed.data.token, parsed.data.password);
    revalidatePath("/", "layout");
    // Straight to the login page with a note, so the person knows it worked rather
    // than wondering why they have been bounced here.
    redirect("/login?reset=1");
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return { formError: e instanceof Error ? e.message : "Could not reset the password" };
  }
}

/** Loads the account a token belongs to, so the page can greet them. */
export async function loadResetContext(token: string) {
  return peekResetToken(token);
}
