import type { Metadata } from "next";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { PortalShell } from "../portal-shell";
import { PortalPasswordForm } from "./portal-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Change your password" };

export default async function PortalPasswordPage() {
  await requirePortalCustomer();

  return (
    <PortalShell
      title="Change your password"
      subtitle="This is the password for this portal, not for your connection."
    >
      <div className="max-w-md">
        <PortalPasswordForm />
      </div>
    </PortalShell>
  );
}