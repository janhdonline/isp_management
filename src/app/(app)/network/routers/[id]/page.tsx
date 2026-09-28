import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { routerHealth } from "@/lib/services/network";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { RouterDetailView } from "@/components/network/network-tables";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await routerHealth(id).catch(() => null);
  return { title: r?.router.name ?? "Router" };
}

export default async function RouterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await routerHealth(id).catch(() => null);
  if (!data) notFound();

  return (
    <>
      <PageHeader
        title={data.router.name}
        description={`${data.router.model ?? "Unknown model"} · ${data.router.ipAddress}:${data.router.apiPort} · ${data.router.location ?? "No location"}`}
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Routers", href: "/network/routers" }, { label: data.router.name }]}
      />
      <PageContainer>
        <RouterDetailView
          router={{
            id: data.router.id,
            name: data.router.name,
            model: data.router.model,
            ipAddress: data.router.ipAddress,
            location: data.router.location,
            area: null,
          }}
          health={data.health}
          users={data.users}
          adapterName={data.adapterName}
        />
      </PageContainer>
    </>
  );
}
