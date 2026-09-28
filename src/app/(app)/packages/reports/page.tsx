import type { Metadata } from "next";
import { packageReport } from "@/lib/services/packages";
import { PackageReportView } from "@/components/packages/package-report";
import { PageHeader, PageContainer } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Package Reports" };

export default async function PackageReportsPage() {
  const { rows, mrr } = await packageReport();

  return (
    <>
      <PageHeader
        title="Package Reports"
        description="Subscriber distribution and revenue contribution per speed tier."
        breadcrumb={[{ label: "Packages", href: "/packages" }, { label: "Reports" }]}
      />
      <PageContainer>
        <PackageReportView rows={rows} mrr={mrr} />
      </PageContainer>
    </>
  );
}
