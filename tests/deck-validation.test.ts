import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDeckConstruction,
  type DeckValidationCatalogue,
  type ValidatableDeck,
} from "../lib/deck-validation";

const cards = new Map([
  ["pyrus-1", { catalogId: "pyrus-1", name: "Pyrus One", effect: "Do one thing.", faction: "Pyrus", factions: ["Pyrus"] }],
  ["pyrus-2", { catalogId: "pyrus-2", name: "Pyrus Two", effect: "Do two things.", faction: "Pyrus", factions: ["Pyrus"] }],
  ["aquos-1", { catalogId: "aquos-1", name: "Aquos One", effect: "Flow.", faction: "Aquos", factions: ["Aquos"] }],
]);
const characters = new Map([
  ["char-1", { id: "char-1", faction: "Pyrus", character: { coreTypes: ["Fist", "Shield"] } }],
  ["char-2", { id: "char-2", faction: "Pyrus", character: { coreTypes: ["Fist", "Helix"] } }],
  ["char-3", { id: "char-3", faction: "Pyrus", character: { coreTypes: ["Magic Shield", "Flaming Fist"] } }],
]);
const cores = new Map([
  ["core-1", { id: "core-1", type: "Fist" }],
  ["core-2", { id: "core-2", type: "Shield" }],
  ["core-3", { id: "core-3", type: "Fist" }],
  ["core-4", { id: "core-4", type: "Helix" }],
  ["core-5", { id: "core-5", type: "Magic Shield" }],
  ["core-6", { id: "core-6", type: "Flaming Fist" }],
]);
const catalogue: DeckValidationCatalogue = { cards, characters, cores };

function legalDeck(): ValidatableDeck {
  return {
    name: "Legal Pyrus",
    format: "standard",
    bakuganIds: ["char-1", "char-2", "char-3"],
    coreIds: ["core-1", "core-2", "core-3", "core-4", "core-5", "core-6"],
    cardIds: Array.from({ length: 40 }, (_, index) => index % 2 ? "pyrus-1" : "pyrus-2"),
  };
}

test("returns a structured legal result for a complete deck", () => {
  const deck = legalDeck();
  deck.cardIds = Array.from({ length: 40 }, (_, index) => `pyrus-${(index % 14) + 1}`);
  const expandedCards = new Map(cards);
  for (let index = 3; index <= 14; index += 1) {
    expandedCards.set(`pyrus-${index}`, {
      catalogId: `pyrus-${index}`,
      name: `Pyrus ${index}`,
      effect: `Effect ${index}`,
      faction: "Pyrus",
      factions: ["Pyrus"],
    });
  }
  const result = validateDeckConstruction(deck, { ...catalogue, cards: expandedCards });
  assert.equal(result.isLegal, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, { cards: 40, characters: 3, cores: 6 });
});

test("uses stable codes, sections, paths, and counts for incomplete decks", () => {
  const result = validateDeckConstruction({
    name: "",
    bakuganIds: [],
    coreIds: [],
    cardIds: [],
  }, catalogue);
  assert.equal(result.isLegal, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "identity.name_required",
    "team.exactly_three",
    "cores.exactly_six",
    "main_deck.exactly_forty",
  ]);
  assert.equal(result.bySection.team[0].path, "bakuganIds");
  assert.deepEqual(result.counts, { cards: 0, characters: 0, cores: 0 });
});

test("enforces faction compatibility, copy limits, and matching BakuCore indicators", () => {
  const deck = legalDeck();
  deck.cardIds = Array(40).fill("aquos-1");
  deck.coreIds = ["core-1", "core-1", "core-1", "core-1", "core-1", "core-1"];
  const result = validateDeckConstruction(deck, catalogue);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("main_deck.faction_mismatch"));
  assert.ok(codes.includes("main_deck.copy_limit"));
  assert.ok(codes.includes("cores.indicators_mismatch"));
});

test("rejects duplicate and unknown Character, card, and BakuCore IDs", () => {
  const deck = legalDeck();
  deck.bakuganIds = ["char-1", "char-1", "missing-character"];
  deck.coreIds = ["core-1", "core-2", "core-3", "core-4", "core-5", "missing-core"];
  deck.cardIds = [...deck.cardIds.slice(0, 39), "missing-card"];
  const codes = validateDeckConstruction(deck, catalogue).issues.map((issue) => issue.code);
  assert.ok(codes.includes("team.distinct"));
  assert.ok(codes.includes("team.unknown_character"));
  assert.ok(codes.includes("cores.unknown_core"));
  assert.ok(codes.includes("main_deck.unknown_card"));
});
