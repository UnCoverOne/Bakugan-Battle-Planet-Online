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
import "./deck-builder-layout.css";
import "./guest-experience.css";
import "./guest-overrides.css";
import "./recovery-code.css";
import { AppProvider } from "../components/application/AppProvider";
import { AppShell } from "../components/application/AppShell";
import { DisplayFontLoader } from "../components/application/DisplayFontLoader";
import { GuestExperienceController } from "../components/application/GuestExperienceController";
import { AssetFreshness } from "../components/AssetFreshness";
import { WebVitalsReporter } from "../components/WebVitalsReporter";

export const metadata: Metadata = {
  title: {
    default: "Bakugan Battle Planet Online",
    template: "%s | Bakugan Battle Planet Online",
  },
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
  icons: {
    icon: { url: "/assets/logo.png", type: "image/png" },
    shortcut: "/assets/logo.png",
    apple: { url: "/assets/logo.png", type: "image/png" },
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
          <GuestExperienceController />
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
