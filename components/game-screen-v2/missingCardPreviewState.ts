const PLACEHOLDER_ART_PATHS = [
  "/assets/cards/card-missing.svg",
  "/assets/cards/missing.svg",
];

function sourcePathname(source: string): string {
  if (!source) return "";
  try {
    return new URL(source, "https://bakugan-preview.invalid").pathname;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "";
  }
}

export function cardArtworkUnavailable(
  source: string,
  imageComplete = false,
  naturalWidth = 1,
) {
  const pathname = sourcePathname(source).toLowerCase();
  if (!pathname) return true;
  if (PLACEHOLDER_ART_PATHS.some((path) => pathname.endsWith(path))) return true;
  return imageComplete && naturalWidth <= 0;
}
