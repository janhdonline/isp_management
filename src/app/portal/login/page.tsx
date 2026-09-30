import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { PortalLoginForm } from "./portal-login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Someone already signed in has no business on the login page.
  if (await getPortalSession()) redirect("/portal");

  const sp = await searchParams;

  return (
    <>
      <header className="portal-header">
        <div className="portal-header__inner">
          <span className="portal-brand">
            <span className="portal-brand__mark" aria-hidden>
              N
            </span>
            <span>Customer Portal</span>
          </span>
        </div>
      </header>

      <main className="portal-shell" style={{ maxWidth: "26rem" }}>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Check what you owe, pay online, or raise a support request.
        </p>
        <div className="mt-5">
          <PortalLoginForm changed={sp.changed === "1"} />
        </div>
      </main>
    </>
  );
}
