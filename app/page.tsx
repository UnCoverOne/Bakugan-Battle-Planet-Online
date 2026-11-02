import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
};

// Intentionally empty: the homepage and its surrounding interface will be designed from zero.
export default function HomePage() {
  return <div className="home-rebuild-blank" />;
}
