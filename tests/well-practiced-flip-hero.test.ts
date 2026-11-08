import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, type GameCard, type MatchState } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { emitRuleEvent } from "../lib/rules/triggers";

function printedCard(catalogId: string, instanceId: string): GameCard {
  const template = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(template, "Missing " + catalogId);
  return { ...template, id: instanceId };
}

function fixture(ownCost: number | null, opponentCost: number | null) {
  const first = makePlayer("well-first", "First", STARTER_DECKS[0]);
  const second = makePlayer("well-second", "Second", STARTER_DECKS[1]);
  const state = createMatch("WELL-PRACTICED-REGRESSION", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  const hero = printedCard("av-75", "well-practiced-in-play");
  first.heroes = [hero];
  const opened = first.bakugan[0];
  opened.open = true;
  state.selected[first.id] = opened.id;
  state.selected[second.id] = second.bakugan[0].id;
  first.deckCards = ownCost === null ? [] : [{ ...printedCard("bb-1", "own-top"), cost: ownCost }];
  second.deckCards = opponentCost === null ? [] : [{ ...printedCard("bb-2", "opponent-top"), cost: opponentCost }];
  first.deck = first.deckCards.length;
  second.deck = second.deckCards.length;
  return { state, first, second, hero, opened };
}

function resolveBatch(input: MatchState) {
  let current = input;
  for (let attempts = 0; attempts < 30 && current.batch.length; attempts += 1) {
    assert.equal(current.pendingChoice, undefined);
    current = passPriority(current, current.priority);
  }
  assert.equal(current.batch.length, 0, "Well Practiced trigger did not finish resolving");
  return current;
}

test("Well Practiced compiles its entry and opening trigger separately, never as a static +500", () => {
  const definition = ruleDefinitionForCard(printedCard("av-75", "well-compiled"));
  const triggers = definition.abilities.filter((ability) => ability.kind === "triggered");
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].trigger?.event, "BAKUGAN_OPENED");
  assert.equal(triggers[0].trigger?.relationship, "controller");
  assert.deepEqual(
    triggers[0].instructions.flatMap((instruction) => instruction.effects)
      .filter((effect) => effect.kind === "compare-revealed-deck-costs"),
    [{ kind: "compare-revealed-deck-costs", bonus: 500 }],
  );
  assert.equal(definition.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .some((effect) => effect.kind === "modify-stat" && effect.stat === "power"), false);
});

for (const [ownCost, opponentCost, expected] of [
  [6, 3, 500], [2, 5, 0], [4, 4, 0], [null, 3, 0], [6, null, 0],
] as const) {
  test("Well Practiced compares " + ownCost + " against " + opponentCost, () => {
    const { state, first, second, hero, opened } = fixture(ownCost, opponentCost);
    const before = evaluateBakuganCharacteristics(state, opened, first).power;
    assert.equal(before, opened.bPower, "Hero must not grant an always-on modifier");
    emitRuleEvent(state, {
      id: "well-opening-" + ownCost + "-" + opponentCost,
      name: "BAKUGAN_OPENED", actorId: first.id, controllerId: first.id,
      targetBakuganId: opened.id, createdAt: Date.now(),
    });
    assert.equal(state.batch.filter((effect) => effect.card.id === hero.id).length, 1);
    const after = resolveBatch(state);
    assert.equal(after.powerBoost[opened.id] ?? 0, expected);
    assert.equal(evaluateBakuganCharacteristics(after, opened, first).power, before + expected);
    assert.equal(after.players[0].deckCards.length, ownCost === null ? 0 : 1);
    assert.equal(after.players[1].deckCards.length, opponentCost === null ? 0 : 1);
    assert.equal(after.powerBoost[second.bakugan[0].id] ?? 0, 0);
  });
}

test("Well Practiced does not trigger when only the opponent opens", () => {
  const { state, first, second } = fixture(6, 3);
  emitRuleEvent(state, {
    id: "opponent-only-opening", name: "BAKUGAN_OPENED",
    actorId: second.id, controllerId: second.id,
    targetBakuganId: second.bakugan[0].id, createdAt: Date.now(),
  });
  assert.equal(state.batch.some((effect) => effect.card.catalogId === "av-75"), false);
  assert.equal(state.powerBoost[first.bakugan[0].id] ?? 0, 0);
});
