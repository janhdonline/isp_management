"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapFeature, MapRoute } from "@/lib/services/fiber";
import {
  loadLeaflet,
  TILE_URL,
  TILE_ATTRIBUTION,
  type LatLng,
  type LeafletMap,
} from "@/components/network/leaflet";

/**
 * The fiber map.
 *
 * Markers coloured by status, fiber routes as polylines, click to inspect.
 * Everything arrives as props from the server, so this file fetches nothing of its
 * own: the map shows what the page decided to show.
 */

/**
 * Colour *and* shape carry the status.
 *
 * Colour alone is not enough — red against green is exactly the distinction most
 * people with the common forms of colour blindness cannot make, and this is the
 * one page where being wrong about it sends a crew to the wrong cabinet. OLTs are
 * squares, routers diamonds, ONUs circles, so the kind survives without hue; and
 * every marker's tooltip names its status in words.
 */
const SHAPE: Record<MapFeature["kind"], "circle" | "square" | "diamond"> = {
  olt: "square",
  router: "diamond",
  onu: "circle",
  area: "circle",
};

const RADIUS: Record<MapFeature["kind"], number> = { olt: 9, router: 8, onu: 6, area: 7 };

export function statusColour(status: string): string {
  switch (status) {
    case "Online":
    case "Active":
      return "#16a34a";
    case "Offline":
    case "Disconnected":
      return "#dc2626";
    case "Low Signal":
    case "Low signal":
      return "#c99b3f";
    default:
      return "#64748b";
  }
}

/** A phrase for the status, for the inspector and every tooltip. */
export function statusLabel(status: string): string {
  switch (status) {
    case "Online":
      return "online";
    case "Offline":
      return "offline";
    case "Low Signal":
      return "low signal";
    case "Unknown":
      return "unknown — never polled";
    default:
      return status || "unknown";
  }
}

export default function FiberMap({
  features,
  routes,
  center,
}: {
  features: MapFeature[];
  routes: MapRoute[];
  /** Derived from the data, so an unlocated network still opens on the right
   *  part of the city rather than on the middle of the ocean. */
  center: LatLng;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapFeature | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({
    olt: false,
    router: false,
    onu: false,
  });
  const [showRoutes, setShowRoutes] = useState(true);

  const shown = useMemo(
    () => features.filter((f) => !hidden[f.kind]),
    [features, hidden]
  );
  const shownRoutes = useMemo(() => (showRoutes ? routes : []), [routes, showRoutes]);
  const total = useMemo(
    () =>
      (["olt", "router", "onu"] as const).map((kind) => ({
        kind,
        count: features.filter((f) => f.kind === kind).length,
      })),
    [features]
  );

  useEffect(() => {
    let map: LeafletMap | undefined;
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !container.current) return;
        map = L.map(container.current).setView(center, 12);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

        for (const route of shownRoutes) {
          L.polyline(
            route.points.map((p) => [p.lat, p.lng]),
            { color: "#3163ff", weight: 3, opacity: 0.7 }
          )
            .bindTooltip(route.name)
            .addTo(map);
        }

        for (const f of shown) {
          const colour = statusColour(f.status);
          const options = {
            radius: RADIUS[f.kind],
            color: colour,
            fillColor: colour,
            fillOpacity: 0.85,
            weight: 2,
          };
          const at: LatLng = [f.lat, f.lng];
          const marker =
            SHAPE[f.kind] === "square" ? L.squareMarker(at, options) : L.circleMarker(at, options);
          marker.bindTooltip(`${f.name} — ${statusLabel(f.status)}`);
          marker.on("click", () => setSelected(f));
          marker.addTo(map);
        }

        // Fit to what is actually there: a one-cabinet deployment gets a close-up,
        // a city-wide one gets the whole city. A hard-coded centre and zoom gets
        // one of those two cases wrong.
        const points = shown.map((f) => [f.lat, f.lng] as LatLng);
        if (points.length === 1) map.setView(points[0], 15);
        else if (points.length > 1) map.fitBounds(L.latLngBounds(points));
        else map.setView(center, 12);

        setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [center, shown, shownRoutes]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {total.map(({ kind, count }) => (
            <label key={kind} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!hidden[kind]}
                onChange={(e) => setHidden((prev) => ({ ...prev, [kind]: !e.target.checked }))}
              />
              {kind === "olt" ? "OLTs" : kind === "router" ? "Routers" : "ONUs"} ({count})
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showRoutes}
              onChange={(e) => setShowRoutes(e.target.checked)}
            />
            Fiber routes ({routes.length})
          </label>
        </div>

        <div
          ref={container}
          className="h-[32rem] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)]"
        />

        {error ? (
          <p className="text-xs text-fg-muted">
            The map could not load ({error}). The lists beside it still carry every coordinate,
            so nothing is lost.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
          {[
            ["#16a34a", "online"],
            ["#c99b3f", "low signal"],
            ["#dc2626", "offline"],
            ["#64748b", "unknown"],
          ].map(([colour, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: colour }} />
              {label}
            </span>
          ))}
          <span>square = OLT, diamond = router, dot = ONU</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="text-[11px] uppercase tracking-wide text-fg-subtle">
                    {selected.kind}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-fg-subtle hover:text-fg"
                >
                  Close
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: statusColour(selected.status) }}
                />
                {statusLabel(selected.status)}
              </p>
              <p className="mt-1 text-xs text-fg-muted">{selected.detail}</p>
              <p className="mt-2 font-mono text-[11px] text-fg-subtle">
                {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
              </p>
              <a
                href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=18/${selected.lat}/${selected.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-brand-600 hover:underline"
              >
                Open in maps
              </a>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              {ready
                ? "Click a marker to see what it is and what state it is in."
                : "Loading the map…"}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-sm font-medium">Fiber routes</p>
          {routes.length === 0 ? (
            <p className="mt-1 text-xs text-fg-muted">
              No runs recorded. A route is the fiber as the crew walked it, not a straight line
              between two cabinets — it is what tells you which span to check first.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs">
              {routes.map((r) => (
                <li key={r.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-fg-muted">
                    {r.points.length} waypoint{r.points.length === 1 ? "" : "s"}
                    {r.olt ? ` · from ${r.olt}` : ""}
                    {r.area ? ` · ${r.area}` : ""}
                  </p>
                  {r.note ? <p className="mt-0.5 text-fg-subtle">{r.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}