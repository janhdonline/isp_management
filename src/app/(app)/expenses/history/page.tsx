import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { FilterSelect, Pagination } from "@/components/ui/data-table";
import { DateRangeFilter } from "@/components/ui/date-filter";
import { ExpensesTable } from "@/components/accounts/accounts-views";
import { EmptyState } from "@/components/ui/states";
import { parseListParams, startOfDayParam } from "@/lib/query";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/enums";
import { Wallet, TrendingDown, ListFilter, CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Expense History" };

export default async function ExpenseHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const from = startOfDayParam(p.from);
  const to = startOfDayParam(p.to, true);
  const page = Math.max(1, p.page ?? 1);
  const perPage = p.perPage ?? 10;

  const where = {
    ...(p.category ? { category: p.category } : {}),
    ...(p.accountId ? { accountId: p.accountId } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [rows, total, agg, accounts, topRows] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { account: { select: { name: true, type: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.account.findMany({ where: { status: "Active" }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 1,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <>
      <PageHeader
        title="Expense History"
        description="Filtered expense ledger with running totals for the selected period."
        breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: "History" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard
            label="Total Expense"
            value={formatCurrency(agg._sum.amount ?? 0)}
            icon={Wallet}
            tone="danger"
            hint={`${total} entries`}
          />
          <StatCard
            label="Average per Entry"
            value={formatCurrency(total ? (agg._sum.amount ?? 0) / total : 0)}
            icon={TrendingDown}
            tone="warning"
          />
          <StatCard
            label="Largest Category"
            value={topRows[0]?.category ?? "—"}
            icon={ListFilter}
            tone="brand"
            hint={formatCurrency(topRows[0]?._sum.amount ?? 0)}
          />
          <StatCard label="Entries" value={formatNumber(total)} icon={CalendarDays} tone="neutral" />
        </StatCardGrid>

        <ExpensesTable
          variant="history"
          rows={rows.map((e) => ({
            id: e.id,
            category: e.category,
            description: e.description,
            vendor: e.vendor,
            amount: e.amount,
            date: e.date,
            account: e.account,
            createdBy: e.createdBy,
          }))}
          exportFilename="expense-history"
          searchPlaceholder="Search description, vendor, account..."
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
                  <DateRangeFilter />
                </>
          }
          pagination={<Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />}
          empty={
            <EmptyState
              icon={<Wallet />}
              title="No expenses found"
              description="Adjust the filters or record a new expense."
            />
          }
        />
      </PageContainer>
    </>
  );
}
