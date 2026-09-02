import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, playCard, submitCardChoice, type GameCard, type MatchState } from "../lib/game";
import { hasPendingDraws, drawPendingCard } from "../lib/drawQueue";
import { isDualWieldGear } from "../lib/rules/baku-gear";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function gearState(attached: GameCard[] = []): MatchState {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("DUAL-GEAR", "bo1", [owner, opponent]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = owner.id;
  state.priority = owner.id;
  state.selected[owner.id] = owner.bakugan[0].id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  owner.bakugan[0].open = true;
  owner.bakugan[0].bakuGear = attached;
  owner.energy = 20;
  return state;
}

function resolveBatch(input: MatchState) {
  let state = input;
  for (let index = 0; index < 20 && (state.batch.length || hasPendingDraws(state)); index += 1) {
    if (state.pendingChoice) break;
    if (hasPendingDraws(state)) state = drawPendingCard(state, state.priority);
    else state = passPriority(state, state.priority);
  }
  return state;
}

test("Dual Wield is detected from the Gear's own [Dual] prefix", () => {
  assert.equal(isDualWieldGear(card("ff-100", "dual")), true);
  assert.equal(isDualWieldGear(card("av-87", "normal")), false);
  assert.equal(isDualWieldGear(card("ff-108", "greenshields")), false);
});

test("a non-Dual Gear and a Dual Wield Gear remain attached in either order", () => {
  for (const [existingId, playedId] of [["dual", "normal"], ["normal", "dual"]]) {
    const existing = existingId === "dual" ? card("ff-100", existingId) : card("av-87", existingId);
    const played = playedId === "dual" ? card("ff-100", playedId) : card("av-87", playedId);
    let state = gearState([existing]);
    const owner = state.players[0];
    const target = owner.bakugan[0];
    owner.hand = [played];
    state = playCard(state, owner.id, played.id, { targetBakuganId: target.id });
    state = resolveBatch(state);
    assert.equal(state.pendingChoice, undefined);
    assert.deepEqual(
      state.players[0].bakugan[0].bakuGear?.map((candidate) => candidate.id),
      [existing.id, played.id],
    );
  }
});

test("two non-Dual Gear cards resolve the new Play Effect before the keep-one choice", () => {
  const existing = card("av-87", "existing");
  const played = card("ff-97", "played");
  let state = gearState([existing]);
  const owner = state.players[0];
  const target = owner.bakugan[0];
  owner.hand = [played];
  state = playCard(state, owner.id, played.id, { targetBakuganId: target.id });
  state = resolveBatch(state);
  assert.equal(state.pendingChoice?.kind, "gear-replacement");
  assert.equal(state.pendingChoice?.schema.fields[0]?.options.length, 2);
  assert.equal(state.players[0].bakugan[0].bakuGear?.length, 2);
  assert.ok(state.players[0].hand.length > 0, "Aquotomic Payload's Play Effect should draw before the choice.");

  state = submitCardChoice(state, owner.id, { keepBakuGearId: existing.id });
  while (hasPendingDraws(state)) state = drawPendingCard(state, state.priority);
  assert.equal(state.pendingChoice, undefined);
  assert.deepEqual(state.players[0].bakugan[0].bakuGear?.map((candidate) => candidate.id), [existing.id]);
  assert.ok(state.players[0].discard.some((candidate) => candidate.id === played.id));
});

test("Greenshields offers only an actual Dual Wield Gear from hand", () => {
  const greenshields = card("ff-108", "greenshields");
  const definition = ruleDefinitionForCard(greenshields);
  const instruction = definition.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.sourceText.includes("[Dual] Baku-Gear"));
  assert.ok(instruction);
  const action = instruction.actions.find((candidate) => candidate.kind === "play");
  assert.equal(action?.kind, "play");
  if (action?.kind === "play") {
    assert.equal(action.cardType, "Baku-Gear");
    assert.equal(action.cardMechanic, "Dual Wield");
  }
  const choice = instruction.choices.find((candidate) => candidate.id === "handCardIds");
  assert.equal(choice?.cardMechanic, "Dual Wield");
  assert.equal(choice?.cardType, "Baku-Gear");
});

test("Greenshields can optionally play the selected Dual Wield Gear", () => {
  const greenshields = card("ff-108", "greenshields");
  const dual = card("ff-100", "dual-from-greenshields");
  const normal = card("av-87", "normal-from-greenshields");
  let state = gearState();
  const owner = state.players[0];
  owner.hand = [greenshields, dual, normal];
  state = playCard(state, owner.id, greenshields.id);
  state = passPriority(state, state.priority);
  state = passPriority(state, state.priority);
  assert.equal(state.pendingChoice?.cardId, greenshields.id);
  assert.deepEqual(
    state.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds")?.options.map((option) => option.id),
    [dual.id],
  );
  state = submitCardChoice(state, owner.id, { confirmed: true, handCardIds: [dual.id] });
  state = submitCardChoice(state, owner.id, { targetBakuganId: owner.bakugan[0].id });
  state = resolveBatch(state);
  assert.equal(state.pendingChoice, undefined);
  assert.deepEqual(state.players[0].bakugan[0].bakuGear?.map((candidate) => candidate.id), [dual.id]);
});
