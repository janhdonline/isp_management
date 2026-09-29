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
 * Starts a reset. The message is the same whether or not the address is
 * known — that is the point, and it is why the form cannot be used to discover
 * who has an account.
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
    const result = await requestPasswordReset(parsed.data.email);
    return { success: result.message };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not start the reset" };
  }
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
    // Straight to the login page with a note, so the person knows it worked
    // rather than wondering why they have been bounced here.
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
