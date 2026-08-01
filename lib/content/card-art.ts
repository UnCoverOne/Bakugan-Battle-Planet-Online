import type { GameCard } from "../game";

export const CARD_ART_PLACEHOLDER = "/assets/cards/card-missing.svg";
export type CardArtVariant = "full" | "thumbnail";

/**
 * Resolves the correct image source for a card without assuming that collector
 * numbers are globally unique. Every supplied scan is served from this site's
 * own assets, with separate full and thumbnail variants for each card set.
 */
export function cardArtSource(
  card: Pick<GameCard, "art" | "hasProvidedScan">,
  variant: CardArtVariant = "full",
) {
  const source = card.art || CARD_ART_PLACEHOLDER;
  if (
    variant === "thumbnail"
    && card.hasProvidedScan
    && (
      source.startsWith("/assets/cards/full/")
      || /^\/assets\/cards\/sets\/(?:br|aa|ex)\/full\//.test(source)
    )
  ) {
    return source.replace("/full/", "/thumb/");
  }
  return source;
}
