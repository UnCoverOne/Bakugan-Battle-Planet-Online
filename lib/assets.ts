import { BUILD_ID } from "./build";

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
  return `${source}${separator}v=${shortHash(`${BUILD_ID}:${source}`)}`;
}
