import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Game Screen Lab",
  robots: {
    index: false,
    follow: false,
  },
};

export default function GameScreenLabLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
