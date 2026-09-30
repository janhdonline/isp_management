import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { gatewayStatus } from "@/lib/services/payment-gateway";
import { formatCurrency, formatDate, formatDateTime, round2 } from "@/lib/utils";
import { PortalShell } from "../../portal-shell";
import { PortalPayOnline } from "./portal-pay-online";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice" };

export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePortalCustomer();
  const { id } = await params;
  const sp = await searchParams;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      billingFrom: true,
      billingTo: true,
      amount: true,
      discount: true,
      vat: true,
      total: true,
      paid: true,
      status: true,
      note: true,
      // The ownership check, in the query. A customer who changes the id in the
      // URL gets notFound rather than somebody else's bill — the id is never
      // looked up first and checked afterwards.
      customerId: true,
      customer: { select: { name: true, customerCode: true } },
      package: { select: { name: true, downloadSpeed: true, uploadSpeed: true } },
      payments: {
        orderBy: { paymentDate: "desc" },
        select: {
          id: true,
          paymentId: true,
          amount: true,
          method: true,
          paymentDate: true,
          receipt: { select: { receiptNumber: true } },
        },
      },
    },
  });

  if (!invoice || invoice.customerId !== session.customerId) notFound();

  const balance = round2(invoice.total - invoice.paid);
  const gw = await gatewayStatus();

  return (
    <PortalShell title={invoice.invoiceNumber} subtitle={`Issued ${formatDate(invoice.issueDate)} · due ${formatDate(invoice.dueDate)}`}>
      {sp.paid === "1" ? (
        <p className="portal-alert portal-alert--ok mb-4">
          Thank you. If your payment has reached us, this invoice will show as paid shortly.
        </p>
      ) : null}
      {sp.cancelled === "1" ? (
        <p className="portal-alert portal-alert--error mb-4">
          The payment was cancelled and nothing has been charged. You can try again whenever you
          are ready.
        </p>
      ) : null}

      <div className="portal-card">
        <p className="portal-card__title">Summary</p>
        <table className="portal-table mt-3">
          <tbody>
            <tr>
              <td>Account</td>
              <td className="text-fg-muted">{invoice.customer.name}</td>
            </tr>
            <tr>
              <td>Customer ID</td>
              <td className="font-mono text-xs">{invoice.customer.customerCode}</td>
            </tr>
            {invoice.package ? (
              <tr>
                <td>Package</td>
                <td className="text-fg-muted">
                  {invoice.package.name} — {invoice.package.downloadSpeed}/{invoice.package.uploadSpeed} Mbps
                </td>
              </tr>
            ) : null}
            <tr>
              <td>Billing period</td>
              <td className="text-fg-muted">
                {invoice.billingFrom && invoice.billingTo
                  ? `${formatDate(invoice.billingFrom)} to ${formatDate(invoice.billingTo)}`
                  : "—"}
              </td>
            </tr>
            <tr>
              <td>Charge</td>
              <td className="num">{formatCurrency(invoice.amount)}</td>
            </tr>
            {invoice.discount > 0 ? (
              <tr>
                <td>Discount</td>
                <td className="num">− {formatCurrency(invoice.discount)}</td>
              </tr>
            ) : null}
            {invoice.vat > 0 ? (
              <tr>
                <td>VAT</td>
                <td className="num">{formatCurrency(invoice.vat)}</td>
              </tr>
            ) : null}
            <tr>
              <td style={{ fontWeight: 600 }}>Total</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {formatCurrency(invoice.total)}
              </td>
            </tr>
            <tr>
              <td>Paid</td>
              <td className="num">{formatCurrency(invoice.paid)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Balance</td>
              <td className="num" style={{ fontWeight: 700, color: balance > 0 ? "#b91c1c" : "#15803d" }}>
                {formatCurrency(balance)}
              </td>
            </tr>
          </tbody>
        </table>
        {invoice.note ? <p className="mt-3 text-xs text-fg-muted">{invoice.note}</p> : null}
      </div>

      {balance > 0 ? (
        <div className="mt-4">
          <PortalPayOnline invoiceId={invoice.id} available={gw.available} />
        </div>
      ) : (
        <div className="portal-card mt-4">
          <p className="portal-card__hint">This invoice is settled. Thank you.</p>
        </div>
      )}

      {invoice.payments.length ? (
        <div className="portal-card mt-4">
          <p className="portal-card__title">Payments received</p>
          <table className="portal-table mt-3">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Method</th>
                <th>Receipt</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-fg-muted">{formatDate(p.paymentDate)}</td>
                  <td className="font-mono text-xs">{p.paymentId}</td>
                  <td>{p.method}</td>
                  <td className="font-mono text-xs">{p.receipt?.receiptNumber ?? "—"}</td>
                  <td className="num">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-5 text-xs text-fg-muted">
        <Link href="/portal/invoices">← Back to all invoices</Link>
        {invoice.payments[0] ? ` · Last payment ${formatDateTime(invoice.payments[0].paymentDate)}` : ""}
      </p>
    </PortalShell>
  );
}