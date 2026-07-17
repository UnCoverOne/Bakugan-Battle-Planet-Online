export type CardPreviewKind = "face" | "back";
export type CardPreviewSide = "left" | "right";
export type CardPreviewOrigin = "board" | "hand";

const CARD_FACE_PATH = "/assets/cards/full/";
const CARD_BACK_PATH = "/assets/card-back.png";
const EXCLUDED_PREVIEW_ZONES = new Set(["deck", "discard-pile"]);

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
