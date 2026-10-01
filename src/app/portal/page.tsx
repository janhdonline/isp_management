import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { syncCustomerBilling } from "@/lib/services/billing";
import { customerCycleUsage } from "@/lib/services/fup";
import { walletHistory } from "@/lib/services/wallet";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PortalShell } from "./portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

export default async function PortalOverviewPage() {
  const session = await requirePortalCustomer();

  const customer = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: {
      id: true,
      name: true,
      customerCode: true,
      username: true,
      connectionStatus: true,
      onlineStatus: true,
      billingStatus: true,
      monthlyBill: true,
      expiryDate: true,
      fupThrottled: true,
      fupThrottledAt: true,
      previousDue: true,
      advancePayment: true,
      package: {
        select: {
          name: true,
          downloadSpeed: true,
          uploadSpeed: true,
          fupLimit: true,
          mikrotikProfile: true,
        },
      },
    },
  });
  if (!customer) return <PortalShell title="Account unavailable" />;

  // The same recompute the staff screen uses, so the amount a customer sees is
  // the amount they are actually billed — not a second formula that drifts.
  const billing = await syncCustomerBilling(customer.id);
  const usage = await customerCycleUsage(customer.id);
  // Read-only: the customer can see what they have paid in advance and where it
  // went, but the only way the balance moves is from the office.
  const wallet = await walletHistory(customer.id, { take: 10 });

  const due = billing.due;
  const overdue = billing.billingStatus === "Overdue";

  return (
    <PortalShell title="Your account" subtitle={`${customer.package?.name ?? "No package"} · ${customer.username}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="portal-metric">
          <p className="portal-metric__label">Total due</p>
          <p
            className="portal-metric__value tnum"
            style={overdue ? { color: "#b91c1c" } : undefined}
          >
            {formatCurrency(due)}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {due <= 0 ? "Nothing outstanding" : billing.billingStatus}
          </p>
        </div>

        <div className="portal-metric">
          <p className="portal-metric__label">Monthly bill</p>
          <p className="portal-metric__value tnum">{formatCurrency(customer.monthlyBill)}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {customer.package ? `${customer.package.downloadSpeed} Mbps down / ${customer.package.uploadSpeed} Mbps up` : "No package"}
          </p>
        </div>

        <div className="portal-metric">
          <p className="portal-metric__label">Valid until</p>
          <p className="portal-metric__value">
            {customer.expiryDate ? formatDate(customer.expiryDate) : "—"}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            <span
              className={`portal-badge ${customer.connectionStatus === "Active" ? "portal-badge--ok" : "portal-badge--bad"}`}
            >
              {customer.connectionStatus}
            </span>
          </p>
        </div>
      </div>

      <section className="portal-card mt-4">
        <p className="portal-card__title">Wallet</p>
        <p className="portal-card__hint">
          Money you have paid in advance. It is applied to your bill automatically when the
          next one is raised.
        </p>
        <p className="portal-metric__value tnum mt-2">{formatCurrency(customer.advancePayment ?? 0)}</p>

        {wallet.length > 0 ? (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-fg-subtle">
                <th className="py-1">Date</th>
                <th className="py-1">Details</th>
                <th className="py-1 text-right">Amount</th>
                <th className="py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {wallet.map((w) => (
                <tr key={w.id} className="border-t border-[var(--border)]">
                  <td className="whitespace-nowrap py-1.5 text-fg-muted">
                    {formatDate(w.createdAt)}
                  </td>
                  <td className="py-1.5">
                    <span className="capitalize">
                      {w.type === "InvoiceConsume"
                        ? "Applied to a bill"
                        : w.type === "TopUp"
                          ? "Top-up"
                          : w.type === "RefundOut"
                            ? "Refund"
                            : "Adjustment"}
                    </span>
                    {w.reference ? (
                      <span className="ml-1 text-fg-subtle">({w.reference})</span>
                    ) : null}
                  </td>
                  <td
                    className={`tnum py-1.5 text-right font-medium ${
                      w.amount >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {w.amount >= 0 ? "+" : ""}
                    {formatCurrency(w.amount)}
                  </td>
                  <td className="tnum py-1.5 text-right">{formatCurrency(w.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-xs text-fg-subtle">No wallet activity yet.</p>
        )}
      </section>

      {customer.fupThrottled ? (
        <div className="portal-card mt-4" style={{ borderColor: "var(--gold-400, #c99b3f)" }}>
          <p className="portal-card__title">Your speed is currently reduced</p>
          <p className="portal-card__hint">
            You have used the data included with your package this cycle, so your speed has been
            reduced until your next billing cycle begins
            {customer.fupThrottledAt
              ? ` (since ${formatDate(customer.fupThrottledAt)})`
              : ""}
            . Please see the invoices page for the current figures.
          </p>
        </div>
      ) : null}

      {usage.limitGb !== null && usage.limitGb > 0 ? (
        <div className="portal-card mt-4">
          <p className="portal-card__title">Data this cycle</p>
          <p className="portal-card__hint">
            {usage.gb >= 10 ? Math.round(usage.gb) : Math.round(usage.gb * 10) / 10} of{" "}
            {usage.limitGb >= 10 ? Math.round(usage.limitGb) : Math.round(usage.limitGb * 10) / 10} GB
            used
            {usage.percent !== null ? ` (${Math.round(usage.percent)}%)` : ""}.
          </p>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--surface-3, #f1f5f9)" }}
            role="progressbar"
            aria-valuenow={Math.min(100, Math.round(usage.percent ?? 0))}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, usage.percent ?? 0)}%`,
                background: usage.exceeded ? "#dc2626" : "var(--brand-600, #ab7e2c)",
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="portal-card mt-4">
        <p className="portal-card__title">Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/portal/invoices" className="portal-btn portal-btn--ghost">
            See my invoices
          </Link>
          <Link href="/portal/tickets" className="portal-btn portal-btn--ghost">
            Raise a support request
          </Link>
          <Link href="/portal/password" className="portal-btn portal-btn--ghost">
            Change my password
          </Link>
        </div>
      </div>
    </PortalShell>
  );
}