import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { routerHealth } from "@/lib/services/network";
import { TriangleAlert } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { RouterDetailView } from "@/components/network/network-tables";
import { AutoQueuesPanel } from "@/components/network/auto-queues-panel";
import { listManagedQueues } from "@/lib/services/bandwidth";
import { AutoProvisionToggle } from "@/components/network/auto-provision-toggle";
import { RadiusToggle } from "@/components/network/radius-toggle";

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

  // Read after the health check, and separately: a router we cannot reach has no
  // queue list to show, and the queue read must not be what decides whether this
  // page exists at all.
  const queues = await listManagedQueues(id).catch(() => ({
    queues: [],
    managed: 0,
    unmanaged: 0,
    simulated: true,
  }));

  return (
    <>
      <PageHeader
        title={data.router.name}
        description={`${data.router.model ?? "Unknown model"} · ${data.router.ipAddress}:${data.router.apiPort} · ${data.router.location ?? "No location"}`}
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Routers", href: "/network/routers" }, { label: data.router.name }]}
      />
      <PageContainer className="space-y-4">
        {/* Without credentials the readings below are simulated, so say so
            rather than letting them pass for the router's real state. */}
        {data.live ? null : (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Simulated readings.</strong> No MikroTik API credentials are configured,
              so the figures below come from the demo data source and are not this router&apos;s
              real state. Add them under Settings → Network, then press Refresh.
            </span>
          </div>
        )}
        {data.health.error ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Could not reach the router.</strong> {data.health.error}
            </span>
          </div>
        ) : null}
        {/* Above the readings, because the switch decides whether anything this
            system does actually reaches this router. */}
        <AutoProvisionToggle
          routerId={data.router.id}
          routerName={data.router.name}
          enabled={data.router.autoProvision}
        />
        {/* Next to it rather than on another page: the two switches describe the
            same decision from opposite ends — whether this app manages secrets on
            the router, or answers logins for it. An operator setting up a router
            has both in view. */}
        <RadiusToggle
          routerId={data.router.id}
          routerName={data.router.name}
          enabled={data.router.useRadius}
        />
        <AutoQueuesPanel
          routerId={data.router.id}
          routerName={data.router.name}
          enabled={Boolean((data.router as { autoQueues?: boolean }).autoQueues)}
          useRadius={Boolean(data.router.useRadius)}
          queues={queues.queues}
          managed={queues.managed}
          unmanaged={queues.unmanaged}
          simulated={queues.simulated}
        />
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
