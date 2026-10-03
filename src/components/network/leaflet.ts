/**
 * Leaflet, typed locally and loaded from a CDN.
 *
 * ## Why not a dependency
 *
 * Leaflet and its type definitions are ~150 kB and this is the only page that
 * draws a map. Adding it would put it in the bundle of every route, and its
 * `window` global would have to be stubbed in every unrelated test. Fetched on
 * demand instead: the script lands on `/network/fiber-map` and on a modal that is
 * opened there, and nowhere else.
 *
 * ## Why these types are hand-written
 *
 * For the same reason. `import type { Map } from "leaflet"` would need the
 * package installed to typecheck, which is the dependency again — so the handful
 * of members actually called are declared here. They are a structural subset of
 * Leaflet's own API: `setView`, `fitBounds`, `circleMarker`, and so on behave as
 * declared, and anything added later is a compile error rather than a silent
 * `any`.
 *
 * Version-pinned deliberately: an unpinned CDN URL means an upstream release
 * changes the map on a production deploy with no commit involved.
 */

export type LatLng = [number, number];

export type LeafletMarker = {
  setLatLng(center: LatLng): LeafletMarker;
  bindTooltip(text: string): LeafletMarker;
  on(event: string, handler: () => void): LeafletMarker;
  addTo(map: LeafletMap): LeafletMarker;
};

export type LeafletMap = {
  setView(center: LatLng, zoom?: number): LeafletMap;
  fitBounds(bounds: unknown, options?: unknown): LeafletMap;
  on(event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void): LeafletMap;
  remove(): void;
};

export type LeafletLike = {
  map(element: HTMLElement): LeafletMap;
  tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
  circleMarker(center: LatLng, options?: Record<string, unknown>): LeafletMarker;
  squareMarker(center: LatLng, options?: Record<string, unknown>): LeafletMarker;
  polyline(points: LatLng[], options?: Record<string, unknown>): LeafletMarker;
  marker(center: LatLng): LeafletMarker;
  latLngBounds(points: LatLng[]): unknown;
  icon: { Default: { mergeOptions(options: Record<string, string>): void } };
};

const LEAFLET_VERSION = "1.9.4";
const JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const IMAGES = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/`;

let pending: Promise<LeafletLike> | null = null;

/**
 * One script per page load, shared by every map on the page.
 *
 * A failed load clears the memo so a later map can try again: a rejected promise
 * that stays rejected would pin every subsequent map to the same failure for the
 * life of the tab.
 */
export function loadLeaflet(): Promise<LeafletLike> {
  if (pending) return pending;

  pending = new Promise<LeafletLike>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Leaflet is only available in the browser."));
      return;
    }

    const existing = (window as unknown as { L?: LeafletLike }).L;
    if (existing) {
      resolve(existing);
      return;
    }

    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS;
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = JS;
    script.async = true;
    script.onload = () => {
      const L = (window as unknown as { L?: LeafletLike }).L;
      if (!L) {
        pending = null;
        reject(new Error("Leaflet loaded but did not register itself."));
        return;
      }
      // Leaflet resolves its default marker images relative to the stylesheet,
      // which a CDN-loaded stylesheet breaks, so they are pointed at the CDN.
      L.icon.Default.mergeOptions({
        iconRetinaUrl: `${IMAGES}marker-icon-2x.png`,
        iconUrl: `${IMAGES}marker-icon.png`,
        shadowUrl: `${IMAGES}marker-shadow.png`,
      });
      resolve(L);
    };
    script.onerror = () => {
      pending = null;
      reject(new Error("Leaflet could not be fetched."));
    };
    document.head.appendChild(script);
  });

  return pending;
}

/**
 * The tile layer used everywhere.
 *
 * CARTO's light basemap rather than the standard OSM tiles: it is legible at the
 * zoom levels a city-wide fiber map sits at, it does not shout over the marker
 * colours — which are carrying status, not decoration — and the attribution is
 * carried in the options.
 */
export const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

export const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO";

/** Where the map opens when the network has nothing positioned on it. */
export const FALLBACK_CENTER: LatLng = [23.8103, 90.4125];