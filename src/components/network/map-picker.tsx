"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadLeaflet,
  TILE_URL,
  TILE_ATTRIBUTION,
  type LeafletMap,
  type LeafletMarker,
} from "@/components/network/leaflet";

/**
 * A small map for choosing a position.
 *
 * Writes its answer into two hidden fields rather than calling back, so it drops
 * into an existing `<form>` with no plumbing: the same `Object.fromEntries(fd)`
 * that already reads the text inputs picks the coordinates up.
 */
export default function MapPicker({
  latitude,
  longitude,
  zoom = 15,
}: {
  latitude?: number | null;
  longitude?: number | null;
  zoom?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [value, setValue] = useState<{ lat: number; lng: number } | null>(() =>
    typeof latitude === "number" && typeof longitude === "number"
      ? { lat: latitude, lng: longitude }
      : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let map: LeafletMap | undefined;
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !container.current) return;
        map = L.map(container.current).setView([23.8103, 90.4125], zoom);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

        map.on("click", (e) => {
          const point = { lat: e.latlng.lat, lng: e.latlng.lng };
          if (markerRef.current) markerRef.current.setLatLng([point.lat, point.lng]);
          else markerRef.current = L.circleMarker([point.lat, point.lng]).addTo(map!);
          setValue(point);
        });

        if (value) {
          markerRef.current = L.circleMarker([value.lat, value.lng]).addTo(map);
          map.setView([value.lat, value.lng], zoom);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // `value` is deliberately absent: depending on it would tear the map down and
    // rebuild it on every click, throwing away the user's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div className="space-y-2">
      <div
        ref={container}
        className="h-64 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)]"
      />
      {error ? (
        <p className="text-xs text-fg-muted">
          The map could not load ({error}). An area can still be saved without a position.
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">Click the map to drop a pin.</p>
      )}
      <div className="flex items-center gap-2">
        <input type="hidden" name="latitude" value={value?.lat ?? ""} readOnly />
        <input type="hidden" name="longitude" value={value?.lng ?? ""} readOnly />
        <span className="font-mono text-xs text-fg-muted">
          {value ? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}` : "no position set"}
        </span>
        {value ? (
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline"
            onClick={() => {
              setValue(null);
              markerRef.current = null;
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}