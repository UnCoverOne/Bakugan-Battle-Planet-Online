const ASSET_REVISION = "engine-2026-07-20";
const IMAGE_WIDTHS = [128, 256, 384] as const;

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintedAsset(source: string) {
  if (!source.startsWith("/") || source.startsWith("//") || source.includes("?v=")) return source;
  return `${source}?v=${shortHash(`${ASSET_REVISION}:${source}`)}`;
}

export function optimizedCardSource(source: string, width = 256) {
  if (source.endsWith(".svg")) return fingerprintedAsset(source);
  return `/_vinext/image?url=${encodeURIComponent(fingerprintedAsset(source))}&w=${width}&q=82`;
}

export function responsiveCardSourceSet(source: string) {
  if (source.endsWith(".svg")) return undefined;
  return IMAGE_WIDTHS.map((width) => `${optimizedCardSource(source, width)} ${width}w`).join(", ");
}

