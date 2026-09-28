import type { Metadata } from "next";
import { listReceipts } from "@/lib/services/billing-queries";
import { parseListParams } from "@/lib/query";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { ReceiptsView, type ReceiptRow } from "@/components/billing/receipts-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await listReceipts(parseListParams(await searchParams));

  return (
    <>
      <PageHeader
        title="Receipts"
        description="A receipt is generated automatically for every payment and can be reprinted at any time."
        breadcrumb={[{ label: "Billing", href: "/billing/invoices" }, { label: "Receipts" }]}
      />
      <PageContainer>
        <ReceiptsView
          rows={result.rows as unknown as ReceiptRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
        />
      </PageContainer>
    </>
  );
}
