import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { FilterSelect } from "@/components/ui/data-table";
import { ExpensesTable } from "@/components/accounts/accounts-views";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/enums";
import { Wallet, Receipt, TrendingDown, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Daily Expense" };

export default async function ExpensesPage() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const [expenses, agg, count, largest, accounts] = await Promise.all([
    prisma.expense.findMany({
      where: { date: { gte: todayStart } },
      orderBy: { date: "desc" },
      take: 100,
      include: { account: { select: { name: true, type: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.expense.aggregate({ where: { date: { gte: todayStart } }, _sum: { amount: true } }),
    prisma.expense.count({ where: { date: { gte: todayStart } } }),
    prisma.expense.findFirst({
      where: { date: { gte: todayStart } },
      orderBy: { amount: "desc" },
      select: { amount: true, category: true },
    }),
    prisma.account.findMany({ where: { status: "Active" }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <>
      <PageHeader
        title="Daily Expense"
        description="Today's spending, broken down by time, category and account."
        breadcrumb={[{ label: "Expenses", href: "/expenses" }]}
        actions={
          <Link
            href="/expenses/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Wallet className="size-4" /> Add Expense
          </Link>
        }
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Today's Expense" value={formatCurrency(agg._sum.amount ?? 0)} icon={Wallet} tone="danger" />
          <StatCard label="Number of Expenses" value={formatNumber(count)} icon={Receipt} tone="brand" />
          <StatCard
            label="Highest Expense"
            value={formatCurrency(largest?.amount ?? 0)}
            icon={TrendingDown}
            tone="warning"
            hint={largest?.category}
          />
          <StatCard label="Accounts Available" value={formatNumber(accounts.length)} icon={Users} tone="neutral" />
        </StatCardGrid>

        <ExpensesTable
          variant="today"
          rows={expenses.map((e) => ({
            id: e.id,
            category: e.category,
            description: e.description,
            vendor: e.vendor,
            amount: e.amount,
            date: e.date,
            account: e.account,
            createdBy: e.createdBy,
          }))}
          exportFilename="expenses-today"
          searchPlaceholder="Search expense, vendor..."
          filters={

                <>
                  <FilterSelect
                    param="category"
                    placeholder="All categories"
                    options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                    width="w-44"
                  />
                  <FilterSelect
                    param="accountId"
                    placeholder="All accounts"
                    options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </>
          }
          empty={
            <EmptyState
              icon={<Wallet />}
              title="No expenses today"
              description="Record an expense to see it in today's list."
              action={
                <Link
                  href="/expenses/new"
                  className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white"
                >
                  Add Expense
                </Link>
              }
            />
          }
        />
      </PageContainer>
    </>
  );
}
