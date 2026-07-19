export type CardPreviewKind = "face" | "back";
export type CardPreviewSide = "left" | "right";
export type CardPreviewOrigin = "board" | "hand";
export type CardPreviewZoneOwner = "player" | "opponent";

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
 * Fixed playmat zones should not change preview side while their artwork lifts,
 * scales, or is remeasured during hover. The local player's zones live on the
 * left and preview on the right; the opponent's zones do the inverse.
 */
export function cardPreviewSideForZoneOwner(
  owner: string | null | undefined,
): CardPreviewSide | null {
  if (owner === "player") return "right";
  if (owner === "opponent") return "left";
  return null;
}

export function cardPreviewSide(
  sourceCenterX: number,
  viewportWidth: number,
  origin: CardPreviewOrigin = "board",
): CardPreviewSide {
  // Hand cards always use one stable preview location. This prevents the
  // preview from jumping between sides while the pointer crosses the fan.
  if (origin === "hand") return "left";

  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const center = Number.isFinite(sourceCenterX) ? sourceCenterX : width / 2;
  return center <= width / 2 ? "right" : "left";
}
