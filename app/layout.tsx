import type { Metadata } from "next";
import "./globals.css";
import "./design-system.css";
import "./card-art-transparency.css";
import { AssetFreshness } from "../components/AssetFreshness";
import { ServiceWorkerRegistration } from "../components/ServiceWorkerRegistration";
import { WebVitalsReporter } from "../components/WebVitalsReporter";

export const metadata: Metadata = {
  title: "Bakugan Battle Planet Online",
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AssetFreshness />
        <ServiceWorkerRegistration />
        <WebVitalsReporter />
        {children}
      </body>
    </html>
  );
}
