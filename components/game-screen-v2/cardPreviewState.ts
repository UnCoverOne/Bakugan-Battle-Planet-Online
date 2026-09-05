export type CardPreviewKind = "face" | "back";
export type CardPreviewSide = "left" | "right";
export type CardPreviewOrientation = "vertical" | "horizontal" | "core";
export type CardPreviewZoneKind =
  | "character-card"
  | "hand"
  | "discard-pile"
  | "discard-browser"
  | "hero"
  | "batch"
  | "bakucore";

export type CardPreviewOwnership = Readonly<{
  targetId: string;
  generation: number;
}>;

export const EMPTY_CARD_PREVIEW_OWNERSHIP: CardPreviewOwnership = {
  targetId: "",
  generation: 0,
};

const CARD_FACE_PATH = "/assets/cards/full/";
const CARD_BACK_PATH = "/assets/card-back.png";
const ALLOWED_PREVIEW_ZONES = new Set<CardPreviewZoneKind>([
  "character-card",
  "hand",
  "discard-pile",
  "discard-browser",
  "hero",
  "batch",
  "bakucore",
]);

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

/**
 * Unknown elements are deliberately rejected. A preview can be created only
 * from one of the explicitly supported card or revealed-BakuCore zones.
 */
export function cardPreviewZoneAllowed(
  zoneKind: string | null | undefined,
): zoneKind is CardPreviewZoneKind {
  return Boolean(zoneKind && ALLOWED_PREVIEW_ZONES.has(zoneKind as CardPreviewZoneKind));
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
  if (zoneKind === "hand" || zoneKind === "batch" || zoneKind === "bakucore") {
    return "left";
  }
  return "left";
}

export function cardPreviewOrientation(
  cardType: string | null | undefined,
): CardPreviewOrientation {
  void cardType;
  return "vertical";
}

/**
 * Every target change advances a generation. Asynchronous artwork work may
 * commit only when both the target and generation still match.
 */
export function activateCardPreviewTarget(
  ownership: CardPreviewOwnership,
  targetId: string,
): CardPreviewOwnership {
  if (ownership.targetId === targetId) return ownership;
  return {
    targetId,
    generation: ownership.generation + 1,
  };
}

export function releaseCardPreviewTarget(
  ownership: CardPreviewOwnership,
  targetId: string,
): CardPreviewOwnership {
  if (!targetId || ownership.targetId !== targetId) return ownership;
  return {
    targetId: "",
    generation: ownership.generation + 1,
  };
}

export function clearCardPreviewTarget(
  ownership: CardPreviewOwnership,
): CardPreviewOwnership {
  return {
    targetId: "",
    generation: ownership.generation + 1,
  };
}

export function cardPreviewRequestIsCurrent(
  ownership: CardPreviewOwnership,
  targetId: string,
  generation: number,
): boolean {
  return ownership.targetId === targetId && ownership.generation === generation;
}
