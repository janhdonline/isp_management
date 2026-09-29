"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { loginWithPassword, clearSessionCookie } from "@/lib/auth";
import { loginSchema, fieldErrors, type FieldErrors } from "@/lib/validators";

/**
 * The address the request came from. Behind a proxy this is the
 * `x-forwarded-for` entry the proxy added, not something the client can set
 * itself — taking the leftmost value would let a caller rotate apparent
 * addresses and walk straight past the per-address limit.
 */
async function clientIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1];
    return parts[0] ?? "unknown";
  }
  return h.get("x-real-ip") ?? "unknown";
}

export type LoginState = {
  errors?: FieldErrors;
  formError?: string;
  values?: { email: string };
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = Object.fromEntries(formData);
  const parsed = loginSchema.safeParse({ email: raw.email, password: raw.password });

  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), values: { email: String(raw.email ?? "") } };
  }

  const ip = await clientIp();
  const result = await loginWithPassword(parsed.data.email, parsed.data.password, ip);

  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
      return {
        formError: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        values: { email: parsed.data.email },
      };
    }
    return {
      formError: "Invalid email or password, or the account is inactive.",
      values: { email: parsed.data.email },
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
