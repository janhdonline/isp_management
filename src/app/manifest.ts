import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/**
 * Progressive web app manifest. This is what lets a field technician open the
 * system on a phone and have it behave like an installed app: an icon on the
 * home screen, a splash screen, no browser chrome, and — the part that matters
 * for someone standing in a server room with no signal — a cached shell that
 * still renders when the network does not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NetLink ISP Manager",
    short_name: "ISP Manager",
    description:
      "Customers, billing, network and support for an internet service provider.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f8fafc",
    theme_color: "#3163ff",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // The shortcuts an operator actually reaches for, so the app opens
    // straight to a task instead of the dashboard.
    shortcuts: [
      { name: "Collect a payment", url: "/billing/payments/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Customers", url: "/customers", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Open tickets", url: "/support/tickets", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Due list", url: "/billing/due", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
