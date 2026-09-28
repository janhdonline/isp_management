import type { Metadata } from "next";
import { listTransactions, listAccounts } from "@/lib/services/accounts";
import { parseListParams } from "@/lib/query";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { TransactionsTable, type TransactionRow } from "@/components/accounts/accounts-views";
import { formatCurrency } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account History" };

export default async function AccountHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [result, accounts] = await Promise.all([
    listTransactions(parseListParams(await searchParams)),
    listAccounts(),
  ]);
  const m = result.metrics ?? { credit: 0, debit: 0 };

  return (
    <>
      <PageHeader
        title="Account History"
        description="Double-entry ledger of every credit and debit with a running balance."
        breadcrumb={[{ label: "Accounts", href: "/accounts" }, { label: "History" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Credit" value={formatCurrency(m.credit)} icon={ArrowDownLeft} tone="success" />
          <StatCard label="Total Debit" value={formatCurrency(m.debit)} icon={ArrowUpRight} tone="danger" />
          <StatCard label="Net Movement" value={formatCurrency(m.credit - m.debit)} icon={Scale} tone="brand" />
          <StatCard label="Transactions" value={result.total.toLocaleString()} tone="neutral" />
        </StatCardGrid>

        <TransactionsTable
          rows={result.rows as unknown as TransactionRow[]}
          accounts={accounts.rows.map((a) => ({ id: a.id, name: a.name }))}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
        />
      </PageContainer>
    </>
  );
}
