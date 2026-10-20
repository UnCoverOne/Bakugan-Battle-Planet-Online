import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  playCard,
  submitCardChoice,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { activePendingDraw, drawPendingCard } from "../lib/drawQueue";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string, id: string): GameCard {
  const original = CARDS.find((entry) => entry.catalogId === catalogId);
  assert.ok(original, `Missing ${catalogId} from catalogue`);
  return { ...original, id };
}

function setup() {
  const owner = makePlayer("terran-owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("terran-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("TERRAN-VITALIZER", "bo1", [owner, opponent]);
  state.turn = 3;
  state.phase = "power";
  state.priority = owner.id;
  state.startingPlayer = owner.id;

  const source = card("ff-123", "terran-vitalizer");
  const drawn = card("bb-1", "newly-drawn-card");
  const held = card("bb-2", "held-card");
  state.players[0].hand = [source, held];
  state.players[0].deckCards = [drawn];
  state.players[0].deck = 1;
  state.players[0].energy = 0;
  state.players[0].energyZone = Array.from(
    { length: 4 },
    (_, index) => card("bb-3", `terran-energy-${index}`),
  );
  return { state, ownerId: owner.id, opponentId: opponent.id, source, drawn, held };
}

function finishRemainingBatch(input: MatchState) {
  let state = input;
  for (let step = 0; step < 8 && state.batch.length && !state.pendingChoice; step += 1) {
    state = passPriority(state, state.priority);
  }
  return state;
}

function throughDraw(state: MatchState, ownerId: string, sourceId: string) {
  const owner = state.players.find((player) => player.id === ownerId)!;
  let next = playCard(state, ownerId, sourceId, { targetBakuganId: owner.bakugan[0].id });
  // Resolving the play-trigger queues the manual Draw decision, not the
  // subsequent Energize selection; the latter must include the drawn card.
  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.pendingChoice, undefined);
  assert.equal(activePendingDraw(next)?.playerId, ownerId);
  next = drawPendingCard(next, ownerId);
  assert.equal(activePendingDraw(next), null);
  return next;
}

test("Fusion Force card text keeps Terran Vitalizer's full instruction on its own printing", () => {
  const terran = card("ff-123", "text-terran");
  const hydorous = card("ff-124", "text-hydorous");
  assert.match(terran.effect, /When you play this, \[Draw\] 1, then you may Energize a card from\s+your hand\./);
  assert.doesNotMatch(hydorous.effect, /your hand/);
  assert.match(hydorous.effect, /\[HE\]: \+1000 \[B\] & \+10 \[Damage\]/);

  const trigger = ruleDefinitionForCard(terran).abilities.find((ability) => (
    ability.kind === "triggered" && ability.trigger?.event === "CARD_PLAYED"
  ));
  assert.ok(trigger, "Terran Vitalizer's Draw/Energize should be a when-play trigger");
  assert.equal(trigger.instructions.some((instruction) => instruction.actions.some((action) => (
    action.kind === "draw" && action.amount === 1
  ))), true);
  assert.equal(trigger.instructions.some((instruction) => instruction.actions.some((action) => (
    action.kind === "energize" && action.source === "hand" && action.amount === 1
  ))), true);
});

test("Terran Vitalizer prompts for an optional hand Energize only after its manual Draw", () => {
  const { state, ownerId, source, drawn, held } = setup();
  const next = throughDraw(state, ownerId, source.id);
  const field = next.pendingChoice?.schema.fields.find((candidate) => candidate.id === "handCardIds");
  assert.equal(next.pendingChoice?.controllerId, ownerId);
  assert.equal(next.pendingChoice?.kind, "resolution");
  assert.ok(field, "Energize should ask the controller to choose a hand card");
  assert.match(field.label, /Energize/);
  assert.equal(field.minimum, 0, "you may makes Energize optional");
  assert.equal(field.maximum, 1);
  assert.equal(field.chooserId, ownerId);
  assert.deepEqual(new Set(field.options.map((entry) => entry.id)), new Set([drawn.id, held.id]));
});

test("Terran Vitalizer can Energize the card just drawn, charged and face down", () => {
  const { state, ownerId, source, drawn, held } = setup();
  const waiting = throughDraw(state, ownerId, source.id);
  const resolved = finishRemainingBatch(submitCardChoice(waiting, ownerId, { handCardIds: [drawn.id] }));
  const owner = resolved.players.find((player) => player.id === ownerId)!;
  assert.equal(resolved.pendingChoice, undefined);
  assert.equal(resolved.batch.length, 0);
  assert.ok(owner.energyZone.some((energy) => energy.id === drawn.id));
  assert.ok(owner.hand.some((entry) => entry.id === held.id));
  assert.equal(owner.hand.some((entry) => entry.id === drawn.id), false);
  assert.equal(owner.energyZone.length, 5);
});

test("Terran Vitalizer permits declining the optional Energize after drawing", () => {
  const { state, ownerId, source, drawn, held } = setup();
  const waiting = throughDraw(state, ownerId, source.id);
  const resolved = finishRemainingBatch(submitCardChoice(waiting, ownerId, { handCardIds: [] }));
  const owner = resolved.players.find((player) => player.id === ownerId)!;
  assert.equal(resolved.pendingChoice, undefined);
  assert.equal(resolved.batch.length, 0);
  assert.deepEqual(new Set(owner.hand.map((entry) => entry.id)), new Set([drawn.id, held.id]));
  assert.equal(owner.energyZone.length, 4);
});
