import type { Metadata } from "next";
import { listAccounts } from "@/lib/services/accounts";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { AccountsTable, AccountRow } from "@/components/accounts/accounts-views";
import { formatCurrency } from "@/lib/utils";
import { Banknote, Landmark, Smartphone, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { rows, metrics } = await listAccounts();

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Every wallet that money moves through — cash, bank and mobile banking."
        breadcrumb={[{ label: "Accounts", href: "/accounts" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Balance" value={formatCurrency(metrics.total)} icon={Wallet} tone="brand" />
          <StatCard label="Cash" value={formatCurrency(metrics.byType.Cash ?? 0)} icon={Banknote} tone="success" />
          <StatCard label="Bank" value={formatCurrency(metrics.byType.Bank ?? 0)} icon={Landmark} tone="info" />
          <StatCard
            label="Mobile Banking"
            value={formatCurrency((metrics.byType.bKash ?? 0) + (metrics.byType.Nagad ?? 0) + (metrics.byType.Rocket ?? 0))}
            icon={Smartphone}
            tone="warning"
          />
        </StatCardGrid>

        <AccountsTable rows={rows as AccountRow[]} />
      </PageContainer>
    </>
  );
}
