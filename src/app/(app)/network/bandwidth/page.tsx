import type { Metadata } from "next";
import { bandwidthReport } from "@/lib/services/network";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { BandwidthView } from "@/components/network/network-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bandwidth" };

export default async function BandwidthPage() {
  const data = await bandwidthReport();

  return (
    <>
      <PageHeader
        title="Bandwidth"
        description="Traffic distribution across hours, packages and the heaviest consumers."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Bandwidth" }]}
      />
      <PageContainer>
        <BandwidthView data={data} />
      </PageContainer>
    </>
  );
}
