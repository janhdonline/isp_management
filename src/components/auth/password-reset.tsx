"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { checkPasswordStrength } from "@/lib/password";

export type ResetState = { success?: string; formError?: string; errors?: Record<string, string[]> };

/* ------------------------------------------------------------------ */
/* Ask for a link                                                     */
/* ------------------------------------------------------------------ */

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} icon={<KeyRound className="size-4" />}>
      {pending ? "Sending..." : "Send reset link"}
    </Button>
  );
}

export function ForgotPasswordForm({
  action,
}: {
  action: (state: ResetState, formData: FormData) => Promise<ResetState>;
}) {
  const [state, formAction] = useActionState(action, {} as ResetState);

  return (
    <Card className="max-w-md">
      <CardHeader
        title="Forgot your password?"
        description="Enter the email you sign in with and we will send a link to set a new one."
        icon={<KeyRound />}
      />
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          {state.formError ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{state.formError}</p>
            </div>
          ) : null}
          {state.success ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>{state.success}</p>
            </div>
          ) : null}

          <Field label="Email" required error={state.errors?.email?.[0]}>
            <Input name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
          </Field>

          <SendButton />
        </form>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Set the new password                                              */
/* ------------------------------------------------------------------ */

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? "Saving..." : "Set new password"}
    </Button>
  );
}

export function ResetPasswordForm({
  token,
  action,
}: {
  token: string;
  action: (state: ResetState, formData: FormData) => Promise<ResetState>;
}) {
  const [state, formAction] = useActionState(action, {} as ResetState);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Checked here so the user finds out before submitting, and checked again on
  // the server, which is the only check that counts.
  const weakness = password ? checkPasswordStrength(password) : null;
  const mismatch = confirm && confirm !== password ? "The two passwords do not match" : null;

  return (
    <Card className="max-w-md">
      <CardHeader
        title="Set a new password"
        description="Choose something you have not used here before. You will be signed out everywhere."
        icon={<KeyRound />}
      />
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="token" value={token} />

          {state.formError ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{state.formError}</p>
            </div>
          ) : null}

          <Field
            label="New password"
            required
            error={state.errors?.password?.[0] ?? (weakness ?? undefined)}
            hint="At least 8 characters. A short phrase beats a short word with symbols."
          >
            <Input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field label="Confirm password" required error={mismatch ?? undefined}>
            <Input
              name="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <ResetButton />
        </form>
      </CardBody>
    </Card>
  );
}
