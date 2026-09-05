import type { GameCard } from "../game";

export const CARD_ART_PLACEHOLDER = "/assets/cards/card-missing.svg";
export type CardArtVariant = "full" | "thumbnail";
export type CardArtOrientation = "portrait" | "landscape";

/*
 * Most supplied scans use the normal portrait card silhouette. A small set
 * of Flip scans were supplied as sideways scans, however, so orientation is
 * part of the asset contract rather than something inferred from card type.
 * Keep this list alongside the committed assets; it is intentionally based
 * on stable source paths so the layout is correct before an image decodes.
 */
const LANDSCAPE_CARD_ART = [
  /^\/assets\/cards\/(?:full|thumb)\/(?:13[89]|1[4-7]\d|18[0-6])\.webp$/,
  /^\/assets\/cards\/sets\/aa\/(?:full|thumb)\/aa-(?:51|53|5[6-9]|6[0-6])\.webp$/,
  /^\/assets\/cards\/sets\/br\/(?:full|thumb)\/br-(?:6[0-9]|7[0-6])\.webp$/,
];

function sourcePathname(source: string): string {
  if (!source) return "";
  try {
    return new URL(source, "https://bakugan-card-art.invalid").pathname;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "";
  }
}

export function cardArtOrientation(source: string): CardArtOrientation {
  const pathname = sourcePathname(source);
  return LANDSCAPE_CARD_ART.some((pattern) => pattern.test(pathname))
    ? "landscape"
    : "portrait";
}

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
