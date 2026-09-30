"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { portalAddCommentAction, type PortalState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="portal-btn portal-btn--primary" disabled={pending}>
      {pending ? "Sending..." : "Send"}
    </button>
  );
}

export function PortalCommentForm({ ticketId }: { ticketId: string }) {
  const [state, formAction] = useActionState(portalAddCommentAction, {} as PortalState);

  return (
    <form action={formAction} className="portal-card mt-4" noValidate>
      {state.error ? (
        <p className="portal-alert portal-alert--error mb-3" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="portal-alert portal-alert--ok mb-3" role="status">
          {state.success}
        </p>
      ) : null}

      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="portal-field">
        <span>Add a message</span>
        <textarea name="body" rows={3} required maxLength={4000} placeholder="Anything else we should know?" />
      </label>
      <Submit />
    </form>
  );
}