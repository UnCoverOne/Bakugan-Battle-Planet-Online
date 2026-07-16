import type { Metadata } from "next";
import "@fontsource/lato/latin-400.css";
import "@fontsource/lato/latin-400-italic.css";
import "@fontsource/lato/latin-700.css";
import "@fontsource/lato/latin-700-italic.css";
import "@fontsource/titillium-web/latin-400.css";
import "@fontsource/titillium-web/latin-400-italic.css";
import "@fontsource/titillium-web/latin-700.css";
import "@fontsource/titillium-web/latin-700-italic.css";
import "./globals.css";
import "./design-system.css";
import { NewGameScreenTester } from "../components/game-screen-v2/NewGameScreenTester";

export const metadata: Metadata = {
  title: "Bakugan Battle Planet Online",
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
  other: {
    "codex-preview": "development",
  },
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
      <body>{children}<NewGameScreenTester /></body>
    </html>
  );
}
