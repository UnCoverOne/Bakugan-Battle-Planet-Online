import type { Metadata } from "next";
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400;1,700&family=Titillium+Web:ital,wght@0,400;0,700;1,400;1,700&display=swap"
        />
      </head>
      <body>{children}<NewGameScreenTester /></body>
    </html>
  );
}
