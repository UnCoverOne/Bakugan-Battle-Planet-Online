import { BUILD_ID } from "./build";
declare const __BBP_ASSET_REVISIONS__: Record<string, string>;

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
  const separator = source.includes("?") ? "&" : "?";
  const path = source.split("?")[0];
  const directory = path.slice(0, path.lastIndexOf("/"));
  const revision = typeof __BBP_ASSET_REVISIONS__ === "object" ? __BBP_ASSET_REVISIONS__[directory] : undefined;
  return `${source}${separator}v=${revision ?? shortHash(`${BUILD_ID}:${source}`)}`;
}
