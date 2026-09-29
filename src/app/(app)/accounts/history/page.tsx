import type { Metadata } from "next";
import { listTransactions, listAccounts } from "@/lib/services/accounts";
import { parseListParams } from "@/lib/query";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { TransactionsTable, type TransactionRow } from "@/components/accounts/accounts-views";
import { RefundForm } from "@/components/accounts/refund-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Scale, Undo2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account History" };

export default async function AccountHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [result, accounts, owing] = await Promise.all([
    listTransactions(parseListParams(await searchParams)),
    listAccounts(),
    // Only customers who actually owe something can be refunded, so the list
    // is not a 200-row dropdown of people with a zero balance.
    prisma.customer.findMany({
      where: { previousDue: { gt: 0 } },
      orderBy: { previousDue: "desc" },
      select: { id: true, name: true, username: true, phone: true, previousDue: true },
      take: 300,
    }),
  ]);
  const m = result.metrics ?? { credit: 0, debit: 0 };
  const refunds = result.rows.filter((r) => r.type === "Refund").length;

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
          <StatCard label="Refunds" value={String(refunds)} icon={Undo2} tone={refunds > 0 ? "warning" : "neutral"} />
        </StatCardGrid>

        <Card>
          <CardHeader
            title="Issue a refund"
            description="Returns money to a customer. The account is debited and their due drops, in one transaction."
            icon={<Undo2 />}
          />
          <CardBody>
            {owing.length === 0 ? (
              <p className="py-4 text-sm text-fg-muted">
                No customer currently owes anything, so there is nothing to refund.
              </p>
            ) : (
              <RefundForm
                customers={owing}
                accounts={accounts.rows
                  .filter((a) => a.status === "Active")
                  .map((a) => ({ id: a.id, name: `${a.name} (${a.type})` }))}
              />
            )}
          </CardBody>
        </Card>

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
