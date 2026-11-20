import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS } from "../lib/data";
import { inspectorEvolutionBases, inspectorEvolutionChildren } from "../lib/card-inspector-data";
import { evoCanTarget } from "../lib/evo";
import { evoCharacterTargets, isCancelledEvo } from "../lib/evo-relationships";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import type { GameCard } from "../lib/game";

function card(id: string): GameCard {
  const found = CARDS.find(item => item.catalogId === id);
  assert.ok(found, "Missing catalogue card " + id);
  return found;
}

function bakugan(id: string) {
  const found = BAKUGAN.find(item => item.character.catalogId === id);
  assert.ok(found, "Missing Bakugan for " + id);
  return structuredClone(found);
}

const bases = (evoId: string) =>
  inspectorEvolutionBases(card(evoId), CARDS).map(item => item.catalogId);
const children = (characterId: string) =>
  inspectorEvolutionChildren(card(characterId), CARDS).map(item => item.catalogId);

test("Inspector relates Evo and Character cards only through exact catalogue identities", () => {
  assert.deepEqual(bases("bb-219"), ["bb-292"]);
  assert.ok(children("bb-292").includes("bb-219"));
  assert.ok(!children("av-172").includes("bb-219"));
  assert.ok(!bases("bb-270").includes("av-233"));
  assert.deepEqual(bases("aa-78"), ["br-179"]);
  assert.deepEqual(bases("av-117"), ["av-160"]);
  assert.deepEqual(bases("sv-141"), ["av-234"]);
});

test("Inspector and rules both expose all legitimate regular and Epic Character options", () => {
  const examples: Record<string, string[]> = {
    "ff-129": ["ff-164", "ff-222"],
    "av-118": ["av-166", "ff-217"],
    "ff-133": ["av-210", "ff-226"],
    "sv-139": ["sv-220b", "sv-260b"],
    "sv-137": ["sv-253"],
  };
  for (const [evoId, expected] of Object.entries(examples)) {
    assert.deepEqual(bases(evoId), expected, evoId);
    assert.deepEqual(evoCharacterTargets(evoId), expected, evoId);
    assert.deepEqual(ruleDefinitionForCard(card(evoId)).play.evolvesFrom, expected, evoId);
    for (const id of expected) {
      assert.ok(children(id).includes(evoId), evoId + " should appear under " + id);
    }
  }
  assert.ok(!children("bb-302").includes("ff-129"));
});

test("Game targeting accepts both ordinary and Epic Characters but not an unrelated same-name version", () => {
  const hyperPegatrix = card("bb-219");
  assert.equal(evoCanTarget(hyperPegatrix, bakugan("bb-292")), true);
  assert.equal(evoCanTarget(hyperPegatrix, bakugan("av-172")), false);
  const maximus = card("ff-129");
  assert.equal(evoCanTarget(maximus, bakugan("ff-164")), true);
  assert.equal(evoCanTarget(maximus, bakugan("ff-222")), true);
  assert.equal(evoCanTarget(maximus, bakugan("bb-302")), false);
});

test("Fused-only Evos target the b side only while the Bakugan is actually fused", () => {
  for (const [evoId, frontId, backId] of [
    ["sv-146", "sv-206a", "sv-206b"],
    ["sv-149", "sv-220a", "sv-220b"],
  ]) {
    const evo = card(evoId);
    const target = bakugan(frontId);
    assert.equal(target.fusionCharacter?.catalogId, backId);
    assert.deepEqual(bases(evoId), [backId]);
    assert.equal(evoCanTarget(evo, target), false, evoId + " must reject unfused face");
    assert.ok(!children(frontId).includes(evoId));
    assert.ok(children(backId).includes(evoId));
    target.fused = true;
    assert.equal(evoCanTarget(evo, target), true, evoId + " must accept the fused face");
    target.fusionCharacter = undefined;
    assert.equal(evoCanTarget(evo, target), false, evoId + " must not target without a valid b face");
  }
  // SV 139 is a different Evo: both regular and Epic fused Characters are legal.
  const diamond = card("sv-139");
  assert.equal(evoCanTarget(diamond, { ...bakugan("sv-220a"), fused: true }), true);
  assert.equal(evoCanTarget(diamond, { ...bakugan("sv-260a"), fused: true }), true);
  assert.equal(evoCanTarget(card("sv-149"), { ...bakugan("sv-260a"), fused: true }), false);
  assert.equal(evoCanTarget(card("sv-149"), bakugan("sv-220a")), false);
});

test("Cancelled Evo is never eligible for gameplay or linked in the Inspector", () => {
  assert.equal(isCancelledEvo("sv-261"), true);
  assert.deepEqual(evoCharacterTargets("sv-261"), []);
  assert.deepEqual(ruleDefinitionForCard(card("sv-261")).play.evolvesFrom, []);
  assert.deepEqual(bases("sv-261"), []);
  assert.ok(CARDS.filter(item => item.type === "Character")
    .every(character => !children(character.catalogId).includes("sv-261")));
  assert.ok(BAKUGAN.every(character => !evoCanTarget(card("sv-261"), character)));
});
