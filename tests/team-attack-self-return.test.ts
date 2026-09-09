import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, resolveStructuredEffect, type GameCard } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { createRuleObject } from "../lib/rules/objects";
import { emitRuleEvent } from "../lib/rules/triggers";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function stateFor(source: GameCard) {
  const player = makePlayer("p", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("o", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("TEAM-RETURN", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "postDamage";
  state.startingPlayer = player.id;
  state.priority = player.id;
  const bakugan = player.bakugan[0];
  bakugan.open = true;
  state.selected[player.id] = bakugan.id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  if (source.type === "Hero") player.heroes.push(source);
  else if (source.type === "Evo") bakugan.evoStack = [source];
  return { state, player, opponent, bakugan };
}

function resolveTriggeredSelfReturn(state: ReturnType<typeof createMatch>, cardId: string, eventName: "TEAM_ATTACK_COMPLETED" | "TURN_ENDED") {
  const source = state.players[0].heroes.find((candidate) => candidate.id === cardId)
    ?? state.players[0].bakugan.flatMap((bakugan) => bakugan.evoStack).find((candidate) => candidate.id === cardId)
    ?? state.players[0].hand.find((candidate) => candidate.id === cardId);
  assert.ok(source, `Missing source card ${cardId}`);
  emitRuleEvent(state, {
    id: `${eventName}:${cardId}`,
    name: eventName,
    actorId: state.players[0].id,
    controllerId: state.players[0].id,
    card: eventName === "TURN_ENDED" ? undefined : undefined,
    createdAt: Date.now(),
  });
  const pending = state.batch.find((candidate) => candidate.card.id === cardId);
  assert.ok(pending, `${cardId} should trigger on ${eventName}`);
  pending.resolvedChoices = { "0": { confirmed: "yes" } };
  return resolveStructuredEffect(state, pending);
}

test("Fusion Force Heroes use a completed Team Attack trigger and a descriptive choice", () => {
  for (const catalogId of ["ff-87", "ff-88", "ff-89", "ff-90", "ff-91"]) {
    const definition = ruleDefinitionForCard(card(catalogId, `${catalogId}-source`));
    const ability = definition.abilities.find((candidate) => candidate.trigger?.event === "TEAM_ATTACK_COMPLETED");
    assert.ok(ability, `${catalogId} should trigger after a completed Team Attack`);
    assert.equal(ability.trigger?.optional, true);
    const move = ability.instructions.flatMap((instruction) => instruction.actions)
      .find((action) => action.kind === "move");
    assert.equal(move?.kind, "move");
    assert.equal(move?.subject, "self");
    assert.equal(move?.destination, "owner-hand");
    assert.equal(ability.instructions.flatMap((instruction) => instruction.choices).find((choice) => choice.id === "confirmed")?.label, "Return this to your hand?");
  }
});

test("Team Attack start timing and replacement damage are represented explicitly", () => {
  const pegatrix = ruleDefinitionForCard(card("av-78", "av-78-source"));
  assert.equal(pegatrix.abilities.find((candidate) => candidate.trigger?.event === "TEAM_ATTACK_STARTED")?.trigger?.optional, true);
  assert.equal(
    pegatrix.abilities.find((candidate) => candidate.trigger?.event === "TEAM_ATTACK_STARTED")?.instructions[0].choices[0].label,
    "Draw 2?",
  );

  const bakubooted = ruleDefinitionForCard(card("ff-28", "ff-28-source"));
  const actions = bakubooted.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.actions)
    .filter((action) => action.kind === "modify-stat");
  assert.deepEqual(actions.map((action) => action.kind === "modify-stat" ? [action.amount, action.condition?.kind] : []), [
    [5, "not-team-attack"],
    [10, "team-attack"],
  ]);

  const source = card("ff-28", "ff-28-instance");
  const { state, player, bakugan } = stateFor(source);
  const baseDamage = bakugan.damage;
  const ability = bakubooted.abilities.find((candidate) => candidate.kind === "spell")!;
  const pending = createRuleObject({
    controllerId: player.id,
    cardOwnerId: player.id,
    card: source,
    ability,
    kind: "card",
    choices: { targetBakuganId: bakugan.id },
    sourceId: source.id,
  });
  const afterPlay = resolveStructuredEffect(state, pending);
  assert.equal(evaluateBakuganCharacteristics(afterPlay, afterPlay.players[0].bakugan[0], afterPlay.players[0]).damage, baseDamage + 5);
  afterPlay.teamAttack = true;
  assert.equal(evaluateBakuganCharacteristics(afterPlay, afterPlay.players[0].bakugan[0], afterPlay.players[0]).damage, baseDamage + 10);
});

test("a completed Team Attack returns the exact Hero instance and removes it from the Hero zone", () => {
  const source = card("ff-89", "ff-89-instance");
  const { state, player } = stateFor(source);
  const after = resolveTriggeredSelfReturn(state, source.id, "TEAM_ATTACK_COMPLETED");
  const returned = after.players.find((candidate) => candidate.id === player.id)!.hand.find((candidate) => candidate.id === source.id);
  assert.equal(returned?.catalogId, source.catalogId);
  assert.equal(after.players.find((candidate) => candidate.id === player.id)!.heroes.some((candidate) => candidate.id === source.id), false);
});

test("the shared self-return path removes attached Evos and detached deck-reveal cards", () => {
  const evo = card("aa-81", "aa-81-instance");
  const evoState = stateFor(evo);
  const evoAfter = resolveTriggeredSelfReturn(evoState.state, evo.id, "TURN_ENDED");
  assert.equal(evoAfter.players[0].bakugan[0].evoStack.some((candidate) => candidate.id === evo.id), false);
  assert.equal(evoAfter.players[0].hand.some((candidate) => candidate.id === evo.id), true);

  const flip = card("sv-112", "sv-112-instance");
  const { state, player } = stateFor(flip);
  player.hand = player.hand.filter((candidate) => candidate.id !== flip.id);
  emitRuleEvent(state, {
    id: "flip:sv-112",
    name: "CARD_FLIPPED_FROM_DECK",
    actorId: player.id,
    controllerId: player.id,
    card: flip,
    cardType: flip.type,
    createdAt: Date.now(),
  });
  const pending = state.batch.find((candidate) => candidate.card.id === flip.id);
  assert.ok(pending);
  pending.resolvedChoices = { "0": { confirmed: "yes" } };
  const after = resolveStructuredEffect(state, pending);
  assert.equal(after.players[0].hand.filter((candidate) => candidate.id === flip.id).length, 1);
  assert.equal(after.players[0].deckCards.some((candidate) => candidate.id === flip.id), false);
});

test("Fusion Force self-return Heroes do not trigger from being played", () => {
  const source = card("ff-89", "ff-89-instance");
  const { state, player } = stateFor(source);
  emitRuleEvent(state, {
    id: "play:other-card",
    name: "CARD_PLAYED",
    actorId: player.id,
    controllerId: player.id,
    card: card("bb-1", "other-card"),
    cardType: "Action",
    createdAt: Date.now(),
  });
  assert.equal(state.batch.some((candidate) => candidate.card.id === source.id), false);
});

test("every printed self-return-to-hand card uses the shared source-aware movement", () => {
  const selfReturnCards = [
    "bb-11", "bb-20", "bb-51", "bb-83", "bb-94", "bb-119", "bb-126",
    "bb-160", "bb-162", "bb-164", "aa-44", "aa-81", "av-28", "av-58",
    "av-135", "ff-5", "ff-58", "ff-87", "ff-88", "ff-89", "ff-90", "ff-91",
    "sv-26", "sv-58", "sv-82", "sv-112",
  ];
  for (const catalogId of selfReturnCards) {
    const definition = ruleDefinitionForCard(card(catalogId, `${catalogId}-source`));
    const move = definition.abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.actions)
      .find((action) => action.kind === "move" && action.verb === "return" && action.object === "card");
    assert.equal(move?.kind, "move", `${catalogId} should compile a self-return movement`);
    assert.equal(move?.subject, "self", `${catalogId} should remove its own physical instance`);
    assert.equal(move?.destination, "owner-hand", `${catalogId} should return to its owner's hand`);
  }
});
