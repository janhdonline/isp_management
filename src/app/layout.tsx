import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = Roboto_Mono({ subsets: ["latin"], variable: "--font-mono-jet" });

export const metadata: Metadata = {
  title: {
    default: "ISP Management System",
    template: "%s - ISP Management",
  },
  description:
    "Unified ISP operating system for customer, billing, network, support and accounting.",
  applicationName: "ISP Management System",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

/**
 * Applies the stored theme before paint to avoid a light-mode flash.
 * Inline script so it runs synchronously on the client.
 */
const themeScript = `
(function(){try{var t=localStorage.getItem('isp-theme');
if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
if(t==='dark')document.documentElement.classList.add('dark');
document.documentElement.style.colorScheme=t;}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
