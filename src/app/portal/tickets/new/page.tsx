import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { PortalShell } from "../../portal-shell";
import { PortalTicketForm } from "./portal-ticket-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Raise a request" };

export default async function PortalNewTicketPage() {
  await requirePortalCustomer();

  return (
    <PortalShell
      title="Raise a request"
      subtitle="Tell us what is wrong and we will get back to you."
    >
      <PortalTicketForm />
      <p className="mt-5 text-xs text-fg-muted">
        <Link href="/portal/tickets">← Back to your requests</Link>
      </p>
    </PortalShell>
  );
}