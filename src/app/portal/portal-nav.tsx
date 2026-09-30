"use client";

import { useFormStatus } from "react-dom";
import { logoutPortalAction } from "./actions";

/** The logout form. A form rather than a link, because logging out changes state. */
function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <form action={logoutPortalAction}>
      <button type="submit" className="portal-btn portal-btn--ghost" disabled={pending}>
        {pending ? "Signing out..." : "Sign out"}
      </button>
    </form>
  );
}

export function PortalNav() {
  return <LogoutButton />;
}
