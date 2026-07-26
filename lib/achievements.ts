import type { DeckRecord } from "./data";

export type Achievement = {
  id: string;
  name: string;
  description: string;
  category: "Getting Started" | "Deck Building" | "Battle" | "Compendium" | "Online Play";
  current: number;
  target: number;
  unlocked: boolean;
};

export function achievementsFor(decks: DeckRecord[], history: Array<{ result?: string; mode?: string }>): Achievement[] {
  const wins = history.filter((record) => record.result === "Victor").length;
  const publicDecks = decks.filter((deck) => deck.visibility === "Public").length;
  const onlineGames = history.filter((record) => record.mode === "online").length;
  const completeDecks = decks.filter((deck) => deck.cardIds.length === 40 && deck.bakuganIds.length === 3 && deck.coreIds.length === 6).length;
  const definitions = [
    ["first-deck", "Battle Ready", "Complete your first legal-sized deck.", "Deck Building", completeDecks, 1],
    ["deck-builder", "Arsenal Architect", "Complete three decks.", "Deck Building", completeDecks, 3],
    ["first-brawl", "Enter the Brawl", "Finish your first game.", "Getting Started", history.length, 1],
    ["first-win", "First Victory", "Win your first game.", "Battle", wins, 1],
    ["veteran", "Seasoned Brawler", "Win ten games.", "Battle", wins, 10],
    ["publisher", "Share the Strategy", "Publish a deck to the Public Deck Library.", "Deck Building", publicDecks, 1],
    ["online", "Connected Brawler", "Complete an online game.", "Online Play", onlineGames, 1],
  ] as const;
  return definitions.map(([id, name, description, category, current, target]) => ({
    id, name, description, category, current: Math.min(current, target), target, unlocked: current >= target,
  }));
}
