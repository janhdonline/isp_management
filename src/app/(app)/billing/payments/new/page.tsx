import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { CollectPaymentForm } from "@/components/billing/billing-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Collect Payment" };

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const defaultCustomerId = typeof sp.customerId === "string" ? sp.customerId : undefined;
  const defaultInvoiceId = typeof sp.invoiceId === "string" ? sp.invoiceId : undefined;

  const [customers, accounts, invoices] = await Promise.all([
    prisma.customer.findMany({
      where: { connectionStatus: { not: "Archived" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, customerCode: true, username: true, phone: true },
    }),
    prisma.account.findMany({ where: { status: "Active" }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.invoice.findMany({
      where: { status: { in: ["Due", "Partial", "Overdue"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, customerId: true, invoiceNumber: true, total: true, paid: true, dueDate: true },
    }),
  ]);

  const invoicesByCustomer: Record<string, { id: string; invoiceNumber: string; total: number; paid: number; dueDate: Date }[]> = {};
  for (const inv of invoices) {
    (invoicesByCustomer[inv.customerId] ??= []).push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      total: inv.total,
      paid: inv.paid,
      dueDate: inv.dueDate,
    });
  }

  return (
    <>
      <PageHeader
        title="Collect Payment"
        description="One entry updates the invoice, the customer due, the account balance, the receipt and the audit log."
        breadcrumb={[{ label: "Payments", href: "/billing/payments" }, { label: "Collect Payment" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <CollectPaymentForm
              today={new Date().toISOString().slice(0, 10)}
              customers={customers}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currentBalance: a.currentBalance }))}
              invoicesByCustomer={invoicesByCustomer}
              defaultCustomerId={defaultCustomerId}
              defaultInvoiceId={defaultInvoiceId}
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
