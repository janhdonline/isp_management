import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { mapFeatures, mapRoutes } from "@/lib/services/fiber";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import FiberMap from "@/components/network/fiber-map";
import { FALLBACK_CENTER, type LatLng } from "@/components/network/leaflet";
import { FiberRouteForm } from "@/components/network/fiber-route-form";
import { formatNumber } from "@/lib/utils";
import { Cable, MapPin, Server, Wifi, WifiOff } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fiber Map" };

/**
 * Network → Fiber Map.
 *
 * Every device that has a position, and every fiber run that has been walked. A
 * cabinet with no coordinates is *absent* rather than pinned at the origin — an
 * unlocated device is a fact about the data, and drawing it somewhere it is not
 * would send a crew to the wrong place.
 */
export default async function FiberMapPage() {
  const [features, { routes, skipped }, olts] = await Promise.all([
    mapFeatures(),
    mapRoutes(),
    prisma.olt.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const counts = {
    olt: features.filter((f) => f.kind === "olt").length,
    router: features.filter((f) => f.kind === "router").length,
    onu: features.filter((f) => f.kind === "onu").length,
    offline: features.filter(
      (f) => f.status === "Offline" || f.status === "Low Signal"
    ).length,
  };

  // Open on the middle of what is actually there, so a single-cabinet deployment
  // is not shown the whole city.
  const centre: LatLng =
    features.length > 0
      ? [
          features.reduce((sum, f) => sum + f.lat, 0) / features.length,
          features.reduce((sum, f) => sum + f.lng, 0) / features.length,
        ]
      : FALLBACK_CENTER;

  const unpositioned = await prisma.olt.count({
    where: { OR: [{ latitude: null }, { longitude: null }] },
  });

  return (
    <>
      <PageHeader
        title="Fiber Map"
        description="Where the equipment is, and how the fiber runs between it. A cut is localized from the PON hierarchy, so this is the map a technician is dispatched with."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "Fiber Map" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="OLTs on the map" value={formatNumber(counts.olt)} icon={Server} tone="brand" />
          <StatCard label="Routers" value={formatNumber(counts.router)} icon={MapPin} tone="info" />
          <StatCard label="ONUs" value={formatNumber(counts.onu)} icon={Wifi} tone="success" />
          <StatCard
            label="Down or degraded"
            value={formatNumber(counts.offline)}
            icon={WifiOff}
            tone={counts.offline > 0 ? "danger" : "neutral"}
          />
          <StatCard label="Fiber routes" value={formatNumber(routes.length)} icon={Cable} tone="neutral" />
        </StatCardGrid>

        {unpositioned > 0 ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-fg-muted">
            {formatNumber(unpositioned)} OLT{unpositioned === 1 ? "" : "s"} ha
            {unpositioned === 1 ? "s" : "ve"} no coordinates yet, so {unpositioned === 1 ? "it is" : "they are"} not
            on the map. A fiber incident on an unlocated cabinet still produces a ticket — it
            says the position is unknown rather than showing a pin that is not there.
          </p>
        ) : null}

        {features.length === 0 && routes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center">
            <p className="text-sm text-fg-muted">Nothing has coordinates yet.</p>
            <p className="mt-1 text-xs text-fg-subtle">
              Set an area&apos;s position on the Areas page, and a cabinet&apos;s from its row on
              the OLT page. Nothing is inferred: a device with no position stays off the map.
            </p>
          </div>
        ) : (
          <FiberMap features={features} routes={routes} center={centre} />
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-medium">Record a fiber run</h2>
          <p className="text-xs text-fg-muted">
            The fiber as the crew walked it, not a straight line between two cabinets — it is
            what tells a technician which span to check first. Points are
            <code className="mx-1 rounded bg-[var(--surface-3)] px-1">
              [{'{'}&quot;lat,lng&quot;{'}'}]
            </code>
            in order, and a run with fewer than two points cannot be drawn, so it is rejected.
            {skipped > 0
              ? ` ${skipped} stored route${skipped === 1 ? "" : "s"} could not be read and ${skipped === 1 ? "is" : "are"} not drawn.`
              : ""}
          </p>
          <FiberRouteForm olts={olts} routes={routes} />
        </section>
      </PageContainer>
    </>
  );
}