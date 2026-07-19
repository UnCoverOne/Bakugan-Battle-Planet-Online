export type CardPreviewKind = "face" | "back";

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
