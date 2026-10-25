import assert from "node:assert/strict";
import { test } from "node:test";
import { BAKUGAN, CARDS, CORES } from "../lib/data";
import { builderSortOptions, normalizeBuilderSort, sortBuilderItems, type BuilderGalleryItem } from "../lib/builder-sorting";
import { filterAndSortCompendiumCards, filterAndSortCompendiumCores, DEFAULT_COMPENDIUM_STATE, DEFAULT_CORE_COMPENDIUM_STATE, type CompendiumSort, type CoreCompendiumSort } from "../lib/compendium";

test("builder sort menus match each Compendium category plus copy count", () => {
  const values = (category: "cards" | "characters" | "cores") => builderSortOptions(category).map(([value]) => value);
  assert.deepEqual(values("cards"), ["collector", "name-asc", "name-desc", "cost-asc", "cost-desc", "count-desc"]);
  assert.deepEqual(values("characters"), ["collector", "name-asc", "name-desc", "bpower-desc", "damage-desc", "roll-accuracy-desc", "double-core-chance-desc", "count-desc"]);
  assert.deepEqual(values("cores"), ["collector", "type", "bonus", "damage", "count-desc"]);
  assert.equal(builderSortOptions("cards")[0][1], "Collector number");
});

test("restored drafts migrate legacy sorts and category switches reject irrelevant sorts", () => {
  for (const category of ["cards", "characters", "cores"] as const) {
    assert.equal(normalizeBuilderSort(category, "id-asc"), "collector");
    assert.equal(normalizeBuilderSort(category, "count-desc"), "count-desc");
    assert.equal(normalizeBuilderSort(category, "invalid"), "collector");
  }
  assert.equal(normalizeBuilderSort("cores", "cost-asc"), "collector");
  assert.equal(normalizeBuilderSort("characters", "cost-desc"), "collector");
  assert.equal(normalizeBuilderSort("cards", "bpower-desc"), "collector");
});

for (const category of ["cards", "characters"] as const) {
  test(`${category} produce the same order as the Compendium`, () => {
    const cards = category === "characters" ? BAKUGAN.slice(0, 50).map(item => item.character) : CARDS.filter(card => card.type !== "Character").slice(0, 50);
    const items: BuilderGalleryItem[] = cards.map(card => ({ kind: category === "cards" ? "card" : "character", id: card.catalogId, name: card.displayName, card, count: 0 }));
    for (const [sort] of builderSortOptions(category)) {
      if (sort === "count-desc") continue;
      const expected = filterAndSortCompendiumCards(cards, { ...DEFAULT_COMPENDIUM_STATE, sort: sort as CompendiumSort }, { includeFusionBack: true });
      assert.deepEqual(items.toSorted((a, b) => sortBuilderItems(a, b, sort)).map(item => item.id), expected.map(card => card.catalogId));
    }
  });
}

test("cores produce the same type, stat and collector order as the Compendium", () => {
  const items: BuilderGalleryItem[] = CORES.map(core => ({ kind: "core", id: core.id, name: core.name, core, count: 0 }));
  for (const [sort] of builderSortOptions("cores")) {
    if (sort === "count-desc") continue;
    const expected = filterAndSortCompendiumCores(CORES, { ...DEFAULT_CORE_COMPENDIUM_STATE, sort: sort as CoreCompendiumSort });
    assert.deepEqual(items.toSorted((a, b) => sortBuilderItems(a, b, sort)).map(item => item.id), expected.map(core => core.id));
  }
});

test("copy count remains descending and uses stable name ties", () => {
  const card = CARDS[0];
  const items: BuilderGalleryItem[] = [
    { kind: "card", id: "a", name: "Zulu", card, count: 1 },
    { kind: "card", id: "b", name: "Alpha", card, count: 3 },
    { kind: "card", id: "c", name: "Beta", card, count: 3 },
  ];
  assert.deepEqual(items.toSorted((a, b) => sortBuilderItems(a, b, "count-desc")).map(item => item.id), ["b", "c", "a"]);
});
