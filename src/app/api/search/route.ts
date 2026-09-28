import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";

export type SearchHit = {
  id: string;
  type: "Customer" | "Package" | "Invoice" | "Ticket" | "Area";
  title: string;
  subtitle: string;
  href: string;
};

/** Powers the topbar global search (ISP.md §1: customer, username, phone, invoice, IP, ticket). */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ hits: [] }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ hits: [] });

  const term = q;
  const [customers, invoices, tickets, areas, packages] = await Promise.all([
    prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: term } },
          { username: { contains: term } },
          { phone: { contains: term } },
          { customerCode: { contains: term } },
          { ipAddress: { contains: term } },
          { macAddress: { contains: term } },
        ],
      },
      take: 6,
      select: { id: true, name: true, customerCode: true, username: true, phone: true, ipAddress: true },
    }),
    prisma.invoice.findMany({
      where: { invoiceNumber: { contains: term } },
      take: 4,
      select: { id: true, invoiceNumber: true, total: true, customer: { select: { name: true } } },
    }),
    prisma.ticket.findMany({
      where: {
        OR: [
          { ticketNumber: { contains: term } },
          { subject: { contains: term } },
          { problem: { contains: term } },
        ],
      },
      take: 4,
      select: { id: true, ticketNumber: true, subject: true, status: true },
    }),
    prisma.area.findMany({
      where: { name: { contains: term } },
      take: 3,
      select: { id: true, name: true, zone: { select: { name: true } } },
    }),
    prisma.package.findMany({
      where: { name: { contains: term } },
      take: 3,
      select: { id: true, name: true, monthlyPrice: true },
    }),
  ]);

  const hits: SearchHit[] = [
    ...customers.map((c) => ({
      id: c.id,
      type: "Customer" as const,
      title: c.name,
      subtitle: `${c.customerCode} · ${c.username} · ${c.phone}${c.ipAddress ? ` · ${c.ipAddress}` : ""}`,
      href: `/customers/${c.id}`,
    })),
    ...invoices.map((i) => ({
      id: i.id,
      type: "Invoice" as const,
      title: i.invoiceNumber,
      subtitle: `${i.customer.name} · ৳${i.total}`,
      href: `/billing/invoices/${i.id}`,
    })),
    ...tickets.map((t) => ({
      id: t.id,
      type: "Ticket" as const,
      title: `${t.ticketNumber} — ${t.subject}`,
      subtitle: t.status,
      href: `/support/tickets/${t.id}`,
    })),
    ...areas.map((a) => ({
      id: a.id,
      type: "Area" as const,
      title: a.name,
      subtitle: a.zone?.name ?? "No zone",
      href: `/areas?areaId=${a.id}`,
    })),
    ...packages.map((p) => ({
      id: p.id,
      type: "Package" as const,
      title: p.name,
      subtitle: `৳${p.monthlyPrice}/month`,
      href: `/packages/${p.id}`,
    })),
  ];

  return Response.json({ hits });
}
