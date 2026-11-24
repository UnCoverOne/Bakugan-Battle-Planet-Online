import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, STARTER_DECKS } from "../lib/data";
import { inspectorCardPrintings } from "../lib/card-inspector-data";
import { createBuilderCardControls } from "../lib/builder-card-selection";
import { cardPrintingKey, corePrintingKey, countConstructionCopies, preferredCardPrinting,
  preferredCorePrinting, uniqueConstructionCards } from "../lib/deck-printings";
import { encodeDeckCode, decodeDeckCode } from "../lib/deck-transfer";

const alternateCard = CARDS.filter(card => card.type !== "Character" && card.fusionFace !== "b")
  .map(card => ({ card, printings: inspectorCardPrintings(card, CARDS) }))
  .find(group => group.printings.length > 1);

test("main-deck printings share one total and one copy limit", () => {
  assert.ok(alternateCard, "An alternate card printing is required for this regression");
  const [first, second] = alternateCard.printings;
  const key = cardPrintingKey(first);
  assert.equal(cardPrintingKey(second), key);
  assert.equal(uniqueConstructionCards([first, second]).length, 1);
  assert.equal(countConstructionCopies([first.catalogId, second.catalogId]).get(key), 2);
  const controls = createBuilderCardControls(
    [first.catalogId, second.catalogId, second.catalogId], CARD_BY_ID, "standard", [], 40, true,
  );
  assert.equal(controls.canAdd(first.catalogId), false);
  assert.equal(controls.canAdd(second.catalogId), false);
  assert.equal(preferredCardPrinting(first, { [key]: second.catalogId }).catalogId, second.catalogId);
  assert.equal(preferredCardPrinting(first, { [key]: "unrelated-printing" }).catalogId, first.catalogId);
});

test("alternate core art leaves the canonical core gameplay identity unchanged", () => {
  const core = CORES.find(item => item.printings?.length);
  assert.ok(core, "An alternate core printing is required for this regression");
  const printing = core.printings![0];
  const displayed = preferredCorePrinting(core, { [corePrintingKey(core)]: printing.id });
  assert.equal(displayed.id, core.id);
  assert.equal(displayed.type, core.type);
  assert.equal(displayed.art, printing.art);
  assert.equal(displayed.set, printing.set);
  assert.equal(displayed.number, printing.number);
  assert.equal(preferredCorePrinting(core).art, core.art);
});

test("BBP2 codes retain active non-default printings but discard unrelated preferences", () => {
  const core = CORES.find(item => item.printings?.length);
  assert.ok(core);
  assert.ok(alternateCard);
  const [first, second] = alternateCard.printings;
  const base = STARTER_DECKS[0];
  const deck = {
    ...base,
    cardIds: [first.catalogId, ...base.cardIds.slice(1)],
    coreIds: [core.id, ...base.coreIds.slice(1)],
  };
  const preferences = {
    [cardPrintingKey(first)]: second.catalogId,
    [corePrintingKey(core)]: core.printings![0].id,
    "core:obsolete": "aa-printing-999",
  };
  const imported = decodeDeckCode(encodeDeckCode({ ...deck, printingPreferences: preferences }), () => "imported");
  const frequencies = (ids: string[]) => ids.reduce((counts, id) => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  assert.deepEqual(frequencies(imported.cardIds), frequencies(deck.cardIds));
  assert.deepEqual(imported.coreIds, deck.coreIds);
  assert.deepEqual(imported.bakuganIds, deck.bakuganIds);
  assert.deepEqual(imported.printingPreferences, {
    [cardPrintingKey(first)]: second.catalogId,
    [corePrintingKey(core)]: core.printings![0].id,
  });
});

test("Character alternate printings cannot become duplicate team slots", () => {
  const character = BAKUGAN.find(item => inspectorCardPrintings(item.character, CARDS).length > 1);
  if (!character) return;
  const group = inspectorCardPrintings(character.character, CARDS);
  assert.equal(uniqueConstructionCards(group).length, 1);
  assert.equal(cardPrintingKey(group[0]), cardPrintingKey(group[1]));
});
