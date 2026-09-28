import type { Metadata } from "next";
import { listAccounts } from "@/lib/services/accounts";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { TransferForm, type AccountRow } from "@/components/accounts/accounts-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transfer Fund" };

export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fromId = typeof sp.fromAccountId === "string" ? sp.fromAccountId : undefined;
  const { rows } = await listAccounts();

  return (
    <>
      <PageHeader
        title="Transfer Fund"
        description="Move money between your own accounts. Both ledgers are updated in one transaction."
        breadcrumb={[{ label: "Accounts", href: "/accounts" }, { label: "Transfer Fund" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <TransferForm accounts={rows as AccountRow[]} defaultFrom={fromId} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
