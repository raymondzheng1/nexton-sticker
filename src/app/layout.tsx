import type { Metadata, Viewport } from "next";
import { Archivo, Caveat } from "next/font/google";
import { Providers } from "./Providers";
import "./globals.css";

/**
 * Archivo carries every display size and UI label (800/900 only — the album never whispers);
 * Caveat is the coach's handwriting in the margins. Both are self-hosted by next/font, so nothing
 * is fetched from Google at runtime and the app still renders correctly on a pitch with no signal.
 */
const archivo = Archivo({
  weight: ["800", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
  fallback: ["Arial", "sans-serif"],
});

const caveat = Caveat({
  weight: "600",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-caveat",
  fallback: ["cursive"],
});

export const metadata: Metadata = {
  title: "NextOn — everyone plays, no arguments",
  description:
    "The free app that tracks every kid's minutes live and tells the coach when to sub and who. Football and basketball. No account, works offline.",
  applicationName: "NextOn",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NextOn" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // so safe-area insets are available to the sticky bars
  themeColor: "#f6edd9", // the album paper — the browser chrome joins the page
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${caveat.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
