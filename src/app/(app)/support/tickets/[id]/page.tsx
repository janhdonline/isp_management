import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getTicketFull } from "@/lib/services/support";
import { getCustomerActivity } from "@/lib/services/customers";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { TicketDetailView } from "@/components/support/ticket-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await prisma.ticket.findUnique({ where: { id }, select: { ticketNumber: true, subject: true } });
  return { title: t ? `${t.ticketNumber} — ${t.subject}` : "Ticket" };
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, technicians, activity] = await Promise.all([
    getTicketFull(id),
    prisma.employee.findMany({
      where: { role: { contains: "Technician" } },
      select: { id: true, name: true, phone: true, role: true, status: true },
      orderBy: { name: "asc" },
    }),
    getActivityForTicket(id),
  ]);

  if (!ticket) notFound();

  return (
    <>
      <PageHeader
        title={ticket.ticketNumber}
        description={ticket.subject}
        breadcrumb={[
          { label: "Support", href: "/support" },
          { label: "Tickets", href: "/support/tickets" },
          { label: ticket.ticketNumber },
        ]}
      />
      <PageContainer>
        <TicketDetailView
          ticket={{
            ...ticket,
            createdBy: ticket.createdBy ? { name: ticket.createdBy.name } : null,
          }}
          technicians={technicians}
          activity={activity.map((a) => ({
            id: a.id,
            action: a.action,
            summary: a.summary,
            createdAt: a.createdAt,
            actor: a.actor?.name ?? "System",
          }))}
        />
      </PageContainer>
    </>
  );
}

async function getActivityForTicket(id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { customerId: true } });
  if (!ticket?.customerId) return [];
  return getCustomerActivity(ticket.customerId, 20);
}
