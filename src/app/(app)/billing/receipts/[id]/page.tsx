import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Printer } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [receipt, settings] = await Promise.all([
    prisma.receipt.findUnique({
      where: { id },
      include: {
        payment: { include: { customer: true, account: true, collectedBy: true } },
        invoice: true,
      },
    }),
    getSettings(),
  ]);

  if (!receipt) notFound();

  const { payment } = receipt;

  return (
    <>
      <PageHeader
        title={receipt.receiptNumber}
        description={`Issued ${formatDateTime(receipt.issuedAt)}`}
        breadcrumb={[{ label: "Receipts", href: "/billing/receipts" }, { label: receipt.receiptNumber }]}
        actions={
          <a
            href={`/billing/receipts/${receipt.id}?print=1`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)] no-print"
          >
            <Printer className="size-4" /> Print / PDF
          </a>
        }
      />

      <PageContainer className="max-w-2xl">
        <Card className="print:border-0 print:shadow-none">
          <CardBody className="space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-5">
              <div>
                <p className="text-lg font-semibold">{settings["company.name"] ?? "ISP"}</p>
                <p className="text-xs text-fg-muted">{settings["company.address"]}</p>
                <p className="text-xs text-fg-muted">{settings["company.phone"]}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-fg-subtle">Payment Receipt</p>
                <p className="font-mono text-lg font-semibold">{receipt.receiptNumber}</p>
                <div className="mt-1 flex justify-end">
                  <StatusBadge status={receipt.status} />
                </div>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Received from</p>
                <p className="mt-1.5 font-medium">{payment.customer.name}</p>
                <p className="text-xs text-fg-muted">{payment.customer.customerCode}</p>
                <p className="text-xs text-fg-muted">{payment.customer.phone}</p>
                {payment.customer.address ? <p className="text-xs text-fg-muted">{payment.customer.address}</p> : null}
              </div>
              <div className="space-y-1.5 text-sm">
                <Line label="Payment ID" value={payment.paymentId} />
                <Line label="Date" value={formatDateTime(payment.paymentDate)} />
                <Line label="Method" value={payment.method} />
                <Line label="Account" value={payment.account.name} />
                <Line label="Invoice" value={receipt.invoice?.invoiceNumber ?? "—"} />
                <Line label="Collected by" value={payment.collectedBy?.name ?? "System"} />
                {payment.transactionId ? <Line label="Transaction" value={payment.transactionId} /> : null}
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2.5">
                    <p className="font-medium">Subscription / service payment</p>
                    {payment.note ? <p className="text-xs text-fg-muted">{payment.note}</p> : null}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatCurrency(receipt.amount)}</td>
                </tr>
              </tbody>
            </table>

            <div className="ml-auto w-full max-w-xs space-y-1.5 border-t border-[var(--border)] pt-4 text-sm">
              <div className="flex justify-between text-lg font-semibold">
                <span>Total paid</span>
                <span className="tabular-nums">{formatCurrency(receipt.amount)}</span>
              </div>
            </div>

            <p className="text-center text-[11px] text-fg-subtle">
              Thank you for your payment. This is a computer generated receipt.
            </p>
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
