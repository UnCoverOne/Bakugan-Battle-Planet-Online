import assert from "node:assert/strict";
import test from "node:test";
import lockJson from "../content/card-content.lock.json";
import { CONTROLLED_CATALOGUE, CONTENT_MANIFEST, textFingerprint, validateControlledCatalogue } from "../lib/content/catalogue";
import { CURRENT_GAME_VERSION_PROFILE } from "../lib/content/versions";
import { allRuleDefinitions, ruleDefinitionForCard, validateCardAgainstRules } from "../lib/rules/catalogue";
import { RULES_SOURCES, validateDefinitionProvenance } from "../lib/rules/provenance";

const lock = lockJson as {
  versions: typeof CURRENT_GAME_VERSION_PROFILE;
  manifest: typeof CONTENT_MANIFEST;
  cards: Array<{ cardId: string; textFingerprint: string; implementationFingerprint: string; provenanceSources: string[]; goldenTestId: string }>;
};

test("the schema-controlled catalogue is complete, unique and locked", () => {
  assert.deepEqual(validateControlledCatalogue(), []);
  assert.equal(CONTROLLED_CATALOGUE.length, 374);
  assert.equal(new Set(CONTROLLED_CATALOGUE.map((card) => card.id)).size, 374);
  assert.deepEqual(lock.versions, CURRENT_GAME_VERSION_PROFILE);
  assert.deepEqual(lock.manifest, CONTENT_MANIFEST);
});

test("display text is cryptographically-like fingerprinted against each typed implementation", () => {
  const definitions = allRuleDefinitions();
  assert.equal(definitions.length, 374);
  assert.equal(lock.cards.length, 374);
  for (const card of CONTROLLED_CATALOGUE) {
    const runtimeCard = { ...card, id: card.id, catalogId: card.id };
    assert.equal(validateCardAgainstRules(runtimeCard), true);
    const definition = ruleDefinitionForCard(runtimeCard);
    const locked = lock.cards.find((entry) => entry.cardId === card.id);
    assert.ok(locked, `${card.id} must have a golden content lock.`);
    assert.equal(definition.sourceTextFingerprint, textFingerprint(card.effect));
    assert.equal(locked.textFingerprint, definition.sourceTextFingerprint);
    assert.equal(locked.goldenTestId, `card-golden:${card.id}`);
    assert.ok(locked.implementationFingerprint.length >= 8);
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
