import { BAKUGAN, CARD_BY_ID, CORES, type DeckFormat, type DeckRecord } from "./data";
import { cardPrintingKey, corePrintingKey, preferredCardPrinting } from "./deck-printings";

/**
 * BBP2: portable, deterministic, binary deck recipe.
 *
 * The prefixes below are a PERMANENT wire-format registry. Never reorder or
 * renumber an entry; append future card sets to vacant tag values only.
 * Card numbers and core numbers come from stable catalogue IDs, never the
 * current order of the catalogue array. Non-numeric IDs use a literal escape.
 *
 * Layout (all numbers are unsigned base-128 varints unless indicated):
 *   1 byte: format (0 Standard, 1 Singleton, 2 Competitive)
 *   Character count, ordered Character IDs
 *   BakuCore count, ordered BakuCore IDs
 *   unique Main Deck ID count, repeated (ID, copy count) pairs
 *   printing preference count, repeated (kind, source ID, printing ID)
 *   CRC-32 of all preceding bytes (little endian, four bytes)
 * The BBP2. prefix is outside the binary data.
 */
export const DECK_CODE_PREFIX_V2 = "BBP2.";

const CARD_SET_TAGS = ["bb", "br", "aa", "av", "ff", "di", "ps1", "sv", "cp", "ex"] as const;
const SET_TAG_BY_PREFIX = new Map<string, number>(CARD_SET_TAGS.map((prefix, index) => [prefix, index]));
const FORMATS: readonly DeckFormat[] = ["standard", "singleton", "competitive"];
const MAX_CHARACTER_COUNT = 3;
const MAX_CORE_COUNT = 6;
const MAX_MAIN_CARDS = 200; // Safety ceiling, not a format's required deck size.
const MAX_PREFERENCES = 120;
const MAX_STRING_BYTES = 160;
const MAX_V2_CODE_LENGTH = 4096;
const MAX_VARINT = 0xffffffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function damaged(): never {
  throw new Error("The deck code is damaged or incomplete.");
}

function writeVarint(output: number[], value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VARINT) throw new Error("Invalid deck-code number.");
  let remaining = value;
  while (remaining >= 128) {
    output.push((remaining % 128) + 128);
    remaining = Math.floor(remaining / 128);
  }
  output.push(remaining);
}

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  byte(): number {
    if (this.offset >= this.bytes.length) return damaged();
    return this.bytes[this.offset++];
  }
  varint(): number {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.byte();
      value += (byte & 127) * scale;
      if (value > MAX_VARINT) return damaged();
      if (byte < 128) return value;
      scale *= 128;
    }
    return damaged();
  }
  text(): string {
    const length = this.varint();
    if (!length || length > MAX_STRING_BYTES || this.offset + length > this.bytes.length) return damaged();
    const bytes = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    try { return decoder.decode(bytes); } catch { return damaged(); }
  }
  complete() { if (this.offset !== this.bytes.length) damaged(); }
}

function writeText(output: number[], value: string) {
  const bytes = encoder.encode(value);
  if (bytes.length < 1 || bytes.length > MAX_STRING_BYTES) throw new Error("Invalid deck catalogue identifier.");
  writeVarint(output, bytes.length);
  output.push(...bytes);
}

function writeCardId(output: number[], id: string) {
  const match = /^([a-z0-9]+)-([1-9][0-9]*)$/.exec(id);
  const set = match ? SET_TAG_BY_PREFIX.get(match[1]) : undefined;
  const number = match ? Number(match[2]) : NaN;
  if (set !== undefined && Number.isSafeInteger(number) && String(number) === match?.[2]
    && number > 0 && number <= Math.floor(MAX_VARINT / 32)) {
    writeVarint(output, number * 32 + set * 2);
  } else {
    writeVarint(output, 1); // Odd value: literal catalogue ID follows.
    writeText(output, id);
  }
}

function readCardId(reader: Reader): string {
  const token = reader.varint();
  if (token & 1) {
    if (token !== 1) return damaged();
    return reader.text();
  }
  const tag = Math.floor(token / 2) % 16;
  const number = Math.floor(token / 32);
  if (!number || !CARD_SET_TAGS[tag]) return damaged();
  return CARD_SET_TAGS[tag] + "-" + number;
}

function writeCoreId(output: number[], id: string) {
  const aa = /^aa-core-([1-9][0-9]*)$/.exec(id);
  const bb = /^core-([1-9][0-9]*)$/.exec(id);
  const numberText = aa?.[1] ?? bb?.[1];
  const number = Number(numberText);
  if (numberText && Number.isSafeInteger(number) && String(number) === numberText
    && number > 0 && number <= Math.floor(MAX_VARINT / 4)) {
    writeVarint(output, number * 4 + (aa ? 1 : 0));
  } else {
    writeVarint(output, 2); // Future/unknown core ID uses a literal.
    writeText(output, id);
  }
}

function readCoreId(reader: Reader): string {
  const token = reader.varint();
  const kind = token % 4;
  if (kind === 2) {
    if (token !== 2) return damaged();
    return reader.text();
  }
  if (kind > 1 || token < 4) return damaged();
  return (kind === 1 ? "aa-core-" : "core-") + Math.floor(token / 4);
}

function writeCorePrintingId(output: number[], id: string) {
  const match = /^aa-printing-([1-9][0-9]*)$/.exec(id);
  const number = match ? Number(match[1]) : NaN;
  if (match && Number.isSafeInteger(number) && String(number) === match[1]
    && number > 0 && number <= Math.floor(MAX_VARINT / 2)) {
    writeVarint(output, number * 2);
  } else {
    writeVarint(output, 1);
    writeText(output, id);
  }
}

function readCorePrintingId(reader: Reader): string {
  const token = reader.varint();
  if (token & 1) {
    if (token !== 1) return damaged();
    return reader.text();
  }
  if (!token) return damaged();
  return "aa-printing-" + token / 2;
}

function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded: string): Uint8Array {
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return damaged();
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { return damaged(); }
}

type Preference = { kind: 0; source: string; target: string } | { kind: 1; source: string; target: string };

function activePreferences(deck: DeckRecord): Preference[] {
  if (!deck.printingPreferences) return [];
  const preferences: Preference[] = [];
  const seen = new Set<string>();
  for (const id of [...deck.bakuganIds, ...deck.cardIds]) {
    const card = CARD_BY_ID.get(id);
    if (!card) continue;
    const key = cardPrintingKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    const preferredId = deck.printingPreferences[key];
    if (preferredId && preferredId !== id
      && preferredCardPrinting(card, deck.printingPreferences).catalogId === preferredId) {
      preferences.push({ kind: 0, source: id, target: preferredId });
    }
  }
  for (const id of deck.coreIds) {
    const core = CORES.find(item => item.id === id);
    if (!core) continue;
    const key = corePrintingKey(core);
    if (seen.has(key)) continue;
    seen.add(key);
    const preferredId = deck.printingPreferences[key];
    if (preferredId && core.printings?.some(print => print.id === preferredId)) {
      preferences.push({ kind: 1, source: id, target: preferredId });
    }
  }
  if (preferences.length > MAX_PREFERENCES) throw new Error("Too many printing preferences to export.");
  preferences.sort((a, b) => a.kind - b.kind || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return preferences;
}

function assertKnownDeckIds(deck: DeckRecord) {
  if (deck.bakuganIds.length > MAX_CHARACTER_COUNT || deck.coreIds.length > MAX_CORE_COUNT
    || deck.cardIds.length > MAX_MAIN_CARDS) throw new Error("Deck is too large to export.");
  if (deck.bakuganIds.some(id => !BAKUGAN.some(item => item.id === id))
    || deck.coreIds.some(id => !CORES.some(item => item.id === id))
    || deck.cardIds.some(id => !CARD_BY_ID.has(id) || CARD_BY_ID.get(id)?.type === "Character")) {
    throw new Error("Deck contains an unknown or invalid card identifier.");
  }
}

/** Exports only gameplay construction and active non-default artwork choices. */
export function encodeDeckCodeV2(deck: DeckRecord): string {
  assertKnownDeckIds(deck);
  const format = FORMATS.indexOf(deck.format ?? "standard");
  if (format < 0) throw new Error("Unsupported deck format.");
  const output: number[] = [format];
  writeVarint(output, deck.bakuganIds.length);
  for (const id of deck.bakuganIds) writeCardId(output, id);
  writeVarint(output, deck.coreIds.length);
  for (const id of deck.coreIds) writeCoreId(output, id);

  const counts = new Map<string, number>();
  for (const id of deck.cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const grouped = [...counts].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  writeVarint(output, grouped.length);
  for (const [id, count] of grouped) {
    writeCardId(output, id);
    writeVarint(output, count);
  }

  const preferences = activePreferences(deck);
  writeVarint(output, preferences.length);
  for (const preference of preferences) {
    writeVarint(output, preference.kind);
    if (preference.kind === 0) {
      writeCardId(output, preference.source);
      writeCardId(output, preference.target);
    } else {
      writeCoreId(output, preference.source);
      writeCorePrintingId(output, preference.target);
    }
  }
  const bytes = Uint8Array.from(output);
  const result = new Uint8Array(bytes.length + 4);
  result.set(bytes);
  const crc = checksum(bytes);
  for (let index = 0; index < 4; index += 1) result[bytes.length + index] = (crc >>> (index * 8)) & 255;
  const encoded = DECK_CODE_PREFIX_V2 + toBase64Url(result);
  if (encoded.length > MAX_V2_CODE_LENGTH) throw new Error("Deck code exceeds the supported size.");
  return encoded;
}

function requireCard(id: string) {
  const card = CARD_BY_ID.get(id);
  if (!card) throw new Error("Deck code references an unavailable card: " + id);
  return card;
}

function requireCore(id: string) {
  const core = CORES.find(item => item.id === id);
  if (!core) throw new Error("Deck code references an unavailable BakuCore: " + id);
  return core;
}

/** Decodes BBP2 and constructs a new private, unnamed-by-source deck. */
export function decodeDeckCodeV2(code: string, createId: () => string): DeckRecord {
  if (!code.startsWith(DECK_CODE_PREFIX_V2) || code.length > MAX_V2_CODE_LENGTH) return damaged();
  const raw = fromBase64Url(code.slice(DECK_CODE_PREFIX_V2.length));
  if (raw.length < 9) return damaged();
  const payload = raw.subarray(0, raw.length - 4);
  const stored = ((raw[raw.length - 4] | (raw[raw.length - 3] << 8) |
    (raw[raw.length - 2] << 16) | (raw[raw.length - 1] << 24)) >>> 0);
  if (stored !== checksum(payload)) return damaged();
  const reader = new Reader(payload);
  const flag = reader.byte();
  if (flag >= FORMATS.length) return damaged();
  const format = FORMATS[flag];

  const characterCount = reader.varint();
  if (characterCount > MAX_CHARACTER_COUNT) return damaged();
  const bakuganIds: string[] = [];
  for (let index = 0; index < characterCount; index += 1) {
    const id = readCardId(reader);
    if (!BAKUGAN.some(item => item.id === id)) throw new Error("Deck code references an unavailable Character: " + id);
    bakuganIds.push(id);
  }
  const coreCount = reader.varint();
  if (coreCount > MAX_CORE_COUNT) return damaged();
  const coreIds: string[] = [];
  for (let index = 0; index < coreCount; index += 1) {
    const id = readCoreId(reader);
    requireCore(id);
    coreIds.push(id);
  }

  const uniqueCount = reader.varint();
  if (uniqueCount > MAX_MAIN_CARDS) return damaged();
  const cardIds: string[] = [];
  const seenCards = new Set<string>();
  for (let index = 0; index < uniqueCount; index += 1) {
    const id = readCardId(reader);
    const card = requireCard(id);
    if (card.type === "Character" || seenCards.has(id)) return damaged();
    seenCards.add(id);
    const count = reader.varint();
    if (!count || count > MAX_MAIN_CARDS || cardIds.length + count > MAX_MAIN_CARDS) return damaged();
    for (let copy = 0; copy < count; copy += 1) cardIds.push(id);
  }

  const referenceIds = new Set([...bakuganIds, ...cardIds]);
  const selectedCores = new Set(coreIds);
  const preferenceCount = reader.varint();
  if (preferenceCount > MAX_PREFERENCES) return damaged();
  const preferences: Record<string, string> = {};
  for (let index = 0; index < preferenceCount; index += 1) {
    const kind = reader.varint();
    if (kind === 0) {
      const source = readCardId(reader);
      const target = readCardId(reader);
      if (!referenceIds.has(source)) return damaged();
      const card = requireCard(source);
      if (preferredCardPrinting(card, { [cardPrintingKey(card)]: target }).catalogId !== target) return damaged();
      const key = cardPrintingKey(card);
      if (Object.hasOwn(preferences, key)) return damaged();
      preferences[key] = target;
    } else if (kind === 1) {
      const source = readCoreId(reader);
      const target = readCorePrintingId(reader);
      if (!selectedCores.has(source)) return damaged();
      const core = requireCore(source);
      if (!core.printings?.some(print => print.id === target)) return damaged();
      const key = corePrintingKey(core);
      if (Object.hasOwn(preferences, key)) return damaged();
      preferences[key] = target;
    } else return damaged();
  }
  reader.complete();
  const team = bakuganIds.map(id => BAKUGAN.find(item => item.id === id)!);
  return {
    id: createId(),
    name: "Imported Deck",
    bakuganIds,
    coreIds,
    cardIds,
    factions: [...new Set(team.flatMap(item => item.character.factions?.length ? item.character.factions : [item.faction]))],
    visibility: "Private",
    format,
    updatedAt: new Date().toISOString(),
    revision: 1,
    leadCardId: cardIds[0],
    ...(Object.keys(preferences).length ? { printingPreferences: preferences } : {}),
  };
}
