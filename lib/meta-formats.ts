export type LobbyMeta = "battle-brawlers" | "armored-alliance" | "geogan-rising" | "unlimited";

/**
 * Expansion codes used by constructed-play metas. GR/GG are intentionally
 * reserved here before their catalogue rows exist so adding those sets later
 * does not require another lobby/meta migration.
 */
export type MetaSetCode =
  | "BB"
  | "BR"
  | "AA"
  | "EX"
  | "AV"
  | "FF"
  | "SV"
  | "DI"
  | "GR"
  | "GG"
  | "CP"
  | "PS1";

export type MetaDefinition = {
  id: LobbyMeta;
  name: string;
  allowedSets: readonly MetaSetCode[] | "all";
};

export const DEFAULT_META: LobbyMeta = "battle-brawlers";

export const META_DEFINITIONS: Readonly<Record<LobbyMeta, MetaDefinition>> = Object.freeze({
  "battle-brawlers": Object.freeze({
    id: "battle-brawlers",
    name: "Battle Brawlers",
    allowedSets: Object.freeze(["BB", "BR", "AA", "EX"] as const),
  }),
  "armored-alliance": Object.freeze({
    id: "armored-alliance",
    name: "Armored Alliance",
    allowedSets: Object.freeze(["BB", "BR", "AA", "EX", "AV", "FF", "SV", "DI"] as const),
  }),
  "geogan-rising": Object.freeze({
    id: "geogan-rising",
    name: "Geogan Rising",
    allowedSets: Object.freeze(["BB", "BR", "AA", "EX", "AV", "FF", "SV", "DI", "GR", "GG", "CP"] as const),
  }),
  unlimited: Object.freeze({
    id: "unlimited",
    name: "Unlimited",
    allowedSets: "all" as const,
  }),
});

export const LOBBY_METAS = Object.freeze(Object.values(META_DEFINITIONS));

export function isLobbyMeta(value: unknown): value is LobbyMeta {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(META_DEFINITIONS, value);
}

export function metaName(meta: LobbyMeta) {
  return META_DEFINITIONS[meta].name;
}

export function metaSetCodeFromCatalogId(catalogId: string): MetaSetCode | null {
  const match = /^([a-z0-9]+)-/i.exec(catalogId.trim());
  if (!match) return null;
  const code = match[1].toUpperCase();
  return (["BB", "BR", "AA", "EX", "AV", "FF", "SV", "DI", "GR", "GG", "CP", "PS1"] as const)
    .find((candidate) => candidate === code) ?? null;
}

export function metaAllowsSet(meta: LobbyMeta, setCode: MetaSetCode) {
  const allowed = META_DEFINITIONS[meta].allowedSets;
  return allowed === "all" || allowed.includes(setCode);
}

/** Unknown future catalogue prefixes are accepted only by Unlimited. */
export function metaAllowsCatalogId(meta: LobbyMeta, catalogId: string) {
  if (meta === "unlimited") return true;
  const setCode = metaSetCodeFromCatalogId(catalogId);
  return Boolean(setCode && metaAllowsSet(meta, setCode));
}

export function deckAllowedInMeta(
  meta: LobbyMeta,
  deck: { bakuganIds: readonly string[]; cardIds: readonly string[] },
) {
  return [...deck.bakuganIds, ...deck.cardIds].every((catalogId) => metaAllowsCatalogId(meta, catalogId));
}
