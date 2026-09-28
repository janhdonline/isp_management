import type { Metadata } from "next";
import { areaCoverage } from "@/lib/services/areas";
import { CoverageView } from "@/components/areas/coverage-view";
import { PageHeader, PageContainer } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coverage" };

export default async function CoveragePage() {
  const { areas } = await areaCoverage();

  return (
    <>
      <PageHeader
        title="Coverage"
        description="Network footprint: where devices are placed and which customers they serve."
        breadcrumb={[{ label: "Areas", href: "/areas" }, { label: "Coverage" }]}
      />
      <PageContainer>
        <CoverageView areas={areas} />
      </PageContainer>
    </>
  );
}
