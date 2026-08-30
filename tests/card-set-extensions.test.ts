import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CARDS } from "../lib/data";
import { cardArtSource } from "../lib/content/card-art";
import { CARD_SET_INFO, CONTENT_MANIFEST, cardCollectorLabel, cardSetCode } from "../lib/content/catalogue";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

const bySet = (set: keyof typeof CARD_SET_INFO) => CARDS.filter((card) => cardSetCode(card) === set);

const repositoryAssetExists = (assetPath: string) => existsSync(join(process.cwd(), "public", assetPath.replace(/^\//, "")));

test("every supported card set is fully addressable", () => {
  assert.equal(bySet("BB").length, 374);
  assert.equal(bySet("BR").length, 249);
  assert.equal(bySet("AA").length, 220);
  assert.equal(bySet("EX").length, 2);
  assert.equal(bySet("AV").length, 272);
  assert.equal(bySet("FF").length, 276);
  assert.equal(bySet("SV").length, 310);
  assert.equal(bySet("PS1").length, 21);
  assert.equal(bySet("CP").length, 6);
  assert.equal(bySet("DI").length, 4);
  assert.equal(CARDS.length, CONTENT_MANIFEST.cardCount);
  assert.equal(CARDS.length, 1734);
  assert.deepEqual(CONTENT_MANIFEST.sets, { BB: 374, BR: 249, AA: 220, EX: 2, AV: 272, FF: 276, DI: 4, PS1: 21, SV: 310, CP: 6 });
  assert.equal(CARD_SET_INFO.BR.collectorTotal, 248);
  assert.equal(CARD_SET_INFO.AA.collectorTotal, 220);
  assert.equal(CARD_SET_INFO.EX.collectorTotal, 2);
});

test("the duplicate Bakugan Resurgence 221 printings retain separate catalogue identities", () => {
  const printings = bySet("BR").filter((card) => card.number === 221);
  assert.deepEqual(printings.map((card) => card.catalogId).sort(), ["br-221-artulean-ultra", "br-221-pyravian-ultra"]);
  assert.deepEqual(printings.map((card) => card.displayName).sort(), ["Artulean Ultra", "Pyravian Ultra"]);
});

test("collector labels are set-aware", () => {
  assert.equal(cardCollectorLabel(CARDS.find((card) => card.catalogId === "bb-1")!), "1/374 BB");
  assert.equal(cardCollectorLabel(CARDS.find((card) => card.catalogId === "br-1")!), "1/248 BR");
  assert.equal(cardCollectorLabel(CARDS.find((card) => card.catalogId === "aa-1")!), "1/220 AA");
  assert.equal(cardCollectorLabel(CARDS.find((card) => card.catalogId === "ff-203a")!), "203a/241 FF");
});

test("every extension card has rules provenance and a self-hosted art source", () => {
  for (const card of CARDS.filter((candidate) => cardSetCode(candidate) !== "BB")) {
    const definition = ruleDefinitionForCard(card);
    assert.equal(definition.cardId, card.catalogId);
    assert.equal(definition.sourceText, card.effect);
    assert.ok(definition.provenance.citations.some((citation) => citation.sourceId === "bp-card-printing"));
    if (card.hasProvidedScan) {
      assert.match(card.art, /^\/assets\/cards\/sets\/(?:br|aa|ex|av|ff|sv|ps1|cp|di)\/full\/.+\.(?:webp|svg)$/);
      assert.ok(repositoryAssetExists(card.art), `${card.catalogId} full scan is missing`);
      assert.ok(repositoryAssetExists(cardArtSource(card, "thumbnail")), `${card.catalogId} thumbnail is missing`);
    } else {
      assert.equal(card.art, "/assets/cards/card-missing.svg");
    }
    assert.ok(!/^https?:\/\//i.test(card.art), `${card.catalogId} must not rely on external artwork`);
  }
});

test("card art resolution preserves set-qualified local scan sources", () => {
  const battleBrawlers = CARDS.find((card) => card.catalogId === "bb-1")!;
  const resurgence = CARDS.find((card) => card.catalogId === "br-1")!;
  const ageOfAurelus = CARDS.find((card) => card.catalogId === "aa-1")!;

  assert.equal(cardArtSource(battleBrawlers, "thumbnail"), "/assets/cards/thumb/1.webp");
  assert.equal(cardArtSource(resurgence, "thumbnail"), "/assets/cards/sets/br/thumb/br-1.webp");
  assert.equal(cardArtSource(ageOfAurelus, "thumbnail"), "/assets/cards/sets/aa/thumb/aa-1.webp");
});

test("Armored Alliance records preserve modern card characteristics", () => {
  const fusion = CARDS.find((card) => card.catalogId === "ff-203a")!;
  const gear = CARDS.find((card) => card.catalogId === "di-1")!;
  const modernDamage = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "sv-29")!);
  const reroll = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "av-53")!);

  assert.deepEqual(fusion.factions, ["Ventus", "Aurelus"]);
  assert.equal(fusion.fusionFace, "a");
  assert.equal(fusion.fusionPairId, "ff-203");
  assert.equal(gear.type, "Baku-Gear");
  assert.equal(gear.armorRating, 0);
  assert.match(gear.effect, /Armor/);
  assert.ok(modernDamage.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects)
    .some((effect) => effect.kind === "modify-stat" && effect.stat === "damage" && effect.amount === -10));
  assert.ok(reroll.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects)
    .some((effect) => effect.kind === "reroll"));
});

test("Evo identities prefer the matching card set and faction", () => {
  for (const id of ["br-90", "aa-77"]) {
    const card = CARDS.find((candidate) => candidate.catalogId === id)!;
    const definition = ruleDefinitionForCard(card);
    assert.equal(card.type, "Evo");
    assert.equal(definition.play.evolvesFrom.length, 1, `${id} should resolve one canonical Character`);
    assert.ok(definition.play.evolvesFrom[0].startsWith(`${id.split("-")[0]}-`));
  }

  const crossSetEvo = CARDS.find((candidate) => candidate.catalogId === "aa-125")!;
  const [fallbackId] = ruleDefinitionForCard(crossSetEvo).play.evolvesFrom;
  const fallback = CARDS.find((candidate) => candidate.catalogId === fallbackId);
  assert.equal(fallbackId, "br-212");
  assert.equal(fallback?.type, "Character");
  assert.equal(fallback?.faction, crossSetEvo.faction);
  assert.equal(fallback?.displayName, "Lupitheon Ultra");
});
