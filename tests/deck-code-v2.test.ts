import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS, CORES, STARTER_DECKS, type DeckRecord } from "../lib/data";
import { cardPrintingKey, corePrintingKey } from "../lib/deck-printings";
import { DECK_CODE_PREFIX, LEGACY_DECK_CODE_PREFIX, decodeDeckCode, encodeDeckCode } from "../lib/deck-transfer";

const sample = () => ({
  ...STARTER_DECKS[0],
  bakuganIds: [...STARTER_DECKS[0].bakuganIds],
  coreIds: [...STARTER_DECKS[0].coreIds],
  cardIds: [...STARTER_DECKS[0].cardIds],
});

const counts = (items: readonly string[]) => [...items.reduce((map, id) => {
  map.set(id, (map.get(id) ?? 0) + 1);
  return map;
}, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right));

function legacyCode(deck: DeckRecord) {
  const payload = {
    schema: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    deck: {
      name: deck.name,
      bakuganIds: deck.bakuganIds,
      coreIds: deck.coreIds,
      cardIds: deck.cardIds,
      visibility: deck.visibility,
      format: deck.format,
      leadCardId: deck.leadCardId,
      description: deck.description,
      printingPreferences: deck.printingPreferences,
    },
  };
  return LEGACY_DECK_CODE_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

test("BBP2 round-trips construction and imports a private deck without presentation metadata", () => {
  const deck: DeckRecord = {
    ...sample(),
    name: "A deliberately long and personal deck name",
    description: "A story about this deck. 🎴".repeat(20),
    visibility: "Public",
    creator: "Original Author",
    publishedAt: "2026-11-01T00:00:00.000Z",
    leadCardId: sample().cardIds[15],
  };
  const code = encodeDeckCode(deck);
  assert.equal(DECK_CODE_PREFIX, "BBP2.");
  assert.ok(code.startsWith(DECK_CODE_PREFIX));
  assert.ok(/^[A-Za-z0-9._-]+$/.test(code));
  const imported = decodeDeckCode(code, () => "imported-id");
  assert.equal(imported.id, "imported-id");
  assert.equal(imported.name, "Imported Deck");
  assert.equal(imported.visibility, "Private");
  assert.equal(imported.description, undefined);
  assert.equal(imported.creator, undefined);
  assert.equal(imported.publishedAt, undefined);
  assert.equal(imported.format, "standard");
  assert.deepEqual(imported.bakuganIds, deck.bakuganIds);
  assert.deepEqual(imported.coreIds, deck.coreIds);
  assert.deepEqual(counts(imported.cardIds), counts(deck.cardIds));
  assert.ok(imported.leadCardId && imported.cardIds.includes(imported.leadCardId));
  assert.ok(imported.factions.length > 0);
});

test("BBP2 is deterministic, does not store metadata, and is far shorter than BBP1", () => {
  const deck = sample();
  const code = encodeDeckCode(deck);
  assert.equal(code, encodeDeckCode({ ...deck, name: "Another name", description: "Another description", visibility: "Public" }));
  assert.equal(code, encodeDeckCode({ ...deck, cardIds: [...deck.cardIds].reverse() }));
  assert.ok(code.length < legacyCode(deck).length * 0.5,
    "Expected binary code to be under half the legacy length, got " + code.length);
  assert.ok(code.length < 350, "Unexpectedly long BBP2 deck code: " + code.length);
});

test("BBP2 preserves Standard, Singleton and Competitive formats without enforcing a fixed deck size", () => {
  const deck = sample();
  for (const format of ["standard", "singleton", "competitive"] as const) {
    const cards = format === "competitive" ? [...deck.cardIds, ...deck.cardIds.slice(0, 10)] : deck.cardIds;
    const imported = decodeDeckCode(encodeDeckCode({ ...deck, cardIds: cards, format }), () => "new-id");
    assert.equal(imported.format, format);
    assert.deepEqual(counts(imported.cardIds), counts(cards));
  }
});

test("BBP2 preserves active alternate BakuCore artwork and omits stale/default printing choices", () => {
  const source = CORES.find(item => item.printings?.length);
  assert.ok(source && source.printings?.[0], "Expected at least one BakuCore with alternate printing");
  const original = sample();
  const deck = {
    ...original,
    coreIds: [source.id, ...original.coreIds.slice(1)],
    printingPreferences: {
      [corePrintingKey(source)]: source.printings[0].id,
      "core:nonexistent": "aa-printing-999",
      [cardPrintingKey(CARDS.find(item => item.catalogId === original.cardIds[0])!)]: original.cardIds[0],
    },
  };
  const imported = decodeDeckCode(encodeDeckCode(deck), () => "printing-id");
  assert.equal(imported.printingPreferences?.[corePrintingKey(source)], source.printings[0].id);
  assert.ok(!Object.hasOwn(imported.printingPreferences ?? {}, "core:nonexistent"));
  assert.ok(Object.keys(imported.printingPreferences ?? {}).length <= 2);
});

test("BBP2 supports cards and Characters from the various stable catalogue sets", () => {
  const deck = sample();
  const characters = BAKUGAN.slice(-3).map(item => item.id);
  const selections = ["bb", "br", "aa", "av", "ff", "di", "ps1", "sv", "cp", "ex"]
    .flatMap(prefix => CARDS.filter(card => card.type !== "Character" && card.catalogId.startsWith(prefix + "-")).slice(0, 1))
    .map(card => card.catalogId);
  assert.ok(selections.length >= 6);
  const decoded = decodeDeckCode(encodeDeckCode({ ...deck, bakuganIds: characters, cardIds: selections }), () => "set-id");
  assert.deepEqual(decoded.bakuganIds, characters);
  assert.deepEqual(counts(decoded.cardIds), counts(selections));
});

test("BBP2 detects truncated and modified codes, invalid prefixes and excessive payloads", () => {
  const code = encodeDeckCode(sample());
  assert.throws(() => decodeDeckCode(code.slice(0, -2), () => "x"), /damaged or incomplete/);
  const last = code.at(-4)!;
  const tampered = code.slice(0, -4) + (last === "A" ? "B" : "A") + code.slice(-3);
  assert.throws(() => decodeDeckCode(tampered, () => "x"), /damaged or incomplete/);
  assert.throws(() => decodeDeckCode("BBP3.abc", () => "x"), /Unsupported deck-code format/);
  assert.throws(() => decodeDeckCode("BBP2." + "A".repeat(4100), () => "x"), /damaged or incomplete/);
  assert.throws(() => encodeDeckCode({ ...sample(), cardIds: Array(201).fill(sample().cardIds[0]) }), /too large/);
});

test("Existing BBP1 codes still import with their original name, description and format", () => {
  const deck: DeckRecord = { ...sample(), name: "Archived Name", description: "Archived description", visibility: "Public" };
  const imported = decodeDeckCode(legacyCode(deck), () => "legacy-id");
  assert.equal(imported.name, "Archived Name");
  assert.equal(imported.description, "Archived description");
  assert.equal(imported.visibility, "Public");
  assert.equal(imported.format, "standard");
  assert.deepEqual(imported.cardIds, deck.cardIds);
  const competitive = { ...deck, format: "competitive" as const, cardIds: [...deck.cardIds, ...deck.cardIds.slice(0, 10)] };
  const legacyCompetitive = decodeDeckCode(legacyCode(competitive), () => "competitive-id");
  assert.equal(legacyCompetitive.format, "competitive");
  assert.equal(legacyCompetitive.cardIds.length, 50);
});

test("Whitespace-wrapped codes remain importable", () => {
  const code = encodeDeckCode(sample());
  assert.deepEqual(counts(decodeDeckCode("  \n" + code.slice(0, 15) + " \n " + code.slice(15) + "\n", () => "w").cardIds),
    counts(sample().cardIds));
});
