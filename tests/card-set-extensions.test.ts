import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CARDS } from "../lib/data";
import { cardArtSource } from "../lib/content/card-art";
import { CARD_SET_INFO, cardCollectorLabel, cardSetCode } from "../lib/content/catalogue";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

const bySet = (set: "BB" | "BR" | "AA") => CARDS.filter((card) => cardSetCode(card) === set);

const repositoryAssetExists = (assetPath: string) => existsSync(join(process.cwd(), "public", assetPath.replace(/^\//, "")));

test("Bakugan Resurgence and Age of Aurelus are fully addressable", () => {
  assert.equal(bySet("BB").length, 374);
  assert.equal(bySet("BR").length, 249);
  assert.equal(bySet("AA").length, 220);
  assert.equal(CARDS.length, 843);
  assert.equal(CARD_SET_INFO.BR.collectorTotal, 248);
  assert.equal(CARD_SET_INFO.AA.collectorTotal, 220);
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
});

test("every extension card has rules provenance and a self-hosted art source", () => {
  for (const card of CARDS.filter((candidate) => cardSetCode(candidate) !== "BB")) {
    const definition = ruleDefinitionForCard(card);
    assert.equal(definition.cardId, card.catalogId);
    assert.equal(definition.sourceText, card.effect);
    assert.ok(definition.provenance.citations.some((citation) => citation.sourceId === "bp-card-printing"));
    if (card.hasProvidedScan) {
      const set = cardSetCode(card).toLowerCase();
      assert.equal(card.art, `/assets/cards/sets/${set}/full/${card.catalogId}.webp`);
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

test("Evo identities prefer the matching card set and faction", () => {
  const examples = ["br-90", "aa-77", "aa-125"];
  for (const id of examples) {
    const card = CARDS.find((candidate) => candidate.catalogId === id)!;
    const definition = ruleDefinitionForCard(card);
    assert.equal(card.type, "Evo");
    assert.equal(definition.play.evolvesFrom.length, 1, `${id} should resolve one canonical Character`);
    assert.ok(definition.play.evolvesFrom[0].startsWith(`${id.split("-")[0]}-`));
  }
});
