import { BAKUGAN, CARD_BY_ID, CORES, type DeckFormat, type DeckRecord } from "./data";
import { DECK_CODE_PREFIX_V2, decodeDeckCodeV2, encodeDeckCodeV2 } from "./deck-code-v2";

export const DECK_LIMIT = 50;
export const DECK_CODE_PREFIX = DECK_CODE_PREFIX_V2;
export const LEGACY_DECK_CODE_PREFIX = "BBP1.";
const MAX_IMPORT_CODE_LENGTH = 100_000;

type DeckCodePayload = {
  schema: 1;
  exportedAt: string;
  deck: Pick<DeckRecord, "name" | "bakuganIds" | "coreIds" | "cardIds" | "visibility" | "format" | "leadCardId" | "description" | "printingPreferences">;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cleanName(value: unknown) {
  if (typeof value !== "string") throw new Error("The deck code has no valid deck name.");
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  if (!name) throw new Error("The deck name cannot be blank.");
  return name;
}

function cleanIds(value: unknown, label: string, allowed: Set<string>, exact?: number) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a list of catalogue IDs.`);
  }
  const ids = value.map(String);
  if (exact != null && ids.length !== exact) throw new Error(`${label} must contain exactly ${exact} entries.`);
  const invalid = ids.filter((id) => !allowed.has(id));
  if (invalid.length) throw new Error(`${label} contains unknown catalogue ID${invalid.length === 1 ? "" : "s"}: ${invalid.slice(0, 4).join(", ")}.`);
  return ids;
}

function cleanDeckPrintingPreferences(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  const entries = Object.entries(value);
  if (entries.length > 120) return undefined;
  for (const [key, id] of entries) {
    if (key.length > 300 || typeof id !== "string" || id.length > 160) continue;
    if (key.startsWith("card:") && CARD_BY_ID.has(id)) result[key] = id;
    else if (key.startsWith("core:") && CORES.some(core =>
      key === `core:${core.id}` && (id === (core.catalogId ?? core.id) || core.printings?.some(print => print.id === id))
    )) result[key] = id;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * All newly shared codes use compact BBP2. The older BBP1 decoder stays in
 * place so existing posts and archived codes remain importable.
 */
export function encodeDeckCode(deck: DeckRecord) {
  return encodeDeckCodeV2(deck);
}

export function decodeDeckCode(code: string, createId: () => string): DeckRecord {
  if (code.length > MAX_IMPORT_CODE_LENGTH) throw new Error("Deck code is too long.");
  const compact = code.trim().replace(/\s+/g, "");
  if (compact.startsWith(DECK_CODE_PREFIX_V2)) return decodeDeckCodeV2(compact, createId);
  if (!compact.startsWith(LEGACY_DECK_CODE_PREFIX)) {
    throw new Error("Unsupported deck-code format. Expected a BBP2. or BBP1. prefix.");
  }
  let payload: DeckCodePayload;
  try {
    payload = JSON.parse(textDecoder.decode(base64UrlToBytes(compact.slice(LEGACY_DECK_CODE_PREFIX.length)))) as DeckCodePayload;
  } catch {
    throw new Error("The deck code is damaged or incomplete.");
  }
  if (payload?.schema !== 1 || !payload.deck || typeof payload.deck !== "object") {
    throw new Error("This deck-code version is not supported.");
  }
  const format: DeckFormat = payload.deck.format === "singleton" || payload.deck.format === "competitive"
    ? payload.deck.format : "standard";
  const now = new Date().toISOString();
  const bakuganIds = cleanIds(payload.deck.bakuganIds, "Bakugan Team", new Set(BAKUGAN.map(item => item.id)), 3);
  const coreIds = cleanIds(payload.deck.coreIds, "BakuCore kit", new Set(CORES.map(item => item.id)), 6);
  // Legacy Competitive exports may contain more than 40 cards; the actual
  // format-specific size is checked by the caller using the current ruleset.
  const cardIds = cleanIds(payload.deck.cardIds, "Main Deck", new Set(CARD_BY_ID.keys()));
  if (cardIds.length > 200) throw new Error("Main Deck contains too many cards.");
  return {
    id: createId(),
    name: cleanName(payload.deck.name),
    bakuganIds,
    coreIds,
    cardIds,
    factions: [...new Set(bakuganIds.flatMap(id => {
      const character = BAKUGAN.find(item => item.id === id)!;
      return character.character.factions?.length ? character.character.factions : [character.faction];
    }))],
    visibility: payload.deck.visibility === "Public" ? "Public" : "Private",
    format,
    updatedAt: now,
    revision: 1,
    leadCardId: typeof payload.deck.leadCardId === "string" && cardIds.includes(payload.deck.leadCardId)
      ? payload.deck.leadCardId : cardIds[0],
    description: typeof payload.deck.description === "string" ? payload.deck.description.slice(0, 500) : undefined,
    printingPreferences: cleanDeckPrintingPreferences(payload.deck.printingPreferences),
  };
}

export function uniqueDeckName(name: string, decks: Pick<DeckRecord, "name">[]) {
  const existing = new Set(decks.map((deck) => deck.name.trim().toLocaleLowerCase()));
  if (!existing.has(name.trim().toLocaleLowerCase())) return name.trim();
  let index = 2;
  while (existing.has(`${name.trim()} (${index})`.toLocaleLowerCase())) index += 1;
  return `${name.trim()} (${index})`;
}

export function formatDeckTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function deckTextList(deck: DeckRecord) {
  const counts = new Map<string, number>();
  for (const id of deck.cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const lines = [
    deck.name,
    `Format: ${deck.format ?? "standard"}`,
    `Visibility: ${deck.visibility}`,
    `Updated: ${deck.updatedAt}`,
    "",
    "Bakugan Team",
    ...deck.bakuganIds.map((id) => `1 ${BAKUGAN.find((item) => item.id === id)?.name ?? id}`),
    "",
    "BakuCores",
    ...deck.coreIds.map((id) => `1 ${CORES.find((item) => item.id === id)?.name ?? id}`),
    "",
    "Main Deck",
    ...[...counts.entries()]
      .map(([id, count]) => `${count} ${CARD_BY_ID.get(id)?.displayName ?? id}`)
      .sort((left, right) => left.localeCompare(right)),
  ];
  return lines.join("\n");
}
