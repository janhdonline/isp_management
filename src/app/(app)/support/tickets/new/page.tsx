import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { TicketForm } from "@/components/support/forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Ticket" };

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const [customers, technicians, areas] = await Promise.all([
    prisma.customer.findMany({
      where: { connectionStatus: { not: "Disconnected" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true, phone: true, areaId: true },
      take: 500,
    }),
    prisma.employee.findMany({ where: { role: { contains: "Technician" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.area.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New Ticket"
        description="Log a complaint and route it to a technician."
        breadcrumb={[{ label: "Support", href: "/support" }, { label: "Tickets", href: "/support/tickets" }, { label: "New" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <TicketForm
              customers={customers}
              technicians={technicians}
              areas={areas}
              defaultCustomerId={typeof sp.customerId === "string" ? sp.customerId : undefined}
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
