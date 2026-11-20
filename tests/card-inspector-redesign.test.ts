import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS, CORE_COMPENDIUM } from "../lib/data";
import { CARD_INSPECTOR_TABS, compendiumSearchParams, coreCompendiumSearchParams,
  parseCompendiumState, parseCoreCompendiumState, parseInspectorTab } from "../lib/compendium";
import { RULEBOOK_IDS } from "../lib/rulebook-reader";
import { cardCollectionIds, collectionEntry, updateCollection } from "../lib/collection";
import { inspectorCardPrintings, inspectorDeveloperRulings, inspectorEvolutionBases,
  inspectorEvolutionChildren, inspectorFusionFace, inspectorOfficialRules } from "../lib/card-inspector-data";

const file = (name: string) => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const sample = (id: string) => {
  const result = CARDS.find(card => card.catalogId === id);
  assert.ok(result, "Expected card " + id);
  return result;
};

test("Inspector has exactly three tabs and maps old deep links to their replacements", () => {
  assert.deepEqual(CARD_INSPECTOR_TABS, ["overview", "references", "collection"]);
  assert.equal(parseInspectorTab("rules"), "references");
  assert.equal(parseInspectorTab("rulings"), "references");
  assert.equal(parseInspectorTab("related"), "overview");
  assert.equal(parseInspectorTab("unknown", "collection"), "collection");
  assert.equal(parseCompendiumState("card=bb-270&tab=rulings").tab, "references");
  assert.equal(parseCoreCompendiumState("core=core-1&tab=rules").tab, "references");
});

test("Selected printing survives URL round-trips without changing the playable card", () => {
  const card = parseCompendiumState("card=bb-270&printing=br-99&tab=references&faction=Pyrus&page=2");
  assert.equal(card.card, "bb-270");
  assert.equal(card.printing, "br-99");
  assert.deepEqual(parseCompendiumState(compendiumSearchParams(card)), card);
  const core = parseCoreCompendiumState("core=core-1&printing=aa-core-1&tab=collection&coreSet=Armored+Alliance");
  assert.equal(core.core, "core-1");
  assert.equal(core.printing, "aa-core-1");
  assert.deepEqual(parseCoreCompendiumState(coreCompendiumSearchParams(core)), core);
  assert.equal(compendiumSearchParams(parseCompendiumState("printing=orphan")).has("printing"), false);
  assert.equal(coreCompendiumSearchParams(parseCoreCompendiumState("printing=orphan")).has("printing"), false);
});

test("Card printing carousel groups exact playable profiles, not cards sharing a name", () => {
  const original = sample("bb-270");
  const identical = { ...original, id: "br-999", catalogId: "br-999", number: 999,
    art: "/assets/cards/sets/resurgence/full/999.webp", rarity: "Rare" };
  const differentStats = { ...identical, id: "br-998", catalogId: "br-998", bPower: 1500 };
  const differentFaction = { ...identical, id: "br-997", catalogId: "br-997", faction: "Darkus" as const,
    factions: ["Darkus" as const] };
  const differentText = { ...identical, id: "br-996", catalogId: "br-996", effect: "Different effect" };
  const result = inspectorCardPrintings(original, [
    original, identical, differentStats, differentFaction, differentText,
  ]);
  assert.deepEqual(result.map(card => card.catalogId), ["bb-270", "br-999"]);
  assert.deepEqual(inspectorCardPrintings(differentStats, [original, identical, differentStats])
    .map(card => card.catalogId), ["br-998"]);
});

test("Actual Evo base relationships resolve by exact Character name and faction", () => {
  const evo = sample("bb-270");
  const bases = inspectorEvolutionBases(evo, CARDS);
  assert.ok(bases.some(card => card.catalogId === "bb-343"));
  assert.ok(bases.every(card => card.type === "Character" && card.factions.includes("Pyrus")));
  assert.ok(!bases.some(card => card.displayName.includes("Ultra")));
  const children = inspectorEvolutionChildren(sample("bb-343"), CARDS);
  assert.ok(children.some(card => card.catalogId === "bb-270"));
  assert.ok(children.every(card => card.type === "Evo" && card.factions.includes("Pyrus")));
});

test("Fusion faces remain separate from printing groups", () => {
  const fusionBack = CARDS.find(card => card.fusionFace === "b" && card.fusionPairId &&
    CARDS.some(other => other.fusionPairId === card.fusionPairId && other.fusionFace === "a"));
  assert.ok(fusionBack);
  const front = CARDS.find(other => other.fusionPairId === fusionBack.fusionPairId &&
    other.fusionFace === "a");
  assert.ok(front);
  assert.equal(inspectorFusionFace(front, CARDS, "b").catalogId, fusionBack.catalogId);
  assert.equal(inspectorFusionFace(front, CARDS, "a").catalogId, front.catalogId);
  assert.ok(!inspectorCardPrintings(front, CARDS).some(card => card.fusionFace === "b"));
});

test("Official references resolve to actual rulebook sections; developer links require exact mentions", () => {
  const evo = sample("bb-270");
  const rules = inspectorOfficialRules(evo);
  assert.ok(rules.some(rule => rule.id === "3.3"));
  assert.ok(rules.every(rule => RULEBOOK_IDS.has(rule.id) &&
    rule.href === "/compendium/rules#section-" + rule.id));
  const rulings = inspectorDeveloperRulings(evo, undefined, CARDS);
  assert.ok(rulings.some(ruling => ruling.number === 40));
  assert.ok(rulings.every(ruling => ruling.mentionedCards.some(name =>
    name.toLowerCase() === evo.name.toLowerCase() ||
    name.toLowerCase() === evo.displayName.toLowerCase())));
  assert.equal(inspectorOfficialRules(sample("bb-270"), undefined).length > 0, true);
  const gear = CARDS.find(card => card.type === "Baku-Gear");
  assert.ok(gear);
  assert.deepEqual(inspectorOfficialRules(gear), []);
  const gearCore = CORE_COMPENDIUM.find(core => core.bakuGearCostReduction);
  assert.ok(gearCore);
  assert.deepEqual(inspectorDeveloperRulings(undefined, gearCore, CARDS).map(ruling => ruling.number), [3, 44]);
});

test("Collection quantity edits remain keyed to each physical printing", () => {
  const original = sample("bb-270");
  const other = { ...original, id: "br-999", catalogId: "br-999", number: 999 };
  const ids = cardCollectionIds(original, [original, other]);
  assert.deepEqual(ids, ["bb-270", "br-999"]);
  const data = updateCollection(updateCollection({}, ids[0], "foil", 1), ids[1], "wishlist", 2);
  assert.deepEqual(collectionEntry(data, ids[0]), { standard: 0, foil: 1, wishlist: 0 });
  assert.deepEqual(collectionEntry(data, ids[1]), { standard: 0, foil: 0, wishlist: 2 });
});

test("Inspector artwork, responsive tabs, printings, zoom and focus controls use the new shell only", () => {
  const view = file("components/cards/CardInspector.tsx");
  const css = file("components/cards/CardInspector.module.css");
  const modal = file("components/cards/InspectorModal.tsx");
  const compendium = file("components/routes/CompendiumScreen.tsx");
  const collection = file("components/routes/CollectionScreen.tsx");
  assert.match(view, /inspectorCardPrintings/);
  assert.match(view, /inspectorEvolutionBases/);
  assert.match(view, /onPrintingChange/);
  assert.match(view, /onTouchStart=\{onImageTouchStart\}/);
  assert.match(view, /onTouchEnd=\{onImageTouchEnd\}/);
  assert.match(view, /aria-label="Previous printing"/);
  assert.match(view, /aria-label="Next printing"/);
  assert.match(view, /Printing \{slideIndex \+ 1\} of \{slides.length\}/);
  assert.match(view, /dataUi="inspector-art-zoom"/);
  assert.match(view, /aria-pressed=\{fusionFace === "b"\}/);
  assert.match(view, /<CardOverview card=\{displayedCard\}/);
  assert.match(view, /<CoreOverview core=\{core\}/);
  assert.match(view, /<footer className=\{styles.collector\}>/);
  assert.match(view, /<StatusChip>\{displayedCard.type\}<\/StatusChip>/);
  assert.match(view, /<Stat label="Energy">\{card.cost\}<\/Stat>/);
  assert.match(view, /<dt>Roll Accuracy<\/dt>/);
  assert.match(view, /<dt>Double Core Chance<\/dt>/);
  assert.match(view, /role="tablist"/);
  assert.match(view, /onTabsKeyDown/);
  assert.doesNotMatch(view, /matchingReferencesForTerms|relatedCompendiumCards|function CoreRelated|tabsWithCollection|BakuganRollingOverlay/);
  assert.doesNotMatch(css, /clip-path|linear-gradient|\.relatedGrid|\.collectionVariant|\.modal \.overview/);
  assert.match(css, /@media\(max-width: 900px\)/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(modal, /dataUi !== "inspector-art-zoom"/);
  for (const route of [compendium, collection]) {
    assert.match(route, /onPrintingChange/);
    assert.doesNotMatch(route, /rules=\{ruleReferences\}|rulings=\{PUBLISHED_RULINGS\}/);
  }
});
