import Link from "next/link";
import { getPortalSession } from "@/lib/portal-auth";
import { PortalNav } from "./portal-nav";

/**
 * The signed-in shell.
 *
 * A server component, so the session check happens on the server and the cookie
 * never reaches the client. Every portal page calls `requirePortalCustomer()`
 * itself before it does anything with an id from the URL; this header is
 * presentation, not the guard.
 */
export async function PortalShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Optional, because a page may have nothing left to show once its row is gone. */
  children?: React.ReactNode;
}) {
  const session = await getPortalSession();

  const customer = session
    ? await (await import("@/lib/prisma")).prisma.customer.findUnique({
        where: { id: session.customerId },
        select: { name: true },
      })
    : null;

  return (
    <>
      <header className="portal-header">
        <div className="portal-header__inner">
          <Link href="/portal" className="portal-brand">
            <span className="portal-brand__mark" aria-hidden>
              N
            </span>
            <span>Customer Portal</span>
          </Link>
          {session ? (
            <>
              <nav className="portal-nav" aria-label="Portal">
                <Link href="/portal">Overview</Link>
                <Link href="/portal/invoices">Invoices</Link>
                <Link href="/portal/tickets">Support</Link>
                <Link href="/portal/password">Password</Link>
              </nav>
              <span className="text-xs text-fg-muted">{customer?.name}</span>
            </>
          ) : null}
          {session ? <PortalNav /> : null}
        </div>
      </header>

      <main className="portal-shell">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
        <div className="mt-5">{children}</div>
      </main>
    </>
  );
}
