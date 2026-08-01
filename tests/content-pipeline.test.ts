import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import lockJson from "../content/card-content.lock.json";
import { cardArtSource } from "../lib/content/card-art";
import { CONTROLLED_CATALOGUE, CONTENT_MANIFEST, cardSetCode, textFingerprint, validateControlledCatalogue } from "../lib/content/catalogue";
import { allRuleDefinitions, ruleDefinitionForCard, validateCardAgainstRules } from "../lib/rules/catalogue";
import { RULES_SOURCES, validateDefinitionProvenance } from "../lib/rules/provenance";

const legacyLock = lockJson as {
  cards: Array<{ cardId: string; textFingerprint: string; implementationFingerprint: string; provenanceSources: string[]; goldenTestId: string }>;
};

const newlyProvidedCardArt = [
  "bb-26", "bb-32", "bb-207", "bb-215", "bb-228", "bb-302", "bb-346", "bb-366", "bb-368", "bb-374",
  "br-14", "br-15", "br-16", "br-17", "br-18", "br-19", "br-138", "br-139", "br-171", "br-172",
  "br-173", "br-177", "br-179", "br-180", "br-205", "br-206", "br-210", "br-211", "br-214", "br-215",
  "br-216", "br-217", "br-218", "br-219", "br-220", "br-221-pyravian-ultra", "br-223", "br-224",
  "br-226", "br-227", "br-230", "br-231", "br-232", "br-233", "br-235", "br-236", "br-238",
  "aa-52", "aa-54", "aa-55", "aa-70", "aa-71", "aa-72",
] as const;

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

test("newly supplied card scans resolve to full and thumbnail assets", () => {
  assert.equal(newlyProvidedCardArt.length, 53);
  for (const id of newlyProvidedCardArt) {
    const card = CONTROLLED_CATALOGUE.find((candidate) => candidate.id === id);
    assert.ok(card, `${id} must remain in the controlled catalogue.`);
    assert.equal(card.hasProvidedScan, true, `${id} must be marked as having supplied artwork.`);
    const full = cardArtSource({ art: card.art, hasProvidedScan: card.hasProvidedScan });
    const thumbnail = cardArtSource({ art: card.art, hasProvidedScan: card.hasProvidedScan }, "thumbnail");
    assert.notEqual(full, thumbnail, `${id} must expose a dedicated thumbnail.`);
    assert.equal(existsSync(join(process.cwd(), "public", full)), true, `${id} full artwork must exist.`);
    assert.equal(existsSync(join(process.cwd(), "public", thumbnail)), true, `${id} thumbnail artwork must exist.`);
  }
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
