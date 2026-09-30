import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { formatDateTime } from "@/lib/utils";
import { PortalShell } from "../../portal-shell";
import { PortalCommentForm } from "./portal-comment-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support request" };

export default async function PortalTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePortalCustomer();
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      category: true,
      problem: true,
      description: true,
      status: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
      customerId: true,
      technician: { select: { name: true } },
      // `isInternal: false` in the query, not filtered afterwards: an internal
      // note must not reach the customer's page even for one render.
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, authorName: true, body: true, createdAt: true },
      },
    },
  });

  if (!ticket || ticket.customerId !== session.customerId) notFound();

  const isOpen = ["Open", "Pending", "In Progress"].includes(ticket.status);

  return (
    <PortalShell title={ticket.subject} subtitle={ticket.ticketNumber}>
      <div className="portal-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`portal-badge ${isOpen ? "portal-badge--warn" : "portal-badge--ok"}`}
          >
            {ticket.status}
          </span>
          <span className="text-xs text-fg-muted">Raised {formatDateTime(ticket.createdAt)}</span>
        </div>

        <table className="portal-table mt-4">
          <tbody>
            {ticket.category ? (
              <tr>
                <td>Category</td>
                <td className="text-fg-muted">{ticket.category}</td>
              </tr>
            ) : null}
            {ticket.technician ? (
              <tr>
                <td>Assigned to</td>
                <td className="text-fg-muted">{ticket.technician.name}</td>
              </tr>
            ) : null}
            <tr>
              <td>Resolved</td>
              <td className="text-fg-muted">
                {ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "Not yet"}
              </td>
            </tr>
          </tbody>
        </table>

        {ticket.description ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              What you told us
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{ticket.description}</p>
          </div>
        ) : null}
      </div>

      <div className="portal-card mt-4">
        <p className="portal-card__title">Conversation</p>
        {ticket.comments.length === 0 ? (
          <p className="portal-card__hint mt-2">
            Nothing yet. We will post here as soon as an engineer picks this up.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {ticket.comments.map((c) => (
              <li key={c.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
                <p className="text-xs text-fg-subtle">
                  <span className="font-medium" style={{ color: "var(--fg, #0f172a)" }}>
                    {c.authorName}
                  </span>{" "}
                  · {formatDateTime(c.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PortalCommentForm ticketId={ticket.id} />

      <p className="mt-5 text-xs text-fg-muted">
        <Link href="/portal/tickets">← Back to your requests</Link>
      </p>
    </PortalShell>
  );
}