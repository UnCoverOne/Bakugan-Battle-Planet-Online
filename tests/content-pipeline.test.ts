import assert from "node:assert/strict";
import test from "node:test";
import lockJson from "../content/card-content.lock.json";
import { CONTROLLED_CATALOGUE, CONTENT_MANIFEST, cardSetCode, textFingerprint, validateControlledCatalogue } from "../lib/content/catalogue";
import { allRuleDefinitions, ruleDefinitionForCard, validateCardAgainstRules } from "../lib/rules/catalogue";
import { RULES_SOURCES, validateDefinitionProvenance } from "../lib/rules/provenance";

const legacyLock = lockJson as {
  cards: Array<{ cardId: string; textFingerprint: string; implementationFingerprint: string; provenanceSources: string[]; goldenTestId: string }>;
};

test("the three-set schema-controlled catalogue is complete and unique", () => {
  assert.deepEqual(validateControlledCatalogue(), []);
  assert.equal(CONTROLLED_CATALOGUE.length, 843);
  assert.equal(new Set(CONTROLLED_CATALOGUE.map((card) => card.id)).size, 843);
  assert.deepEqual(CONTENT_MANIFEST.sets, { BB: 374, BR: 249, AA: 220 });
  assert.deepEqual(
    Object.fromEntries(["BB", "BR", "AA"].map((set) => [set, CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === set).length])),
    CONTENT_MANIFEST.sets,
  );
});

test("every printing has fingerprinted text and an executable typed definition", () => {
  const definitions = allRuleDefinitions();
  assert.equal(definitions.length, 843);
  assert.equal(new Set(definitions.map((definition) => definition.cardId)).size, 843);
  for (const card of CONTROLLED_CATALOGUE) {
    const runtimeCard = { ...card, id: card.id, catalogId: card.id };
    assert.equal(validateCardAgainstRules(runtimeCard), true);
    const definition = ruleDefinitionForCard(runtimeCard);
    assert.equal(definition.sourceTextFingerprint, textFingerprint(card.effect));
    assert.equal(definition.goldenTestIds[0], `card-golden:${card.id}`);
    if (cardSetCode(card) === "BB") {
      const locked = legacyLock.cards.find((entry) => entry.cardId === card.id);
      assert.ok(locked, `${card.id} must retain its Battle Brawlers content lock.`);
      assert.equal(locked.textFingerprint, definition.sourceTextFingerprint);
      assert.ok(locked.implementationFingerprint.length >= 8);
    }
  }
});

test("non-obvious rules implementations have machine-readable provenance", () => {
  assert.deepEqual(RULES_SOURCES.map((source) => source.priority), [...RULES_SOURCES].map((source) => source.priority).sort((a, b) => b - a));
  for (const definition of allRuleDefinitions()) {
    assert.deepEqual(validateDefinitionProvenance(definition), []);
    assert.ok(definition.provenance.authorityOrder.length >= 4);
    assert.ok(definition.provenance.citations.some((citation) => citation.sourceId === "bp-card-printing"));
  }
});
