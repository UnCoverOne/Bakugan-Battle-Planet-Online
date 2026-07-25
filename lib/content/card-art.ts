import type { GameCard } from "../game";

export const CARD_ART_PLACEHOLDER = "/assets/cards/card-missing.svg";
export type CardArtVariant = "full" | "thumbnail";

/**
 * Resolves the correct image source for a card without assuming that collector
 * numbers are globally unique. Battle Brawlers scans have local full/thumbnail
 * pairs; BR and AA scans use their canonical remote MediaWiki file redirect.
 */
export function cardArtSource(
  card: Pick<GameCard, "art" | "hasProvidedScan">,
  variant: CardArtVariant = "full",
) {
  const source = card.art || CARD_ART_PLACEHOLDER;
  if (
    variant === "thumbnail"
    && card.hasProvidedScan
    && source.startsWith("/assets/cards/full/")
  ) {
    return source.replace("/assets/cards/full/", "/assets/cards/thumb/");
  }
  return source;
}
