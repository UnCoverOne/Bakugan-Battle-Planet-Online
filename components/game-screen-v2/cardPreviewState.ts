export type CardPreviewKind = "face" | "back";
export type CardPreviewSide = "left" | "right";

const CARD_FACE_PATH = "/assets/cards/full/";
const CARD_BACK_PATH = "/assets/card-back.png";

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

export function cardPreviewSide(
  sourceCenterX: number,
  viewportWidth: number,
): CardPreviewSide {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const center = Number.isFinite(sourceCenterX) ? sourceCenterX : width / 2;
  return center <= width / 2 ? "right" : "left";
}
