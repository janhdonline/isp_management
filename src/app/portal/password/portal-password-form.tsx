"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { portalChangePasswordAction, type PortalState } from "../actions";
import { checkPasswordStrength } from "@/lib/password";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="portal-btn portal-btn--primary" disabled={pending}>
      {pending ? "Saving..." : "Change password"}
    </button>
  );
}

export function PortalPasswordForm() {
  const [state, formAction] = useActionState(portalChangePasswordAction, {} as PortalState);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  // Checked here so the customer finds out before submitting. The server checks
  // again, because this one is a convenience and not a control.
  const weakness = next ? checkPasswordStrength(next) : null;
  const mismatch = confirm && confirm !== next ? "The two passwords do not match" : null;

  return (
    <form action={formAction} className="portal-card" noValidate>
      {state.error ? (
        <p className="portal-alert portal-alert--error mb-4" role="alert">
          {state.error}
        </p>
      ) : null}

      <label className="portal-field">
        <span>Current password</span>
        <input name="current" type="password" autoComplete="current-password" required />
      </label>

      <label className="portal-field">
        <span>New password</span>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={8}
        />
        {weakness ? (
          <span className="mt-1 block text-xs" style={{ color: "#b45309" }}>
            {weakness}
          </span>
        ) : (
          <span className="mt-1 block text-xs text-fg-subtle">
            At least 8 characters. A short phrase beats a short word with symbols.
          </span>
        )}
      </label>

      <label className="portal-field">
        <span>Confirm new password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {mismatch ? (
          <span className="mt-1 block text-xs" style={{ color: "#b91c1c" }}>
            {mismatch}
          </span>
        ) : null}
      </label>

      <Submit />

      <p className="mt-4 text-xs text-fg-muted">
        Changing your password signs you out everywhere. This is not your PPPoE password — the
        line keeps working either way.
      </p>
    </form>
  );
}