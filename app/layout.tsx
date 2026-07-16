import type { Metadata } from "next";
import { Lato, Titillium_Web } from "next/font/google";
import "./globals.css";
import "./design-system.css";
import { NewGameScreenTester } from "../components/game-screen-v2/NewGameScreenTester";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-lato",
});

const titilliumWeb = Titillium_Web({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-titillium-web",
});

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
    <html lang="en" className={`${lato.variable} ${titilliumWeb.variable}`}>
      <body>{children}<NewGameScreenTester /></body>
    </html>
  );
}
