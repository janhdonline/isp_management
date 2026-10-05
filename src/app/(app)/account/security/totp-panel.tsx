"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  beginTotpAction,
  confirmTotpAction,
  disableOwnTotpAction,
  type TotpActionState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

/**
 * Two-factor setup, reset and status.
 *
 * ## No QR image, deliberately
 *
 * The setup screen shows the `otpauth://` URI and the base32 secret, and every
 * authenticator app has a "enter setup key" path for exactly this. A QR image
 * would need a renderer, and the options were: a dependency that drags in a PNG
 * encoder and a CLI parser, or hand-rolling a QR encoder — and a QR that scans to
 * the *wrong* secret is not a cosmetic bug, it is a second factor that either
 * locks a user out or, worse, one an attacker can read off a shared screen.
 *
 * Hand-rolling it could not be validated here (verifying a QR means decoding it,
 * which means writing the decoder too), so the honest choice was the text form
 * every app accepts.
 *
 * ## The secret is shown once and then never again
 *
 * There is no endpoint that returns it. That is the design: a second factor whose
 * secret an administrator can read out of the database is a second factor an
 * attacker who reads the database can pass.
 */
export function TotpPanel({ enabled, enforced }: { enabled: boolean; enforced: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const [state, formAction, isPending] = useActionState<TotpActionState, FormData>(
    confirmTotpAction,
    {}
  );
  const [disabling, setDisabling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setStarting(true);
    setError(null);
    setStatus(null);
    const res = await beginTotpAction();
    setStarting(false);
    if (res.error || !res.secret) {
      setError(res.error ?? "Could not start setup.");
      return;
    }
    setSetup({ secret: res.secret, uri: res.uri ?? "", backupCodes: res.backupCodes ?? [] });
  }

  async function disable() {
    setDisabling(true);
    const res = await disableOwnTotpAction();
    setDisabling(false);
    if (res.error) setError(res.error);
    else {
      setStatus(res.success ?? null);
      router.refresh();
    }
  }

  if (state.success && enabled) {
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div
        className={
          enabled
            ? "rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"
            : "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
        }
      >
        <p className="text-sm font-medium">
          {enabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {enabled ? (
            <>
              Signing in asks for a six-digit code from your authenticator app after your
              password. There is no way past it — not for an administrator, not with a
              setting, and not on a one-off request.
            </>
          ) : enforced ? (
            <>
              Your role is required to have a second factor. You will be asked to set one up
              the next time you sign in, and you will not reach the dashboard until you have.
            </>
          ) : (
            <>
              Your account is protected by its password alone. A phished password would be
              enough to sign in as you.
            </>
          )}
        </p>
        {status ? <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{status}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p> : null}

        {!setup && !enabled ? (
          <div className="mt-3">
            <Button onClick={begin} loading={starting}>
              {enforced ? "Set up two-factor authentication" : "Enable two-factor authentication"}
            </Button>
          </div>
        ) : null}

        {enabled && !setup ? (
          <div className="mt-3">
            <Button variant="outline" onClick={disable} loading={disabling}>
              Turn off two-factor authentication
            </Button>
          </div>
        ) : null}
      </div>

      {setup ? (
        <div className="space-y-4 rounded-lg border border-[var(--border)] p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">1. Add it to your authenticator</p>
            <p className="text-xs text-fg-muted">
              Google Authenticator, Authy, Aegis, 1Password and Bitwarden all have an
              &ldquo;enter setup key&rdquo; option. Paste the key below.
            </p>
          </div>

          <Field
            label="Setup key"
            hint="Shown once. If you lose it, turn setup off and start again — it cannot be retrieved later."
          >
            <Textarea readOnly rows={2} value={setup.secret} className="font-mono text-xs" />
          </Field>

          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer">Show the otpauth:// URI instead</summary>
            <Textarea readOnly rows={3} value={setup.uri} className="mt-1 font-mono text-[11px]" />
          </details>

          {setup.backupCodes.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">2. Save your backup codes</p>
              <p className="text-xs text-fg-muted">
                Each works <strong>once</strong>. They are the only way back in if you lose
                your phone, so keep them somewhere other than the phone.
              </p>
              <Textarea
                readOnly
                rows={5}
                className="font-mono text-xs"
                value={setup.backupCodes.join("\n")}
              />
            </div>
          ) : null}

          <form action={formAction} className="space-y-2">
            <Field
              label="3. Enter the six-digit code from your app"
              error={state.error ?? undefined}
            >
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="font-mono"
                required
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit" loading={isPending}>
                Confirm and turn on
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSetup(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
