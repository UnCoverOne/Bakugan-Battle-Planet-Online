import type { Metadata } from "next";
import "./blank-slate.css";
import "./design-system.css";
import { AccountHistorySync } from "../components/application/AccountHistorySync";
import { AppProvider } from "../components/application/AppProvider";
import { AppShell } from "../components/application/AppShell";
import { GuestExperienceController } from "../components/application/GuestExperienceController";
import { PublicDeckFallbackSync } from "../components/application/PublicDeckFallbackSync";
import { AssetFreshness } from "../components/AssetFreshness";
import { WebVitalsReporter } from "../components/WebVitalsReporter";

export const metadata: Metadata = {
  title: {
    default: "Bakugan Battle Planet Online",
    template: "%s | Bakugan Battle Planet Online",
  },
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AssetFreshness />
        <WebVitalsReporter />
        <AppProvider>
          <PublicDeckFallbackSync />
          <AccountHistorySync />
          <GuestExperienceController />
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
