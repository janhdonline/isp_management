"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loginWithPassword, clearSessionCookie } from "@/lib/auth";
import { loginSchema, fieldErrors, type FieldErrors } from "@/lib/validators";

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

  const session = await loginWithPassword(parsed.data.email, parsed.data.password);
  if (!session) {
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
