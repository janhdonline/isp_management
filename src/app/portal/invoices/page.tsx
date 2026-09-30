import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { formatCurrency, formatDate, round2 } from "@/lib/utils";
import { PortalShell } from "../portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your invoices" };

export default async function PortalInvoicesPage() {
  const session = await requirePortalCustomer();

  // Scoped to the session's customer on the server. The id never comes from a
  // query string, so there is nothing for a customer to change.
  const invoices = await prisma.invoice.findMany({
    where: { customerId: session.customerId, status: { not: "Cancelled" } },
    orderBy: { issueDate: "desc" },
    take: 50,
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      total: true,
      paid: true,
      status: true,
    },
  });

  const outstanding = invoices.reduce((s, i) => s + Math.max(0, round2(i.total - i.paid)), 0);

  return (
    <PortalShell
      title="Your invoices"
      subtitle={
        outstanding > 0
          ? `${formatCurrency(outstanding)} outstanding across ${invoices.filter((i) => i.total > i.paid).length} invoice(s).`
          : "Nothing outstanding."
      }
    >
      {invoices.length === 0 ? (
        <div className="portal-card portal-empty">You have no invoices yet.</div>
      ) : (
        <div className="portal-card overflow-x-auto">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="num">Total</th>
                <th className="num">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const balance = round2(inv.total - inv.paid);
                return (
                  <tr key={inv.id}>
                    <td>
                      <Link
                        href={`/portal/invoices/${inv.id}`}
                        style={{ color: "var(--brand-700, #8a6220)", fontWeight: 500 }}
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="text-fg-muted">{formatDate(inv.issueDate)}</td>
                    <td className="text-fg-muted">{formatDate(inv.dueDate)}</td>
                    <td className="num">{formatCurrency(inv.total)}</td>
                    <td className="num" style={balance > 0 ? { fontWeight: 600 } : undefined}>
                      {formatCurrency(balance)}
                    </td>
                    <td>
                      <span
                        className={`portal-badge ${
                          inv.status === "Paid"
                            ? "portal-badge--ok"
                            : inv.status === "Overdue"
                              ? "portal-badge--bad"
                              : "portal-badge--warn"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}