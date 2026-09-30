import type { Metadata } from "next";
import "./portal.css";

export const metadata: Metadata = {
  title: "Customer Portal",
  description: "Your account, your invoices, your support requests.",
  // A customer-facing page must not be indexed, and it must not inherit the
  // staff app's robots policy by accident.
  robots: { index: false, follow: false },
};

/**
 * The portal's own shell.
 *
 * Deliberately not the staff layout: no sidebar, no module navigation, no
 * metrics. A customer signing in to see what they owe is not an operator, and
 * showing them the shape of the billing system is both confusing and a poor
 * default when screens get wider than expected.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-root">{children}</div>;
}
