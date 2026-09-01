import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  beginCorePlacement,
  createMatch,
  legalPlacementCells,
  passPriority,
  placeCore,
  redactForPlayer,
  setReady,
  submitCardChoice,
  type MatchState,
} from "../lib/game";
import { drawTurnCard } from "../lib/turnStart";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
import { cardPaymentModes } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { ensureRulesState } from "../lib/rules/state";

const START_CARDS = ["ff-215", "ff-220", "ff-225", "ff-229", "ff-232", "ff-239"] as const;
const FIRST_TURN_FREE_HEROES = ["sv-99", "sv-100", "sv-101", "sv-102", "sv-103"] as const;

function startMatch(firstPlayerCard?: string, secondPlayerCard?: string) {
  const first = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("b", "Beta", STARTER_DECKS[1]);
  for (const [player, cardId] of [[first, firstPlayerCard], [second, secondPlayerCard]] as const) {
    if (!cardId) continue;
    const card = CARDS.find((candidate) => candidate.catalogId === cardId);
    assert.ok(card);
    player.bakugan[0].character = { ...card, id: `${cardId}-${player.id}` };
  }
  let state = setReady(setReady(createMatch("START", "bo1", [first, second]), first.id), second.id);
  state = beginCorePlacement(state, Number.POSITIVE_INFINITY);
  for (let index = 0; index < 12; index += 1) {
    const player = state.players.find((candidate) => candidate.id === state.priority)!;
    const ownPlacements = state.placements.filter((placement) => placement.playerId === player.id).length;
    state = placeCore(state, player.id, player.cores[ownPlacements].id, legalPlacementCells(state)[0]);
  }
  return state;
}

function passStartEffect(state: MatchState) {
  state = passPriority(state, state.priority);
  if (state.passes.length) state = passPriority(state, state.priority);
  return state;
}

test("all printed start-of-game Character effects compile as GAME_STARTED triggers", () => {
  for (const cardId of START_CARDS) {
    const card = CARDS.find((candidate) => candidate.catalogId === cardId)!;
    const definition = ruleDefinitionForCard(card);
    const ability = definition.abilities.find((candidate) => candidate.kind === "triggered");
    assert.equal(ability?.trigger?.event, "GAME_STARTED", cardId);
    assert.equal(ability?.trigger?.relationship, "controller", cardId);
  }

  const sairus = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "ff-229")!);
  const sairusInstruction = sairus.abilities[0].instructions[0];
  assert.equal(sairusInstruction.effects.find((effect) => effect.kind === "modify-stat")?.duration, "turn");
  assert.equal(sairusInstruction.choices[0]?.owner, "controller");
  assert.equal(sairusInstruction.choices[0]?.visibility, "private");

  const pegatrix = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "ff-239")!);
  assert.deepEqual(pegatrix.abilities[0].instructions[0].effects[0], {
    kind: "energize",
    amount: 1,
    source: "deck",
    enters: "uncharged",
    playerScope: "each-player",
    sourceOwner: "each-player",
    destinationOwner: "each-player",
  });
});

test("start-of-game effects resolve before either player can take the normal Draw Step", () => {
  let state = startMatch("ff-215");
  assert.equal(state.turn, 1);
  assert.equal(state.players[0].hand.length, 5);
  assert.equal(state.batch.length, 1);
  assert.equal(state.gameStartEventedGame, state.gameNumber);
  assert.throws(() => drawTurnCard(state, "a", Number.POSITIVE_INFINITY), /start-of-game effects/i);

  state = passStartEffect(state);
  assert.equal(state.batch.length, 0);
  assert.equal(state.phase, "draw");
  state = drawTurnCard(state, "a", Number.POSITIVE_INFINITY);
  assert.equal(state.players[0].hand.length, 6);
});

test("Pegatrix performs its uncharged top-deck Energize for both players before Draw", () => {
  let state = startMatch("ff-239");
  state = passStartEffect(state);
  assert.equal(state.batch.length, 0);
  assert.equal(state.phase, "draw");
  assert.deepEqual(state.players.map((player) => player.energyZone.length), [1, 1]);
  assert.deepEqual(state.players.map((player) => player.unchargedEnergyIds?.length ?? 0), [1, 1]);
});

test("Sairus privately targets any Bakugan on its controller's team and lasts through the first turn", () => {
  let state = startMatch("ff-229");
  state = passStartEffect(state);
  const choice = state.pendingChoice!;
  assert.equal(choice.schema.fields[0].visibility, "private");
  assert.equal(choice.schema.fields[0].options.length, 3);
  assert.ok(choice.schema.fields[0].options.every((option) => option.ownerId === "a"));

  const opponentView = redactForPlayer(state, "b");
  assert.equal(opponentView.players[0].bakugan[0].character.name, "Face-down Character");
  assert.equal(opponentView.batch[0].card.name, "Hidden card");
  assert.equal(opponentView.pendingChoice?.schema.sourceName, "Hidden start-of-game effect");
  assert.equal(opponentView.pendingChoice?.schema.fields[0].options.length, 0);

  const target = choice.schema.fields[0].options[2].id;
  state = submitCardChoice(state, "a", { targetBakuganId: target });
  assert.equal(state.batch.length, 0);
  assert.equal(state.damageBoost[target], 3);
  assert.equal(ensureRulesState(state).modifiers.find((modifier) => modifier.targetBakuganId === target)?.duration, "turn");
});

test("Howlkor's start-of-game attack is a separate attack that can resolve without an open Bakugan", () => {
  let state = startMatch("ff-232");
  state = passStartEffect(state);
  assert.equal(state.phase, "damage");
  assert.equal(state.pendingDamage, 2);
  assert.ok(state.pendingEffectDamageResume);

  while (state.phase === "damage") {
    state = state.revealedFlip
      ? resolveManualDamage(state, state.pendingLoser)
      : flipDamageCard(state, state.pendingLoser);
  }
  assert.equal(state.phase, "draw");
  assert.equal(state.pendingDamage, 0);
  assert.equal(state.batch.length, 0);
});

test("first-turn free Hero payment modes are available only during turn one", () => {
  const player = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const state = createMatch("FREE", "bo1", [player, opponent]);
  for (const cardId of FIRST_TURN_FREE_HEROES) {
    const card = CARDS.find((candidate) => candidate.catalogId === cardId)!;
    state.turn = 1;
    assert.ok(cardPaymentModes(state, player.id, card).some((mode) => mode.id === `${cardId}:self-free` && mode.legal), cardId);
    state.turn = 2;
    assert.ok(!cardPaymentModes(state, player.id, card).some((mode) => mode.id === `${cardId}:self-free`), cardId);
  }
});
