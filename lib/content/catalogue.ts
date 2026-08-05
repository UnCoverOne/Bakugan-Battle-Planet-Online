import battleBrawlersJson from "../catalog.generated.json";
import type { GameCard } from "../game";
import { recordsFromRows } from "./card-set-extensions";
import { AA_CARD_ROWS, BR_CARD_ROWS, EX_CARD_ROWS } from "./card-set-rows";
import {
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
} from "./versions";

export const CARD_SET_CODES = Object.freeze(["BB", "BR", "AA", "EX"] as const);
export type CardSetCode = (typeof CARD_SET_CODES)[number];

export type ControlledCardRecord = Omit<GameCard, "id" | "catalogId"> & {
  id: string;
  source?: string;
  hasProvidedScan?: boolean;
  slug?: string;
};

export const CARD_SET_INFO = Object.freeze({
  BB: Object.freeze({ code: "BB" as const, name: "Battle Brawlers", collectorTotal: 374 }),
  BR: Object.freeze({ code: "BR" as const, name: "Bakugan Resurgence", collectorTotal: 248 }),
  AA: Object.freeze({ code: "AA" as const, name: "Age of Aurelus", collectorTotal: 220 }),
  EX: Object.freeze({ code: "EX" as const, name: "EX", collectorTotal: 2 }),
});

export function cardSetCode(card: Pick<GameCard, "catalogId"> | Pick<ControlledCardRecord, "id">): CardSetCode {
  const id = "catalogId" in card ? card.catalogId : card.id;
  if (id.startsWith("br-")) return "BR";
  if (id.startsWith("aa-")) return "AA";
  if (id.startsWith("ex-")) return "EX";
  return "BB";
}

export function cardCollectorLabel(card: Pick<GameCard, "catalogId" | "number">) {
  const info = CARD_SET_INFO[cardSetCode(card)];
  return `${card.number}/${info.collectorTotal} ${info.code}`;
}

const VERIFIED_CARD_CORRECTIONS: Partial<Record<string, Partial<ControlledCardRecord>>> = {
  // The generated source incorrectly transcribed Haos Gorthion Ultra's printed
  // Damage Rating as 7. Its Character card is 600 B / 2 Damage.
  "bb-330": { damage: 2 },
  // The generated source incorrectly transcribed Ventus Trox Ultra's second
  // BakuCore as Fist. Its Character card requires Shield and Helix.
  "bb-373": { coreTypes: ["Shield", "Helix"] },
};

const battleBrawlers = (battleBrawlersJson as unknown as ControlledCardRecord[]).map((record) => ({
  ...record,
  ...VERIFIED_CARD_CORRECTIONS[record.id],
  id: record.id,
}));

export const CONTROLLED_CATALOGUE = Object.freeze(
  [
    ...battleBrawlers,
    ...recordsFromRows("BR", BR_CARD_ROWS),
    ...recordsFromRows("AA", AA_CARD_ROWS),
    ...recordsFromRows("EX", EX_CARD_ROWS),
  ].map((record) => Object.freeze({ ...record })),
);

export function textFingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const CONTENT_MANIFEST = Object.freeze({
  schemaVersion: CONTENT_SCHEMA_VERSION,
  catalogueVersion: CARD_CATALOGUE_VERSION,
  cardCount: CONTROLLED_CATALOGUE.length,
  sets: Object.freeze({
    BB: CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "BB").length,
    BR: CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "BR").length,
    AA: CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "AA").length,
    EX: CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "EX").length,
  }),
  textFingerprint: textFingerprint(
    CONTROLLED_CATALOGUE.map((card) => `${card.id}\u001f${card.effect}`).join("\u001e"),
  ),
});

const EXPECTED_TYPE_COUNTS = Object.freeze({
  Action: 246,
  Character: 237,
  Evo: 233,
  Flip: 82,
  Hero: 47,
});

const EXPECTED_SET_COUNTS = Object.freeze({ BB: 374, BR: 249, AA: 220, EX: 2 });

export function validateControlledCatalogue(
  records: readonly ControlledCardRecord[] = CONTROLLED_CATALOGUE,
) {
  const errors: string[] = [];
  if (records.length !== 845) errors.push(`Expected 845 cards, found ${records.length}.`);
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const typeCounts = new Map<string, number>();
  const setCounts = new Map<CardSetCode, number>();
  const setNumbers = new Map<CardSetCode, Map<number, number>>();
  for (const card of records) {
    const set = cardSetCode(card);
    if (!/^(?:bb|br|aa|ex)-\d+(?:-[a-z0-9-]+)?$/.test(card.id)) errors.push(`${card.id || "<missing>"}: invalid canonical ID.`);
    if (ids.has(card.id)) errors.push(`${card.id}: duplicate canonical ID.`);
    ids.add(card.id);
    if (!Number.isInteger(card.number) || card.number < 1 || card.number > CARD_SET_INFO[set].collectorTotal) errors.push(`${card.id}: invalid collector number.`);
    const numbers = setNumbers.get(set) ?? new Map<number, number>();
    numbers.set(card.number, (numbers.get(card.number) ?? 0) + 1);
    setNumbers.set(set, numbers);
    if (set === "BB" && card.id !== `bb-${card.number}`) errors.push(`${card.id}: Battle Brawlers ID does not match card number ${card.number}.`);
    if (set !== "BR" || card.number !== 221) {
      if ((numbers.get(card.number) ?? 0) > 1) errors.push(`${card.id}: duplicate ${set} collector number ${card.number}.`);
    }
    if (!card.name?.trim() || !card.displayName?.trim()) errors.push(`${card.id}: missing display name.`);
    if (!Array.isArray(card.factions) || !card.factions.includes(card.faction)) errors.push(`${card.id}: primary faction is not represented in factions.`);
    if (typeof card.effect !== "string") errors.push(`${card.id}: effect text must be a string.`);
    if (!Array.isArray(card.mechanics)) errors.push(`${card.id}: mechanics must be an array.`);
    if (!Array.isArray(card.coreTypes)) errors.push(`${card.id}: coreTypes must be an array.`);
    if (!card.art?.startsWith("/assets/")) errors.push(`${card.id}: art must be a self-hosted repository asset.`);
    if (!card.slug?.trim()) errors.push(`${card.id}: missing stable slug.`);
    else if (slugs.has(card.slug)) errors.push(`${card.id}: duplicate slug ${card.slug}.`);
    else slugs.add(card.slug);
    typeCounts.set(card.type, (typeCounts.get(card.type) ?? 0) + 1);
    setCounts.set(set, (setCounts.get(set) ?? 0) + 1);
  }
  for (const [set, expected] of Object.entries(EXPECTED_SET_COUNTS) as Array<[CardSetCode, number]>) {
    if ((setCounts.get(set) ?? 0) !== expected) errors.push(`${set}: expected ${expected}, found ${setCounts.get(set) ?? 0}.`);
  }
  for (let number = 1; number <= 374; number += 1) if (!(setNumbers.get("BB")?.has(number))) errors.push(`Missing BB card number ${number}.`);
  for (let number = 1; number <= 248; number += 1) if (!(setNumbers.get("BR")?.has(number))) errors.push(`Missing BR card number ${number}.`);
  for (let number = 1; number <= 220; number += 1) if (!(setNumbers.get("AA")?.has(number))) errors.push(`Missing AA card number ${number}.`);
  for (let number = 1; number <= 2; number += 1) if (!(setNumbers.get("EX")?.has(number))) errors.push(`Missing EX card number ${number}.`);
  if ((setNumbers.get("BR")?.get(221) ?? 0) !== 2) errors.push("BR collector number 221 must contain both known printings.");
  if (records.find((card) => card.id === "bb-330")?.damage !== 2) {
    errors.push("bb-330: Haos Gorthion Ultra must have 2 base Damage.");
  }
  const ventusTroxUltra = records.find((card) => card.id === "bb-373");
  if (
    ventusTroxUltra?.coreTypes.length !== 2
    || ventusTroxUltra.coreTypes[0] !== "Shield"
    || ventusTroxUltra.coreTypes[1] !== "Helix"
  ) {
    errors.push("bb-373: Ventus Trox Ultra must require Shield and Helix BakuCores.");
  }
  for (const [type, expected] of Object.entries(EXPECTED_TYPE_COUNTS)) {
    if ((typeCounts.get(type) ?? 0) !== expected) errors.push(`${type}: expected ${expected}, found ${typeCounts.get(type) ?? 0}.`);
  }
  return errors;
}
