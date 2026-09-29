import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { InvoicePaymentForm } from "@/components/billing/billing-forms";
import { InvoicePaymentsTable } from "@/components/billing/invoice-payments-table";
import { AutoRenewButton } from "@/components/billing/invoice-widgets";
import { PayOnlineButton } from "@/components/billing/pay-online-button";
import { formatCurrency, formatDate, round2 } from "@/lib/utils";
import { Banknote, CalendarDays, FileText, PackageIcon, User, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { invoiceNumber: true } });
  return { title: inv?.invoiceNumber ?? "Invoice" };
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "details";

  const today = new Date().toISOString().slice(0, 10);
  const [invoice, accounts, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: { include: { area: true, package: true } },
        package: true,
        payments: { include: { account: true, collectedBy: true, receipt: true }, orderBy: { paymentDate: "desc" } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.account.findMany({ where: { status: "Active" }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    getSettings(),
  ]);

  if (!invoice) notFound();

  const balance = round2(invoice.total - invoice.paid);
  const href = (t: string) => `/billing/invoices/${invoice.id}?tab=${t}`;


  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber}
        description={`Issued ${formatDate(invoice.issueDate)} · due ${formatDate(invoice.dueDate)}`}
        breadcrumb={[
          { label: "Invoices", href: "/billing/invoices" },
          { label: invoice.invoiceNumber },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={invoice.status} />
            <AutoRenewButton customerId={invoice.customerId} />
            {/* Only offered while there is something to pay, and only when a
                gateway is actually configured — a button that leads nowhere is
                worse than no button. */}
            {balance > 0 ? (
              <PayOnlineButton
                invoiceId={invoice.id}
                provider={settings["api.sslcommerzStoreId"] ? "SSLCommerz" : null}
                sandbox={settings["api.sslcommerzSandbox"] === "true"}
              />
            ) : null}
            <a
              href={`/billing/invoices/${invoice.id}?print=1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)] no-print"
            >
              Download PDF
            </a>
            <a
              href={`/billing/invoices/${invoice.id}?tab=payment`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 no-print"
            >
              <Banknote className="size-4" /> Collect Payment
            </a>
          </div>
        }
      >
        <Tabs
          items={[
            { value: "details", label: "Details", href: href("details") },
            { value: "payment", label: "Collect Payment", href: href("payment"), count: invoice.payments.length || undefined },
          ]}
        />
      </PageHeader>

      <PageContainer className="max-w-5xl">
        {tab === "payment" ? (
          <Card>
            <CardHeader
              title="Collect payment"
              description="Records against this invoice and refreshes the customer due and account balance"
            />
            <CardBody>
              <InvoicePaymentForm
                invoiceId={invoice.id}
                balance={balance}
                dueDate={invoice.dueDate}
                invoiceNumber={invoice.invoiceNumber}
                accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currentBalance: a.currentBalance }))}
                today={today}
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Printable document */}
            <Card className="lg:col-span-2">
              <CardBody className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-5">
                  <div>
                    <p className="text-lg font-semibold">{settings["company.name"] ?? "ISP"}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{settings["company.address"]}</p>
                    <p className="text-xs text-fg-muted">{settings["company.phone"]}</p>
                    <p className="text-xs text-fg-muted">{settings["company.email"]}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wider text-fg-subtle">Invoice</p>
                    <p className="font-mono text-lg font-semibold">{invoice.invoiceNumber}</p>
                    <div className="mt-1 flex justify-end">
                      <StatusBadge status={invoice.status} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Bill to</p>
                    <p className="mt-1.5 font-medium">{invoice.customer.name}</p>
                    <p className="text-xs text-fg-muted">{invoice.customer.customerCode}</p>
                    <p className="text-xs text-fg-muted">{invoice.customer.phone}</p>
                    {invoice.customer.address ? <p className="text-xs text-fg-muted">{invoice.customer.address}</p> : null}
                    {invoice.customer.area ? <p className="text-xs text-fg-muted">{invoice.customer.area.name}</p> : null}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <DetailRow label="Issue date" value={formatDate(invoice.issueDate)} icon={<CalendarDays className="size-3.5" />} />
                    <DetailRow label="Due date" value={formatDate(invoice.dueDate)} icon={<CalendarDays className="size-3.5" />} />
                    <DetailRow label="Package" value={invoice.package?.name ?? "—"} icon={<PackageIcon className="size-3.5" />} />
                    {invoice.billingFrom ? (
                      <DetailRow label="Billing period" value={`${formatDate(invoice.billingFrom)} – ${formatDate(invoice.billingTo)}`} />
                    ) : null}
                    <DetailRow label="Created by" value={invoice.createdBy?.name ?? "System"} icon={<User className="size-3.5" />} />
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
                    <tr className="border-b border-[var(--border)]">
                      <td className="py-2.5">
                        <p className="font-medium">
                          {invoice.package ? `${invoice.package.name} — monthly subscription` : "Service charge"}
                        </p>
                        {invoice.note ? <p className="text-xs text-fg-muted">{invoice.note}</p> : null}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{formatCurrency(invoice.amount)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-fg-muted">Subtotal</span><span className="tabular-nums">{formatCurrency(invoice.amount)}</span></div>
                  {invoice.discount > 0 ? (
                    <div className="flex justify-between"><span className="text-fg-muted">Discount</span><span className="tabular-nums text-red-600">-{formatCurrency(invoice.discount)}</span></div>
                  ) : null}
                  {invoice.vat > 0 ? (
                    <div className="flex justify-between"><span className="text-fg-muted">{settings["billing.defaultTaxLabel"] ?? "VAT"}</span><span className="tabular-nums">{formatCurrency(invoice.vat)}</span></div>
                  ) : null}
                  <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-semibold">
                    <span>Total</span><span className="tabular-nums">{formatCurrency(invoice.total)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Paid</span><span className="tabular-nums">-{formatCurrency(invoice.paid)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[var(--border)] pt-2 font-semibold">
                    <span>Balance due</span><span className="tabular-nums">{formatCurrency(balance)}</span>
                  </div>
                </div>
              </CardBody>
            </Card>

            <div className="space-y-4">
              <StatCardGrid>
                <StatCard label="Total" value={formatCurrency(invoice.total)} icon={FileText} tone="brand" />
                <StatCard label="Paid" value={formatCurrency(invoice.paid)} icon={Wallet} tone="success" />
              </StatCardGrid>

              <Card>
                <CardHeader title="Payments" description={`${invoice.payments.length} recorded against this invoice`} />
                <CardBody className="p-0">
                  <InvoicePaymentsTable
                    rows={invoice.payments.map((p) => ({
                      id: p.id,
                      paymentId: p.paymentId,
                      amount: p.amount,
                      method: p.method,
                      paymentDate: p.paymentDate,
                      accountName: p.account.name,
                      receiptNumber: p.receipt?.receiptNumber ?? null,
                    }))}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </PageContainer>
    </>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-fg-muted">
        {icon ? <span className="[&_svg]:size-3.5">{icon}</span> : null}
        {label}
      </span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
