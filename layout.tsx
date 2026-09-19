import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "APEX Signal Engine · XAU · BTC · EUR · JPY",
  description:
    "Institutional-grade multi-timeframe signal engine with live candles, chart-derived Entry/SL/TP and instant browser + mobile alerts.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "APEX Signals", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
