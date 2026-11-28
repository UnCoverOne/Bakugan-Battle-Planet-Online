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

import { cardCollectionCatalogue, coreCollectionPrintings, matchesCollection, printingTotals, sortCollection } from "../lib/collection-catalogue";
import { DEFAULT_COMPENDIUM_STATE } from "../lib/compendium";

test("Collection scopes reprint counts to selected sets and does not duplicate identities", () => {
  const catalogue = cardCollectionCatalogue(CARDS, {...DEFAULT_COMPENDIUM_STATE, set:["AV"]});
  const reprint = catalogue.cards.find(card => card.catalogId === "av-160");
  assert.ok(reprint);
  const printings = catalogue.printings.get(reprint.catalogId)!;
  assert.ok(printings.some(printing => printing.id === "av-160"));
  assert.ok(!printings.some(printing => printing.id === "bb-283"));
  assert.deepEqual(printingTotals({"bb-283":{standard:4,foil:1,wishlist:0},"av-160":{standard:0,foil:2,wishlist:1}},printings), {standard:0,foil:2,wishlist:1});
  const core = CORE_COMPENDIUM.find(candidate => candidate.id === "core-2")!;
  assert.deepEqual(coreCollectionPrintings(core,["Armored Alliance"]).map(printing => printing.id),["aa-printing-19"]);
});

test("Collection statuses, zero quantities and total ownership sort remain distinct", () => {
  const zero = {standard:0,foil:0,wishlist:2};
  const owned = {standard:1,foil:2,wishlist:0};
  assert.ok(matchesCollection(zero,["unowned","wishlisted"],{standard:["0"],foil:[],wishlist:["2"]}));
  assert.ok(!matchesCollection(zero,["owned"],{standard:[],foil:[],wishlist:[]}));
  assert.ok(matchesCollection(owned,["owned"],{standard:["1"],foil:["2"],wishlist:["0"]}));
  assert.deepEqual(sortCollection([zero,owned],"owned-desc",entry=>entry),[owned,zero]);
});

test("Fused display faces resolve to their physical front for ownership", () => {
  const fronts = CARDS.filter(card => card.fusionFace === "a" && card.fusionPairId);
  const catalogue = cardCollectionCatalogue(CARDS, {...DEFAULT_COMPENDIUM_STATE, type:["Character"], fusionOnly:true});
  assert.ok(catalogue.cards.length > 0);
  for (const back of catalogue.cards) {
    const front = fronts.find(card => card.fusionPairId === back.fusionPairId);
    assert.ok(front);
    const printings = catalogue.printings.get(back.catalogId)!;
    assert.ok(printings.some(printing => printing.id === front.catalogId));
    assert.ok(!printings.some(printing => printing.id === back.catalogId));
  }
});
