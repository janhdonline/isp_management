import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { dueSummary } from "@/lib/services/billing-queries";
import { BillingDueView, DueRow, DueSummaryData } from "@/components/billing/billing-due";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { startOfDay } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing Due" };

export default async function BillingDuePage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [summary, invoices, paidByMonth, dueByMonth] = await Promise.all([
    dueSummary(),
    prisma.invoice.findMany({
      where: { status: { in: ["Due", "Partial", "Overdue"] } },
      orderBy: [{ dueDate: "asc" }],
      take: 200,
      include: {
        customer: { include: { area: { select: { name: true } }, package: { select: { name: true } } } },
        package: { select: { name: true } },
      },
    }),
    prisma.payment.groupBy({
      by: ["paymentDate"],
      where: { paymentDate: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.invoice.groupBy({
      by: ["issueDate"],
      where: { issueDate: { gte: monthStart }, status: { in: ["Due", "Partial", "Overdue"] } },
      _sum: { total: true, paid: true },
    }),
  ]);

  // 12 month trend of collected vs still-due
  const months: { key: string; label: string; Collected: number; Due: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth() + i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }), Collected: 0, Due: 0 });
  }
  const index = new Map(months.map((m) => [m.key, m]));

  for (const p of paidByMonth) {
    const key = `${p.paymentDate.getFullYear()}-${String(p.paymentDate.getMonth() + 1).padStart(2, "0")}`;
    index.get(key)!.Collected += p._sum.amount ?? 0;
  }
  for (const d of dueByMonth) {
    const key = `${d.issueDate.getFullYear()}-${String(d.issueDate.getMonth() + 1).padStart(2, "0")}`;
    index.get(key)!.Due += (d._sum.total ?? 0) - (d._sum.paid ?? 0);
  }

  const rows: DueRow[] = invoices
    .map((inv) => {
      const balance = Math.round((inv.total - inv.paid) * 100) / 100;
      const daysOverdue = Math.max(0, Math.round((startOfDay(now).getTime() - inv.dueDate.getTime()) / 86400000));
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerId: inv.customerId,
        customerName: inv.customer.name,
        customerCode: inv.customer.customerCode,
        username: inv.customer.username,
        phone: inv.customer.phone,
        packageName: inv.package?.name ?? inv.customer.package?.name ?? null,
        areaId: inv.customer.areaId,
        areaName: inv.customer.area?.name ?? null,
        total: inv.total,
        paid: inv.paid,
        balance,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        daysOverdue,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);

  const view: DueSummaryData = {
    ...summary,
    trend: months.map(({ label, Collected, Due }) => ({ label, Collected, Due })),
  };

  return (
    <>
      <PageHeader
        title="Due & Collection Progress"
        description="Aging, area and package breakdown of everything still owed to you."
        breadcrumb={[{ label: "Billing", href: "/billing/invoices" }, { label: "Due" }]}
      />
      <PageContainer>
        <BillingDueView rows={rows} summary={view} />
      </PageContainer>
    </>
  );
}
