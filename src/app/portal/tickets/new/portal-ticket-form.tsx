"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { portalCreateTicketAction, type PortalState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="portal-btn portal-btn--primary" disabled={pending}>
      {pending ? "Sending..." : "Send request"}
    </button>
  );
}

export function PortalTicketForm() {
  const [state, formAction] = useActionState(portalCreateTicketAction, {} as PortalState);

  return (
    <form action={formAction} className="portal-card" noValidate>
      {state.error ? (
        <p className="portal-alert portal-alert--error mb-4" role="alert">
          {state.error}
        </p>
      ) : null}

      <label className="portal-field">
        <span>What is wrong?</span>
        <input
          name="subject"
          required
          maxLength={160}
          placeholder="No internet since this morning"
        />
        {state.errors?.subject ? (
          <span className="mt-1 block text-xs" style={{ color: "#b91c1c" }}>
            {state.errors.subject[0]}
          </span>
        ) : null}
      </label>

      <label className="portal-field">
        <span>Category</span>
        <select name="category" required defaultValue="Line Problem">
          {[
            "Line Problem",
            "Slow Internet",
            "Frequent Disconnection",
            "Billing Query",
            "Change Request",
            "Other",
          ].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="portal-field">
        <span>Tell us more</span>
        <textarea
          name="description"
          rows={5}
          required
          maxLength={4000}
          placeholder="When it started, what you have already tried, and anything that has changed recently."
        />
        {state.errors?.description ? (
          <span className="mt-1 block text-xs" style={{ color: "#b91c1c" }}>
            {state.errors.description[0]}
          </span>
        ) : null}
      </label>

      <Submit />

      <p className="mt-4 text-xs text-fg-muted">
        We will reply here and by phone. Our engineers&apos; internal notes are not shown.
      </p>
    </form>
  );
}