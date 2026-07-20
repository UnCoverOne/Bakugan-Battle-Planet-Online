export type CardPreviewKind = "face" | "back";
export type CardPreviewSide = "left" | "right";

const CARD_FACE_PATH = "/assets/cards/full/";
const CARD_BACK_PATH = "/assets/card-back.png";
const EXCLUDED_PREVIEW_ZONES = new Set(["deck", "energy"]);

function sourcePathname(source: string): string {
  if (!source) return "";
  try {
    return new URL(source, "https://bakugan-preview.invalid").pathname;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "";
  }
}

export function cardPreviewKind(source: string): CardPreviewKind | null {
  const pathname = sourcePathname(source);
  if (pathname.includes(CARD_FACE_PATH)) return "face";
  if (pathname.endsWith(CARD_BACK_PATH)) return "back";
  return null;
}

export function cardPreviewZoneAllowed(zoneKind: string | null | undefined): boolean {
  return !zoneKind || !EXCLUDED_PREVIEW_ZONES.has(zoneKind);
}

/**
 * Preview placement is determined only by stable zone metadata. It never reads
 * pointer coordinates, card rectangles, transforms, or viewport halves.
 */
export function cardPreviewSideForZone(
  zoneKind: string | null | undefined,
  zoneOwner: string | null | undefined,
): CardPreviewSide {
  if (zoneKind === "character-card") {
    return zoneOwner === "player" ? "right" : "left";
  }
  if (zoneKind === "discard-pile" || zoneKind === "discard-browser") {
    return zoneOwner === "opponent" ? "right" : "left";
  }
  if (zoneKind === "hero") {
    return zoneOwner === "opponent" ? "right" : "left";
  }
  if (zoneKind === "hand" || zoneKind === "batch") return "left";
  return "left";
}
