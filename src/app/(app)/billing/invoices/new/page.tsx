import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { CreateInvoiceForm } from "@/components/billing/billing-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const defaultCustomerId = typeof sp.customerId === "string" ? sp.customerId : undefined;

  const customers = await prisma.customer.findMany({
    where: { connectionStatus: { not: "Disconnected" } },
    orderBy: { name: "asc" },
    include: { package: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader
        title="New Invoice"
        description="Raise a one-off invoice. Renewal invoices are generated from the customer's current package."
        breadcrumb={[{ label: "Billing", href: "/billing/invoices" }, { label: "New Invoice" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <CreateInvoiceForm
              today={new Date().toISOString().slice(0, 10)}
              defaultCustomerId={defaultCustomerId}
              customers={customers.map((c) => ({
                id: c.id,
                name: c.name,
                customerCode: c.customerCode,
                username: c.username,
                phone: c.phone,
                monthlyBill: c.monthlyBill,
                packageName: c.package?.name ?? null,
              }))}
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
