import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, CORE_COMPENDIUM } from "../lib/data";
import {
  cardCollectionIds,
  collectionCards,
  collectionEntryForIds,
  coreCollectionIds,
  normalizeCollection,
  updateCollection,
} from "../lib/collection";

test("collection data is normalized and updated by catalogue ID", () => {
  const normalized = normalizeCollection({
    "bb-1": { standard: 2, foil: -5, wishlist: 4 },
    invalid: { standard: "2" },
  });
  assert.deepEqual(normalized["bb-1"], { standard: 2, foil: 0, wishlist: 4 });
  assert.equal(normalized.invalid, undefined);
  const updated = updateCollection(normalized, "bb-1", "foil", 1);
  assert.equal(updated["bb-1"].foil, 1);
  assert.equal(updateCollection(updated, "bb-1", "standard", -9)["bb-1"].standard, 0);
});

test("alternate card printings share a collection tile but aggregate separately", () => {
  const representative = collectionCards(CARDS).find((card) => card.catalogId === "bb-283");
  assert.ok(representative);
  const ids = cardCollectionIds(representative, CARDS);
  assert.deepEqual(ids, ["bb-283", "av-160"]);
  const entry = collectionEntryForIds({
    "bb-283": { standard: 1, foil: 0, wishlist: 0 },
    "av-160": { standard: 0, foil: 2, wishlist: 3 },
  }, ids);
  assert.deepEqual(entry, { standard: 1, foil: 2, wishlist: 3 });
});

test("core reprints remain separate collection catalogue IDs", () => {
  const core = CORE_COMPENDIUM.find((candidate) => candidate.id === "core-2");
  assert.ok(core);
  assert.deepEqual(coreCollectionIds(core), ["core-2", "aa-printing-19"]);
});
