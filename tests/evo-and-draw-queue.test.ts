import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { playCardWithAutoEnergy } from "../lib/cardPayment";
import {
  activePendingDraw,
  hasPendingDraws,
  pendingDrawCountForPlayer,
} from "../lib/drawQueue";
import {
  characterCardIsFaceUp,
  evoCanTarget,
  legalEvoTargets,
} from "../lib/evo";
import { createMatch, passPriority, submitCardChoice, type CardChoices, type GameCard } from "../lib/game";
import { drawTurnCard, playerCanDrawTurnCard } from "../lib/turnStart";
import { buildChoiceSchema } from "../lib/rules/choices";
import { compileCardEffect } from "../lib/rules/effects";

function players() {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  return { player, opponent };
}

function compatibleEvo(player: ReturnType<typeof makePlayer>) {
  const card = CARDS.find((candidate) => (
    candidate.type === "Evo"
    && player.bakugan.some((bakugan) => evoCanTarget(candidate, bakugan))
  ));
  assert.ok(card, "starter team must have a compatible Evo");
  return card;
}

function giveEnergy(player: ReturnType<typeof makePlayer>, amount = 20) {
  player.energyZone = player.deckCards.splice(0, amount);
  player.energy = 0;
}

function resolveTopBatch(match: ReturnType<typeof createMatch>, playerId: string, opponentId: string) {
  const firstPass = passPriority(match, playerId);
  let resolved = passPriority(firstPass, opponentId);
  while (resolved.pendingChoice) {
    const pending = resolved.pendingChoice;
    const field = pending.schema.fields.find((candidate) => !pending.answers[candidate.chooserId]);
    assert.ok(field);
    const choices = { [field.id]: field.id === "confirmed" ? true : field.options[0]?.id } as CardChoices;
    resolved = submitCardChoice(resolved, field.chooserId, choices);
  }
  return resolved;
}

test("Evos target only matching Characters, remain stacked, and turn the Character face up", () => {
  const { player, opponent } = players();
  const source = compatibleEvo(player);
  const target = player.bakugan.find((bakugan) => evoCanTarget(source, bakugan));
  assert.ok(target);
  giveEnergy(player);
  const firstEvo = { ...structuredClone(source), id: "evo-first" };
  player.hand = [firstEvo];
  const match = createMatch("EVOSTK", "bo1", [player, opponent]);
  match.turn = 2;
  match.phase = "power";
  match.startingPlayer = player.id;
  match.priority = player.id;

  assert.deepEqual(legalEvoTargets(match, player.id, firstEvo).map((bakugan) => bakugan.id), [target.id]);
  const played = playCardWithAutoEnergy(match, player.id, firstEvo.id, {
    targetBakuganId: target.id,
  });
  const resolved = resolveTopBatch(played, player.id, opponent.id);
  const resolvedTarget = resolved.players[0].bakugan.find((bakugan) => bakugan.id === target.id)!;
  assert.equal(resolvedTarget.open, false, "playing an Evo must not falsely open the physical Bakugan");
  assert.equal(characterCardIsFaceUp(resolvedTarget), true);
  assert.deepEqual(resolvedTarget.evoStack.map((card) => card.id), [firstEvo.id]);

  const secondEvo = { ...structuredClone(source), id: "evo-second" };
  resolved.players[0].hand.push(secondEvo);
  resolved.priority = player.id;
  resolved.passes = [];
  const playedAgain = playCardWithAutoEnergy(resolved, player.id, secondEvo.id, {
    targetBakuganId: target.id,
  });
  const resolvedAgain = resolveTopBatch(playedAgain, player.id, opponent.id);
  const stackedTarget = resolvedAgain.players[0].bakugan.find((bakugan) => bakugan.id === target.id)!;
  assert.deepEqual(stackedTarget.evoStack.map((card) => card.id), [firstEvo.id, secondEvo.id]);
});

test("a resolving multi-draw effect creates one Draw action for each card", () => {
  const { player, opponent } = players();
  const source = CARDS.find((card) => /draw three cards/i.test(card.effect) && card.type === "Action");
  assert.ok(source);
  const effectCard: GameCard = { ...structuredClone(source), id: "multi-draw-effect" };
  const match = createMatch("DRAWQ", "bo1", [player, opponent]);
  match.turn = 2;
  match.phase = "power";
  match.startingPlayer = player.id;
  match.priority = player.id;
  match.passes = [opponent.id];
  match.batch = [{
    id: "multi-draw-pending",
    controllerId: player.id,
    card: effectCard,
    choices: { targetBakuganId: player.bakugan[0].id },
    kind: "card",
  }];
  const handBefore = player.hand.length;
  const deckBefore = player.deckCards.length;

  const resolved = passPriority(match, player.id);
  assert.equal(hasPendingDraws(resolved), true);
  assert.equal(activePendingDraw(resolved)?.remaining, 3);
  assert.equal(pendingDrawCountForPlayer(resolved, player.id), 3);
  assert.equal(resolved.players[0].hand.length, handBefore);
  assert.equal(resolved.players[0].deckCards.length, deckBefore);
  assert.equal(playerCanDrawTurnCard(resolved, player.id), true);
  assert.throws(
    () => passPriority(resolved, player.id),
    /pending Draw/i,
  );

  const afterOne = drawTurnCard(resolved, player.id);
  assert.equal(afterOne.players[0].hand.length, handBefore + 1);
  assert.equal(pendingDrawCountForPlayer(afterOne, player.id), 2);
  const afterTwo = drawTurnCard(afterOne, player.id);
  assert.equal(afterTwo.players[0].hand.length, handBefore + 2);
  assert.equal(pendingDrawCountForPlayer(afterTwo, player.id), 1);
  const afterThree = drawTurnCard(afterTwo, player.id);
  assert.equal(afterThree.players[0].hand.length, handBefore + 3);
  assert.equal(afterThree.players[0].deckCards.length, deckBefore - 3);
  assert.equal(hasPendingDraws(afterThree), false);
});

test("Everett Ray and Aquos Hyper Fangzor do not create false resolution choices", () => {
  const { player, opponent } = players();
  const match = createMatch("NOFAKE", "bo1", [player, opponent]);
  const everett = CARDS.find((card) => card.name === "Everett Ray" && card.type === "Hero");
  assert.ok(everett);
  const everettSchema = buildChoiceSchema(match, player.id, everett);
  assert.deepEqual(everettSchema.fields, []);

  const powerAction = compileCardEffect(everett).instructions
    .flatMap((instruction) => instruction.actions)
    .find((action) => action.kind === "modify-stat" && action.stat === "power");
  if (powerAction?.kind !== "modify-stat") throw new Error("Everett Ray must compile a B-Power modifier.");
  assert.equal(powerAction.scope, "all-friendly");

  const fangzor = CARDS.find((card) => (
    card.type === "Evo"
    && card.faction === "Aquos"
    && /Hyper Fangzor/i.test(card.displayName || card.name)
    && /when you play this,? draw three cards/i.test(card.effect)
  ));
  assert.ok(fangzor);
  const triggerInstruction = compileCardEffect(fangzor).instructions.find((instruction) => (
    instruction.actions.some((action) => action.kind === "trigger")
  ));
  assert.ok(triggerInstruction);
  const triggerSchema = buildChoiceSchema(
    match,
    player.id,
    fangzor,
    triggerInstruction.sourceText,
    { targetBakuganId: player.bakugan[0].id },
  );
  assert.deepEqual(triggerSchema.fields, []);
});
