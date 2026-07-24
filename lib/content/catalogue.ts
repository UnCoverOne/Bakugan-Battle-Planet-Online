import catalogJson from "../catalog.generated.json";
import type { GameCard } from "../game";
import {
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
} from "./versions";

export type ControlledCardRecord = Omit<GameCard, "id" | "catalogId"> & {
  id: `bb-${number}`;
  source?: string;
  hasProvidedScan?: boolean;
  slug?: string;
};

export const CONTROLLED_CATALOGUE = Object.freeze(
  (catalogJson as unknown as ControlledCardRecord[]).map((record) => Object.freeze({ ...record })),
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
  textFingerprint: textFingerprint(
    CONTROLLED_CATALOGUE.map((card) => `${card.id}\u001f${card.effect}`).join("\u001e"),
  ),
});

const EXPECTED_TYPE_COUNTS = Object.freeze({
  Action: 137,
  Character: 93,
  Evo: 66,
  Flip: 49,
  Hero: 29,
});

export function validateControlledCatalogue(
  records: readonly ControlledCardRecord[] = CONTROLLED_CATALOGUE,
) {
  const errors: string[] = [];
  if (records.length !== 374) errors.push(`Expected 374 cards, found ${records.length}.`);
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const typeCounts = new Map<string, number>();
  for (const card of records) {
    if (!/^bb-\d+$/.test(card.id)) errors.push(`${card.id || "<missing>"}: invalid canonical ID.`);
    if (ids.has(card.id)) errors.push(`${card.id}: duplicate canonical ID.`);
    ids.add(card.id);
    if (!Number.isInteger(card.number) || card.number < 1 || card.number > 374) errors.push(`${card.id}: invalid card number.`);
    if (numbers.has(card.number)) errors.push(`${card.id}: duplicate card number ${card.number}.`);
    numbers.add(card.number);
    if (card.id !== `bb-${card.number}`) errors.push(`${card.id}: ID does not match card number ${card.number}.`);
    if (!card.name?.trim() || !card.displayName?.trim()) errors.push(`${card.id}: missing display name.`);
    if (!Array.isArray(card.factions) || !card.factions.includes(card.faction)) errors.push(`${card.id}: primary faction is not represented in factions.`);
    if (typeof card.effect !== "string") errors.push(`${card.id}: effect text must be a string.`);
    if (!Array.isArray(card.mechanics)) errors.push(`${card.id}: mechanics must be an array.`);
    if (!Array.isArray(card.coreTypes)) errors.push(`${card.id}: coreTypes must be an array.`);
    if (!card.art?.startsWith("/assets/")) errors.push(`${card.id}: art must be a repository asset path.`);
    if (!card.slug?.trim()) errors.push(`${card.id}: missing stable slug.`);
    typeCounts.set(card.type, (typeCounts.get(card.type) ?? 0) + 1);
  }
  for (let number = 1; number <= 374; number += 1) {
    if (!numbers.has(number)) errors.push(`Missing card number ${number}.`);
  }
  for (const [type, expected] of Object.entries(EXPECTED_TYPE_COUNTS)) {
    if ((typeCounts.get(type) ?? 0) !== expected) errors.push(`${type}: expected ${expected}, found ${typeCounts.get(type) ?? 0}.`);
  }
  return errors;
}
