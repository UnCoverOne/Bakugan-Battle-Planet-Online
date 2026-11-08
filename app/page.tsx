import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "Bakugan Battle Planet Online.",
};

// Intentionally blank. Navigation is provided by the application shell.
export default function HomePage() {
  return <div className="home-rebuild-blank" />;
}
