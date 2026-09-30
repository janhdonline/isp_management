import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { lifecycleCandidates } from "@/lib/services/dashboard";
import { round2 } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { addDays, startOfDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [lifecycle, totalDueAgg, openTickets, fupThrottled] = await Promise.all([
    lifecycleCandidates(),
    prisma.customer.aggregate({
      where: { connectionStatus: { not: "Disconnected" } },
      _sum: { previousDue: true },
    }),
    prisma.ticket.count({ where: { status: { in: ["Open", "Pending", "In Progress"] } } }),
    // Shown only when it is non-zero — a bell entry that reads "Throttled: 0"
    // every day is one nobody scrolls to.
    prisma.customer.count({ where: { fupThrottled: true } }),
  ]);

  return (
    <AppShell
      user={session}
      alerts={{
        expiringToday: await prisma.customer.count({
          where: { connectionStatus: "Active", expiryDate: { gte: startOfDay(new Date()), lt: addDays(startOfDay(new Date()), 1) } },
        }),
        expired: lifecycle.expired,
        suspended: lifecycle.expiringSoon,
        openTickets,
        fupThrottled,
        totalDue: round2(totalDueAgg._sum.previousDue ?? 0),
      }}
    >
      {children}
    </AppShell>
  );
}
