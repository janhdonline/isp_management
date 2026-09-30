"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { portalLoginAction, type PortalState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="portal-btn portal-btn--primary w-full" disabled={pending}>
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

export function PortalLoginForm({ changed }: { changed: boolean }) {
  const [state, formAction] = useActionState(portalLoginAction, {} as PortalState);

  return (
    <form action={formAction} className="portal-card" noValidate>
      {changed ? (
        <p className="portal-alert portal-alert--ok mb-4">
          Your password was changed. Please sign in with the new one.
        </p>
      ) : null}

      {state.error ? (
        <p className="portal-alert portal-alert--error mb-4" role="alert">
          {state.error}
        </p>
      ) : null}

      <label className="portal-field">
        <span>Username</span>
        <input name="username" autoComplete="username" required autoFocus />
      </label>

      <label className="portal-field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

      <Submit />

      <p className="mt-4 text-xs text-fg-muted">
        This is the portal for your internet account. Your PPPoE password is not the same thing —
        if you do not have a portal password yet, please ask your provider to set one up.
      </p>
    </form>
  );
}
