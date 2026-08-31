import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, resolveStructuredEffect, type PlayerState } from "../lib/game";
import { conditionFor } from "../lib/rules/catalogue-primitives";
import { ruleConditionActive } from "../lib/rules/modifiers";
import { ensureRulesState } from "../lib/rules/state";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { createRuleObject } from "../lib/rules/objects";
import {
  flipDamageCard,
  playerCanFlipDamage,
  resolveManualDamage,
} from "../lib/manualDamage";

type EnergyTrackedPlayer = PlayerState & {
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

function damageCards() {
  const ordinary = CARDS.find((card) => card.type === "Action");
  const flip = CARDS.find((card) => card.type === "Flip");
  assert.ok(ordinary);
  assert.ok(flip);
  return {
    ordinary: { ...ordinary, id: "ordinary-damage" },
    flip: { ...flip, id: "revealed-damage-flip" },
  };
}

function armorDamageMatch(pendingDamage = 5) {
  const loser = makePlayer("armor-loser", "Dan", STARTER_DECKS[0]);
  const winner = makePlayer("armor-winner", "Magnus", STARTER_DECKS[1]);
  const armor = CARDS.find((card) => card.catalogId === "sv-105");
  assert.ok(armor);
  loser.deckCards = [{ ...armor, id: "armor-damage-card" }];
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  const match = createMatch("ARMOR", "bo1", [loser, winner]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = loser.id;
  match.pendingDamage = pendingDamage;
  match.damageOrigin = winner.bakugan[0].id;
  match.priority = loser.id;
  return { match, loser, winner, armor: loser.deckCards[0] };
}

test("Armor counts as additional damage cards during the Damage Step", () => {
  const { match, loser, armor } = armorDamageMatch();
  const next = flipDamageCard(match, loser.id);

  assert.equal(next.pendingDamage, 2);
  assert.equal(next.players[0].discard[0].id, armor.id);
  assert.equal(ensureRulesState(next).armorDamageReducedThisTurn?.[loser.id], 2);
  assert.match(next.log.at(-1)?.message ?? "", /Armor 2.*absorbed 3.*2 remaining/);
});

test("Armor only applies to Baku-Gear and never reduces below zero", () => {
  const { match, loser } = armorDamageMatch(1);
  const ordinary = { ...loser.deckCards[0], id: "ordinary-with-invalid-armor", type: "Action" as const, armorRating: 99 };
  loser.deckCards = [ordinary];
  loser.deck = 1;
  const ordinaryResult = flipDamageCard(match, loser.id);
  assert.equal(ordinaryResult.pendingDamage, 0);
  assert.equal(ensureRulesState(ordinaryResult).armorDamageReducedThisTurn?.[loser.id] ?? 0, 0);

  const capped = armorDamageMatch(1);
  const cappedResult = flipDamageCard(capped.match, capped.loser.id);
  assert.equal(cappedResult.pendingDamage, 0);
  assert.equal(ensureRulesState(cappedResult).armorDamageReducedThisTurn?.[capped.loser.id] ?? 0, 0);
});

test("Ignore Armor Rating removes only the Armor bonus", () => {
  const { match, loser, winner } = armorDamageMatch();
  ensureRulesState(match).ignoreArmorRating![winner.id] = true;
  const next = flipDamageCard(match, loser.id);

  assert.equal(next.pendingDamage, 4);
  assert.equal(ensureRulesState(next).armorDamageReducedThisTurn?.[loser.id] ?? 0, 0);
  assert.match(next.log.at(-1)?.message ?? "", /Armor 2 ignored.*absorbed 1.*4 remaining/);
});

test("Armor Rating printings compile their ignore and trigger conditions", () => {
  const cards = ["sv-47", "sv-140", "sv-148"].map((catalogId) => {
    const source = CARDS.find((card) => card.catalogId === catalogId);
    assert.ok(source);
    return { ...source, id: `test-${catalogId}` };
  });
  const shieldbreaker = ruleDefinitionForCard(cards[0]);
  const eenoch = ruleDefinitionForCard(cards[1]);
  const hydorous = ruleDefinitionForCard(cards[2]);
  assert.ok(shieldbreaker.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "ignore-armor-rating"));
  assert.ok(eenoch.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "ignore-armor-rating"));
  assert.deepEqual(hydorous.play.costModifiers.find((effect) => effect.kind === "cost-alternative")?.condition, {
    kind: "armor-damage-reduced",
    subject: "opponent",
  });

  const { match, loser, winner } = armorDamageMatch();
  const condition = conditionFor("If an opposing player reduced damage with Armor Rating this turn, you may play this for free.");
  assert.equal(ruleConditionActive(match, winner, condition), false);
  const afterArmor = flipDamageCard(match, loser.id);
  assert.equal(ruleConditionActive(afterArmor, winner, condition), true);

  const victorState = armorDamageMatch().match;
  const victorWinner = victorState.players[1];
  victorState.phase = "victor";
  victorState.brawlWinner = victorWinner.id;
  victorState.selected[victorWinner.id] = victorWinner.bakugan[0].id;
  victorWinner.bakugan[0].open = true;
  const eenochCard = cards[1];
  const eenochAbility = ruleDefinitionForCard(eenochCard).abilities.find((ability) => ability.kind === "triggered");
  assert.ok(eenochAbility);
  const resolved = resolveStructuredEffect(victorState, createRuleObject({
    controllerId: victorWinner.id,
    card: eenochCard,
    ability: eenochAbility,
    kind: "trigger",
  }));
  assert.equal(ensureRulesState(resolved).ignoreArmorRating?.[victorWinner.id], true);
});

test("damage cards move from the deck to discard one click at a time", () => {
  const loser = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const winner = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary, flip } = damageCards();
  loser.deckCards = [ordinary, flip];
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  const match = createMatch("DMG001", "bo1", [loser, winner]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = loser.id;
  match.pendingDamage = 2;
  match.priority = loser.id;

  assert.equal(playerCanFlipDamage(match, loser.id), true);
  const first = flipDamageCard(match, loser.id);
  assert.equal(first.pendingDamage, 1);
  assert.equal(first.players[0].deckCards.length, 1);
  assert.deepEqual(first.players[0].discard.map((card) => card.id), [ordinary.id]);
  assert.equal(first.revealedFlip, undefined);

  const second = flipDamageCard(first, loser.id);
  assert.equal(second.pendingDamage, 0);
  assert.equal(second.phase, "damage");
  assert.equal(second.revealedFlip?.id, flip.id);
  assert.deepEqual(second.players[0].discard.map((card) => card.id), [ordinary.id, flip.id]);
  assert.equal(playerCanFlipDamage(second, loser.id), false);

  const skipped = resolveManualDamage(second, loser.id);
  assert.equal(skipped.phase, "postDamage");
  assert.equal(skipped.revealedFlip, undefined);
});

test("playing a revealed Flip automatically taps its Energy shortfall", () => {
  const loser = makePlayer("player-a", "Dan", STARTER_DECKS[0]) as EnergyTrackedPlayer;
  const winner = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary, flip } = damageCards();
  const payableFlip = { ...flip, cost: 2 as const };
  loser.deckCards = [payableFlip, ordinary];
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  loser.energyZone = [
    { ...ordinary, id: "damage-energy-1" },
    { ...ordinary, id: "damage-energy-2" },
  ];
  loser.energy = 0;
  loser.energyTapTurn = 1;
  loser.tappedEnergyIds = [];
  const match = createMatch("DMG002", "bo1", [loser, winner]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = loser.id;
  match.pendingDamage = 2;
  match.priority = loser.id;

  const revealed = flipDamageCard(match, loser.id);
  assert.equal(revealed.pendingDamage, 1);
  assert.equal(revealed.revealedFlip?.id, payableFlip.id);

  const played = resolveManualDamage(revealed, loser.id, payableFlip.id);
  const updated = played.players[0] as EnergyTrackedPlayer;
  assert.equal(updated.energy, 0);
  assert.deepEqual(updated.tappedEnergyIds, ["damage-energy-1", "damage-energy-2"]);
  assert.equal(played.revealedFlip, undefined);
  assert.ok(played.phase === "damage" || played.phase === "postDamage");
});

test("the Victor window enters manual damage without consuming the loser deck", () => {
  const winner = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const loser = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary } = damageCards();
  loser.deckCards = Array.from({ length: 10 }, (_, index) => ({
    ...ordinary,
    id: `manual-deck-${index}`,
  }));
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  const match = createMatch("DMG003", "bo1", [winner, loser]);
  match.turn = 1;
  match.phase = "victor";
  match.stepLabel = "Brawl Phase • Victor Step";
  match.startingPlayer = winner.id;
  match.priority = winner.id;
  match.brawlWinner = winner.id;
  match.selected[winner.id] = winner.bakugan[0].id;
  match.selected[loser.id] = loser.bakugan[0].id;
  winner.bakugan[0].open = true;
  loser.bakugan[0].open = true;
  const deckBefore = loser.deckCards.map((card) => card.id);

  const firstPass = passPriority(match, winner.id);
  assert.equal(firstPass.phase, "victor");
  const damage = passPriority(firstPass, loser.id);
  assert.equal(damage.phase, "damage");
  assert.ok(damage.pendingDamage > 0);
  assert.equal(damage.revealedFlip, undefined);
  assert.deepEqual(damage.players[1].deckCards.map((card) => card.id), deckBefore);
  assert.deepEqual(damage.players[1].discard, []);
});
