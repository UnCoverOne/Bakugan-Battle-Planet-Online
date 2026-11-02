import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Home",
  description: "Play Bakugan Battle Planet matches, build decks, and explore the card compendium.",
};

// First structural pass: no custom imagery, decorative sections or data requests.
export default function HomePage() {
  return (
    <div className="bbp-foundation-page">
      <section className="bbp-foundation-intro" aria-labelledby="bbp-foundation-title">
        <h1 id="bbp-foundation-title">Bakugan Battle Planet Online</h1>
        <p>Play matches, manage your decks, and explore the card catalogue.</p>
        <nav className="bbp-foundation-quick-links" aria-label="Get started">
          <Link href="/play">Play a match</Link>
          <Link href="/decks">My decks</Link>
          <Link href="/compendium">Card compendium</Link>
        </nav>
      </section>
    </div>
  );
}
