import type { Metadata } from "next";
import "./globals.css";
import "./card-art-transparency.css";
import "./route-shell.css";
import "./website-overhaul.css";
import "./home-layout.css";
import "./home-fidelity.css";
import "./home-polish.css";
import "./interface-refinements.css";
import "./site-consistency.css";
import { AppProvider } from "../components/application/AppProvider";
import { AppShell } from "../components/application/AppShell";
import { DisplayFontLoader } from "../components/application/DisplayFontLoader";
import { AssetFreshness } from "../components/AssetFreshness";
import { WebVitalsReporter } from "../components/WebVitalsReporter";
import { DeckInspectionHost } from "../components/game-screen-v2/DeckInspectionHost";

export const metadata: Metadata = {
  title: {
    default: "Bakugan Battle Planet Online",
    template: "%s | Bakugan Battle Planet Online",
  },
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DisplayFontLoader />
        <AssetFreshness />
        <WebVitalsReporter />
        <AppProvider>
          <AppShell>{children}</AppShell>
          <DeckInspectionHost />
        </AppProvider>
      </body>
    </html>
  );
}
