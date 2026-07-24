import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Home from "../page";

const screenMetadata: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Dashboard", description: "Your Bakugan Battle Planet decks, results, and next actions." },
  decks: { title: "Deck Library", description: "Create, import, organise, publish, and export Battle Planet decks." },
  builder: { title: "Deck Builder", description: "Build and analyse a legal Bakugan Battle Planet deck." },
  compendium: { title: "Card & Rules Compendium", description: "Browse Battle Planet cards, glossary entries, and published rulings." },
  history: { title: "History & Replay", description: "Open your recorded Bakugan Battle Planet match results." },
  profile: { title: "Brawler Profile", description: "Manage your Brawler identity and public decks." },
  settings: { title: "Settings", description: "Manage accessibility, privacy, storage, sync, and account preferences." },
  play: { title: "Play", description: "Configure a training or online Bakugan Battle Planet match." },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ screen?: string[] }>;
}): Promise<Metadata> {
  const segments = (await params).screen ?? [];
  const screen = segments[0] ?? "dashboard";
  const item = screenMetadata[screen] ?? {
    title: "Page not found",
    description: "The requested Bakugan Battle Planet Online screen could not be found.",
  };
  const cardName = screen === "compendium" && segments[1] === "cards" && segments[2]
    ? segments[2].replaceAll("-", " ")
    : "";
  return {
    title: `${cardName || item.title} | Bakugan Battle Planet Online`,
    description: cardName ? `Card details and rulings for ${cardName}.` : item.description,
  };
}

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ screen?: string[] }>;
}) {
  const segments = (await params).screen ?? [];
  const validRoot = new Set(["dashboard", "decks", "builder", "compendium", "history", "profile", "settings", "play"]);
  if (!segments[0] || !validRoot.has(segments[0])) notFound();
  return <Home />;
}
