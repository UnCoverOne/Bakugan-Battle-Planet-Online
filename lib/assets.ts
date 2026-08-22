const ASSET_REVISION = "engine-2026-07-20";

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
