import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { formatDateTime } from "@/lib/utils";
import { PortalShell } from "../portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your support requests" };

const open = ["Open", "Pending", "In Progress"];
const closed = ["Resolved", "Closed"];

export default async function PortalTicketsPage() {
  const session = await requirePortalCustomer();

  const tickets = await prisma.ticket.findMany({
    where: { customerId: session.customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      category: true,
      status: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return (
    <PortalShell
      title="Your support requests"
      subtitle="Track what you have reported and what we have done about it."
    >
      <div className="mb-4">
        <Link href="/portal/tickets/new" className="portal-btn portal-btn--primary">
          Raise a request
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="portal-card portal-empty">
          You have not raised any requests. If something is wrong with your connection, this is
          the fastest way to tell us.
        </div>
      ) : (
        <div className="portal-card overflow-x-auto">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Subject</th>
                <th>Raised</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono text-xs">{t.ticketNumber}</td>
                  <td>
                    <Link
                      href={`/portal/tickets/${t.id}`}
                      style={{ color: "var(--brand-700, #8a6220)", fontWeight: 500 }}
                    >
                      {t.subject}
                    </Link>
                    {t.category ? (
                      <p className="text-xs text-fg-subtle">{t.category}</p>
                    ) : null}
                  </td>
                  <td className="text-fg-muted">{formatDateTime(t.createdAt)}</td>
                  <td>
                    <span
                      className={`portal-badge ${
                        open.includes(t.status) ? "portal-badge--warn" : "portal-badge--ok"
                      }`}
                    >
                      {t.status}
                    </span>
                    {t.resolvedAt && closed.includes(t.status) ? (
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        resolved {formatDateTime(t.resolvedAt)}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}