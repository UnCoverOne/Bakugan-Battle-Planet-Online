import { BAKUGAN, CARD_BY_ID, CORES, type DeckFormat, type DeckRecord } from "./data";

export const DECK_LIMIT = 50;
export const DECK_CODE_PREFIX = "BBP1.";

type DeckCodePayload = {
  schema: 1;
  exportedAt: string;
  deck: Pick<DeckRecord, "name" | "bakuganIds" | "coreIds" | "cardIds" | "visibility" | "format" | "leadCardId" | "description">;
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

export function encodeDeckCode(deck: DeckRecord) {
  const payload: DeckCodePayload = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    deck: {
      name: cleanName(deck.name),
      bakuganIds: [...deck.bakuganIds],
      coreIds: [...deck.coreIds],
      cardIds: [...deck.cardIds],
      visibility: deck.visibility,
      format: deck.format ?? "standard",
      leadCardId: deck.leadCardId,
      description: deck.description,
    },
  };
  return `${DECK_CODE_PREFIX}${bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)))}`;
}

export function decodeDeckCode(code: string, createId: () => string): DeckRecord {
  const compact = code.trim().replace(/\s+/g, "");
  if (!compact.startsWith(DECK_CODE_PREFIX)) {
    throw new Error(`Unsupported deck-code format. Expected a ${DECK_CODE_PREFIX} version prefix.`);
  }
  let payload: DeckCodePayload;
  try {
    payload = JSON.parse(textDecoder.decode(base64UrlToBytes(compact.slice(DECK_CODE_PREFIX.length)))) as DeckCodePayload;
  } catch {
    throw new Error("The deck code is damaged or incomplete.");
  }
  if (payload?.schema !== 1 || !payload.deck || typeof payload.deck !== "object") {
    throw new Error("This deck-code version is not supported.");
  }
  const format: DeckFormat = payload.deck.format === "singleton" ? "singleton" : "standard";
  const now = new Date().toISOString();
  const bakuganIds = cleanIds(payload.deck.bakuganIds, "Bakugan Team", new Set(BAKUGAN.map((item) => item.id)), 3);
  return {
    id: createId(),
    name: cleanName(payload.deck.name),
    bakuganIds,
    coreIds: cleanIds(payload.deck.coreIds, "BakuCore kit", new Set(CORES.map((item) => item.id)), 6),
    cardIds: cleanIds(payload.deck.cardIds, "Main Deck", new Set(CARD_BY_ID.keys()), 40),
    factions: [...new Set(bakuganIds.map((id) => BAKUGAN.find((item) => item.id === id)!.faction))],
    visibility: payload.deck.visibility === "Public" ? "Public" : "Private",
    format,
    updatedAt: now,
    revision: 1,
    leadCardId: typeof payload.deck.leadCardId === "string" && payload.deck.cardIds.includes(payload.deck.leadCardId) ? payload.deck.leadCardId : payload.deck.cardIds[0],
    description: typeof payload.deck.description === "string" ? payload.deck.description.slice(0, 500) : undefined,
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
