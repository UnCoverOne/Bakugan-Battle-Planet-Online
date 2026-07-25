import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_EDITOR_VERSION,
  cardDraftFromCatalogue,
  createCardAuthoringBundle,
  createCardAuthoringPatch,
  emptyCardDraft,
  goldenTestTemplateForCard,
  normalizeCardDraft,
  parseCardAuthoringBundle,
  serializeCardAuthoringBundle,
  validateCardDraft,
} from "../lib/content/card-authoring";
import { CONTROLLED_CATALOGUE } from "../lib/content/catalogue";
import { CARD_CATALOGUE_VERSION, CONTENT_SCHEMA_VERSION, RULES_PROFILE_VERSION } from "../lib/content/versions";

const errorCodes = (issues: ReturnType<typeof validateCardDraft>["issues"]) => issues.filter((item) => item.severity === "error").map((item) => item.code);

test("every controlled catalogue record can enter the card editor without schema errors", () => {
  for (const card of CONTROLLED_CATALOGUE) {
    const validation = validateCardDraft(cardDraftFromCatalogue(card), { baseCardId: card.id });
    assert.deepEqual(errorCodes(validation.issues), [], `${card.id} should be editor-valid`);
    assert.ok(validation.generatedDefinition, `${card.id} should generate a draft rule definition`);
    assert.equal(validation.generatedDefinition?.implementationStatus, "draft");
    assert.equal(validation.generatedDefinition?.provenance.reviewed, false);
  }
});

test("normalization repairs array and primary-faction shape without hiding blocking identity errors", () => {
  const draft = normalizeCardDraft({
    id: "bad id",
    number: 93,
    name: "  Test Card  ",
    displayName: "",
    faction: "Pyrus",
    factions: ["Aquos", "Pyrus", "Pyrus", "not-a-faction"],
    type: "Action",
    cost: -4,
    rarity: "Rare",
    effect: "Draw two cards.",
    mechanics: [" Draw ", "Draw", ""],
    bPower: null,
    damage: null,
    coreTypes: ["Fist", "Fist", "invalid"],
    evolvesFrom: null,
    art: "bad-path.png",
    slug: "Bad Slug",
  });
  assert.deepEqual(draft.factions, ["Aquos", "Pyrus"]);
  assert.deepEqual(draft.mechanics, ["Draw"]);
  assert.deepEqual(draft.coreTypes, ["Fist"]);
  const codes = errorCodes(validateCardDraft(draft).issues);
  assert.ok(codes.includes("CARD_ID_FORMAT"));
  assert.ok(codes.includes("CARD_ID_NUMBER_MISMATCH"));
  assert.ok(codes.includes("ART_PATH_INVALID"));
  assert.ok(codes.includes("SLUG_INVALID"));
});

test("duplicate catalogue identities are blocked unless the record is the selected base card", () => {
  const card = cardDraftFromCatalogue(CONTROLLED_CATALOGUE[10]);
  const unbound = validateCardDraft(card);
  assert.ok(errorCodes(unbound.issues).includes("DUPLICATE_CARD_ID"));
  assert.ok(errorCodes(unbound.issues).includes("DUPLICATE_CARD_NUMBER"));
  const replacement = validateCardDraft(card, { baseCardId: card.id });
  assert.deepEqual(errorCodes(replacement.issues), []);
});

test("characteristics enforce Evo identity and combat-stat requirements", () => {
  const evo = emptyCardDraft(300);
  evo.id = "bb-300";
  evo.type = "Evo";
  evo.bPower = null;
  evo.damage = null;
  evo.evolvesFrom = null;
  const codes = errorCodes(validateCardDraft(evo, { baseCardId: "bb-300" }).issues);
  assert.ok(codes.includes("BPOWER_REQUIRED"));
  assert.ok(codes.includes("DAMAGE_REQUIRED"));
  assert.ok(codes.includes("EVO_IDENTITY_REQUIRED"));
});

test("the authoring compiler exposes typed actions, choices, and unreviewed provenance", () => {
  const source = CONTROLLED_CATALOGUE.find((card) => /draw two cards/i.test(card.effect)) ?? CONTROLLED_CATALOGUE.find((card) => card.effect.trim())!;
  const validation = validateCardDraft(cardDraftFromCatalogue(source), { baseCardId: source.id });
  const definition = validation.generatedDefinition!;
  assert.equal(definition.cardId, source.id);
  assert.equal(definition.sourceText, source.effect);
  assert.equal(definition.implementationStatus, "draft");
  assert.equal(definition.provenance.reviewed, false);
  assert.ok(definition.provenance.citations.some((citation) => citation.sourceId === "bp-card-printing"));
  assert.ok(definition.abilities.some((ability) => ability.instructions.some((instruction) => instruction.effects.length > 0)));
});

test("review bundles round-trip with independent content versions and a stable fingerprint", () => {
  const source = CONTROLLED_CATALOGUE[92];
  const bundle = createCardAuthoringBundle(cardDraftFromCatalogue(source), source.id);
  assert.equal(bundle.editorVersion, CARD_EDITOR_VERSION);
  assert.equal(bundle.schemaVersion, CONTENT_SCHEMA_VERSION);
  assert.equal(bundle.catalogueVersion, CARD_CATALOGUE_VERSION);
  assert.equal(bundle.rulesVersion, RULES_PROFILE_VERSION);
  assert.match(bundle.fingerprint, /^[0-9a-f]{8}$/);
  const parsed = parseCardAuthoringBundle(serializeCardAuthoringBundle(bundle));
  assert.deepEqual(parsed.card, bundle.card);
  assert.equal(parsed.baseCardId, source.id);
  assert.deepEqual(errorCodes(parsed.issues), []);
});

test("replacement patches contain only fields changed from the controlled base record", () => {
  const source = CONTROLLED_CATALOGUE[0];
  const draft = cardDraftFromCatalogue(source);
  draft.effect = `${draft.effect}\nAuthoring-only note.`;
  draft.mechanics = [...draft.mechanics, "Authoring test"];
  const patch = createCardAuthoringPatch(draft, source.id);
  assert.equal(patch.operation, "replace");
  assert.deepEqual(Object.keys(patch.changedFields).sort(), ["effect", "mechanics"]);
  assert.match(patch.baseFingerprint ?? "", /^[0-9a-f]{8}$/);
});

test("unbound scaffolds export an add patch and a card-specific golden-test template", () => {
  const draft = emptyCardDraft(374);
  draft.id = "bb-374";
  draft.displayName = "Authoring Fixture";
  draft.name = "Authoring Fixture";
  draft.slug = "authoring-fixture";
  const patch = createCardAuthoringPatch(draft);
  assert.equal(patch.operation, "add");
  assert.equal(patch.changedFields.id, "bb-374");
  const template = goldenTestTemplateForCard(draft);
  assert.match(template, /card-golden:bb-374 Authoring Fixture/);
  assert.match(template, /ruleDefinitionForCard/);
});
