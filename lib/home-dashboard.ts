import type { Achievement } from "./achievements";
import type { DeckRecord } from "./data";

// Pure selectors: no storage, networking or catalogue imports in the homepage's initial bundle.
export function closestUnfinishedAchievements(achievements: readonly Achievement[], count = 3) {
  return achievements
    .filter((item) => !item.unlocked && item.target > 0 && Number.isFinite(item.current))
    .sort((a, b) => {
      const aRemaining = Math.max(0, a.target - a.current);
      const bRemaining = Math.max(0, b.target - b.current);
      return (b.current / b.target) - (a.current / a.target)
        || aRemaining - bRemaining
        || a.name.localeCompare(b.name);
    })
    .slice(0, count);
}

type ManagedCandidate = {
  source: { kind: string };
  deck: DeckRecord;
};

export type FeaturedCommunityDeck = {
  id: string;
  name: string;
  creator: string;
  description: string;
  publishedAt: string;
};

// Return only the summary needed to link to the existing public deck page.
// Require a user-published deck, Standard format, and current construction legality.
export function latestLegalStandardCommunityDeck(
  items: readonly ManagedCandidate[],
  isLegal: (deck: DeckRecord) => boolean,
): FeaturedCommunityDeck | null {
  const candidates = items
    .filter(({ source, deck }) => source.kind === "user"
      && deck.visibility === "Public"
      && (deck.format ?? "standard") === "standard"
      && typeof deck.publishedAt === "string"
      && Number.isFinite(Date.parse(deck.publishedAt)))
    .sort((a, b) => Date.parse(b.deck.publishedAt!) - Date.parse(a.deck.publishedAt!)
      || a.deck.id.localeCompare(b.deck.id));

  for (const { deck } of candidates) {
    if (!isLegal(deck)) continue;
    return {
      id: deck.id,
      name: deck.name,
      creator: deck.creator || "Community Brawler",
      description: deck.description || "",
      publishedAt: deck.publishedAt!,
    };
  }
  return null;
}
