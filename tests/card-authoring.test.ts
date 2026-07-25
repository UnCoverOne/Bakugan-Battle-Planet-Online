import assert from "node:assert/strict";
import test from "node:test";
import {
  cardDraftFromCatalogue,
  createCardAuthoringPatch,
  emptyCardDraft,
  goldenTestTemplateForCard,
  normalizeCardDraft,
  validateCardDraft,
} from "../lib/content/card-authoring";
import { CONTROLLED_CATALOGUE, cardSetCode } from "../lib/content/catalogue";

const battleBrawlers = CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "BB");
const errorCodes = (issues: ReturnType<typeof validateCardDraft>["issues"]) => issues.filter((item) => item.severity === "error").map((item) => item.code);

test("every Battle Brawlers record remains compatible with the existing card editor", () => {
  assert.equal(battleBrawlers.length, 374);
  for (const card of battleBrawlers) {
    const validation = validateCardDraft(cardDraftFromCatalogue(card), { baseCardId: card.id, catalogue: battleBrawlers });
    assert.deepEqual(errorCodes(validation.issues), [], `${card.id} should remain editor-valid`);
    assert.ok(validation.generatedDefinition, `${card.id} should generate a draft rule definition`);
    assert.equal(validation.generatedDefinition?.implementationStatus, "draft");
    assert.equal(validation.generatedDefinition?.provenance.reviewed, false);
  }
});

test("the extension sets use globally unique, set-qualified catalogue identities", () => {
  const extensions = CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) !== "BB");
  assert.equal(extensions.length, 469);
  assert.equal(new Set(extensions.map((card) => card.id)).size, extensions.length);
  assert.ok(extensions.every((card) => /^(?:br|aa)-/.test(card.id)));
});

test("normalization repairs arrays and primary-faction shape without hiding blocking identity errors", () => {
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
  const codes = errorCodes(validateCardDraft(draft, { catalogue: battleBrawlers }).issues);
  assert.ok(codes.includes("CARD_ID_FORMAT"));
  assert.ok(codes.includes("CARD_ID_NUMBER_MISMATCH"));
  assert.ok(codes.includes("ART_PATH_INVALID"));
  assert.ok(codes.includes("SLUG_INVALID"));
});

test("duplicate Battle Brawlers identities are blocked unless the record is the selected base card", () => {
  const card = cardDraftFromCatalogue(battleBrawlers[10]);
  const unbound = validateCardDraft(card, { catalogue: battleBrawlers });
  assert.ok(errorCodes(unbound.issues).includes("DUPLICATE_CARD_ID"));
  assert.ok(errorCodes(unbound.issues).includes("DUPLICATE_CARD_NUMBER"));
  const replacement = validateCardDraft(card, { baseCardId: card.id, catalogue: battleBrawlers });
  assert.deepEqual(errorCodes(replacement.issues), []);
});

test("the authoring compiler still exposes typed actions and unreviewed provenance", () => {
  const source = battleBrawlers.find((card) => /draw two cards/i.test(card.effect)) ?? battleBrawlers.find((card) => card.effect.trim())!;
  const validation = validateCardDraft(cardDraftFromCatalogue(source), { baseCardId: source.id, catalogue: battleBrawlers });
  const definition = validation.generatedDefinition!;
  assert.equal(definition.cardId, source.id);
  assert.equal(definition.sourceText, source.effect);
  assert.equal(definition.implementationStatus, "draft");
  assert.equal(definition.provenance.reviewed, false);
  assert.ok(definition.provenance.citations.some((citation) => citation.sourceId === "bp-card-printing"));
  assert.ok(definition.abilities.some((ability) => ability.instructions.some((instruction) => instruction.effects.length > 0)));
});

test("replacement patches and scaffolds retain the existing Battle Brawlers workflow", () => {
  const source = battleBrawlers[0];
  const draft = cardDraftFromCatalogue(source);
  draft.effect = `${draft.effect}\nAuthoring-only note.`;
  draft.mechanics = [...draft.mechanics, "Authoring test"];
  const patch = createCardAuthoringPatch(draft, source.id);
  assert.equal(patch.operation, "replace");
  assert.deepEqual(Object.keys(patch.changedFields).sort(), ["effect", "mechanics"]);
  assert.match(patch.baseFingerprint ?? "", /^[0-9a-f]{8}$/);

  const scaffold = emptyCardDraft(374);
  scaffold.id = "bb-374";
  scaffold.displayName = "Authoring Fixture";
  scaffold.name = "Authoring Fixture";
  scaffold.slug = "authoring-fixture";
  const template = goldenTestTemplateForCard(scaffold);
  assert.match(template, /card-golden:bb-374 Authoring Fixture/);
  assert.match(template, /ruleDefinitionForCard/);
});
