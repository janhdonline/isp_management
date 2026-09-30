"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { portalPayOnlineFormAction, type PortalState } from "../../actions";

function PayButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="portal-btn portal-btn--primary" disabled={pending}>
      {pending ? "Opening payment..." : "Pay online"}
    </button>
  );
}

export function PortalPayOnline({
  invoiceId,
  available,
}: {
  invoiceId: string;
  available: boolean;
}) {
  const [state, formAction] = useActionState(portalPayOnlineFormAction, {} as PortalState);
  const router = useRouter();

  // The gateway redirects away on success, so this effect is only here for the
  // case where the browser was already back at the invoice (a back button, a
  // restored tab) and the payment landed in the meantime.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "1") router.refresh();
  }, [router]);

  if (!available) {
    return (
      <div className="portal-card">
        <p className="portal-card__hint">
          Online payment is not available for now. Please contact your provider to pay this
          invoice.
        </p>
      </div>
    );
  }

  return (
    <div className="portal-card">
      {state.error ? (
        <p className="portal-alert portal-alert--error mb-3" role="alert">
          {state.error}
        </p>
      ) : null}
      <p className="portal-card__hint mb-3">
        You will be taken to our payment provider to pay with bKash, Nagad, Rocket or a card. The
        invoice is only marked paid once your provider confirms the payment.
      </p>
      <form action={formAction}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <PayButton />
      </form>
    </div>
  );
}