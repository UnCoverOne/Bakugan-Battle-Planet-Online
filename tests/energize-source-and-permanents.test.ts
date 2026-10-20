import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch, emitGameEvent, passPriority, playCard, submitCardChoice,
  type GameCard, type MatchState,
} from "../lib/game";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { activeUnchargedEnergyIds } from "../lib/rules/costs";
import { evoCanTarget } from "../lib/evo";

function card(id: string, physicalId = id): GameCard {
  const original = CARDS.find((candidate) => candidate.catalogId === id);
  assert.ok(original, `Missing ${id}`);
  return { ...original, id: physicalId };
}
function matchFor(id: string) {
  const owner = makePlayer("batch2-owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("batch2-opponent", "Opponent", STARTER_DECKS[1]);
  const match = createMatch(`BATCH2-${id}`, "bo1", [owner, opponent]);
  match.turn = 3;
  match.phase = "power";
  match.startingPlayer = owner.id;
  match.priority = owner.id;
  const source = card(id, `source-${id}`);
  owner.hand = [source, card("bb-1", "held")];
  owner.deckCards = [card("bb-2", "deck-first"), card("bb-3", "deck-second")];
  owner.deck = owner.deckCards.length;
  owner.energyZone = Array.from({ length: 10 }, (_, index) => card("bb-4", `energy-${index}`));
  owner.energy = 0;
  opponent.hand = [card("bb-5", "opponent-held")];
  opponent.energyZone = Array.from({ length: 10 }, (_, index) => card("bb-6", `opponent-energy-${index}`));
  return { match, owner, opponent, source };
}
function pendingOrSettled(initial: MatchState) {
  let state = initial;
  for (let i = 0; i < 15 && state.batch.length && !state.pendingChoice; i++) {
    state = passPriority(state, state.priority);
  }
  return state;
}
function playFlipFromDamage(id: string) {
  const { match, owner, opponent, source } = matchFor(id);
  owner.hand = [card("bb-1", "held")];
  owner.deckCards = [source, card("bb-2", "deck-first"), card("bb-3", "deck-second")];
  owner.deck = owner.deckCards.length;
  match.phase = "damage";
  match.pendingLoser = owner.id;
  match.pendingDamage = 2;
  match.damageOrigin = opponent.bakugan[0].id;
  match.priority = owner.id;
  const revealed = flipDamageCard(match, owner.id);
  assert.equal(revealed.revealedFlip?.id, source.id);
  return { state: pendingOrSettled(resolveManualDamage(revealed, owner.id, source.id)), owner, opponent, source };
}
function energy(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id === playerId)!;
}
function checkUncharged(state: MatchState, playerId: string, ids: string[]) {
  const owner = energy(state, playerId);
  const uncharged = new Set(activeUnchargedEnergyIds(owner, state.turn));
  for (const id of ids) {
    assert.ok(owner.energyZone.some((entry) => entry.id === id), `${id} must be in the owner's Energy Zone`);
    assert.ok(uncharged.has(id), `${id} must enter uncharged`);
  }
}
function allActions(id: string) {
  return ruleDefinitionForCard(card(id)).abilities.flatMap((ability) =>
    ability.instructions.flatMap((instruction) => instruction.actions));
}

test("Titan Pharol compiles selectable discard-pile Energize and corrects the source text", () => {
  const source = card("ps1-16");
  assert.match(source.effect, /two cards in your discard\s+pile uncharged/);
  const trigger = ruleDefinitionForCard(source).abilities.find((ability) => ability.kind === "triggered");
  assert.equal(trigger?.trigger?.event, "CARD_PLAYED");
  const instruction = trigger?.instructions.find((item) => item.actions.some((action) => action.kind === "energize"));
  const action = instruction?.actions.find((item) => item.kind === "energize");
  assert.ok(action && action.kind === "energize");
  assert.equal(action.source, "discard");
  assert.equal(action.amount, 2);
  assert.equal(action.enters, "uncharged");
  const selector = instruction?.choices.find((choice) => choice.id === "discardCardIds");
  assert.equal(selector?.minimum, 2);
  assert.equal(selector?.maximum, 2);
});

test("Titan Pharol chooses exactly two physical discard cards, leaving the other untouched", () => {
  const { match, owner, source } = matchFor("ps1-16");
  const base = CARDS.find((candidate) => candidate.type === "Character"
    && /Pharol/i.test(candidate.name) && candidate.faction === source.faction);
  assert.ok(base, "Titan Pharol needs its matching Character");
  const bakugan = owner.bakugan[0];
  bakugan.character = { ...base, id: "pharol-character" };
  bakugan.name = base.displayName || base.name;
  bakugan.faction = base.faction;
  assert.equal(evoCanTarget(source, bakugan), true);
  const discarded = ["discard-first", "discard-second", "discard-third"].map((id) => card("bb-7", id));
  owner.discard = discarded;
  let state = pendingOrSettled(playCard(match, owner.id, source.id, { sourceBakuganId: bakugan.id }));
  const selector = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.ok(selector, "the optional when-play trigger must ask for discard cards");
  assert.equal(selector.minimum, 2);
  assert.equal(selector.options.length, 3);
  assert.ok(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
  state = pendingOrSettled(submitCardChoice(state, owner.id, {
    confirmed: true, discardCardIds: ["discard-third", "discard-first"],
  }));
  checkUncharged(state, owner.id, ["discard-first", "discard-third"]);
  assert.ok(energy(state, owner.id).discard.some((entry) => entry.id === "discard-second"));
  assert.equal(energy(state, owner.id).discard.some((entry) => entry.id === "discard-first"), false);
});

test("Trox x Sairus face-up trigger is local to its Bakugan and chooses discard Energy", () => {
  const { match, owner, source } = matchFor("sv-243b");
  owner.hand = [];
  owner.discard = [card("bb-7", "discard-target"), card("bb-8", "discard-keep")];
  const bakugan = owner.bakugan[0];
  bakugan.character = source;
  bakugan.name = source.displayName || source.name;
  bakugan.faction = source.faction;
  bakugan.open = true;
  match.selected[owner.id] = bakugan.id;
  assert.equal(ruleDefinitionForCard(source).abilities.find((a) => a.kind === "triggered")?.trigger?.event, "BAKUGAN_OPENED");
  emitGameEvent(match, { id: "sairus-face-up", type: "open", playerId: owner.id, targetBakuganId: bakugan.id });
  let state = pendingOrSettled(match);
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
  assert.ok(field, "face-up must prompt a discard-card selection");
  assert.equal(field.minimum, 1);
  state = pendingOrSettled(submitCardChoice(state, owner.id, { discardCardIds: ["discard-keep"] }));
  checkUncharged(state, owner.id, ["discard-keep"]);
  assert.ok(energy(state, owner.id).discard.some((entry) => entry.id === "discard-target"));
});

test("Trox x Sairus does not trigger when a different Bakugan opens", () => {
  const { match, owner, source } = matchFor("sv-243b");
  const bakugan = owner.bakugan[0];
  bakugan.character = source;
  bakugan.open = true;
  match.selected[owner.id] = bakugan.id;
  emitGameEvent(match, { id: "other-bakugan-opens", type: "open", playerId: owner.id, targetBakuganId: owner.bakugan[1].id });
  assert.equal(match.batch.some((object) => object.card.id === source.id), false);
});

test("Trox's Moxy Energizes itself and the top deck card uncharged without a hand prompt", () => {
  const instructions = allActions("bb-185").filter((action) => action.kind === "energize");
  assert.deepEqual(instructions.map((action) => action.kind === "energize" && action.source), ["self", "deck"]);
  const { state: initial, owner, source } = playFlipFromDamage("bb-185");
  const state = pendingOrSettled(initial);
  assert.equal(state.pendingChoice, undefined);
  checkUncharged(state, owner.id, [source.id, "deck-first"]);
  assert.equal(energy(state, owner.id).deckCards[0]?.id, "deck-second");
  assert.equal(energy(state, owner.id).discard.some((entry) => entry.id === source.id), false);
});

for (const chooseHand of [false, true]) {
  test(`Doom from the Deep Energizes itself ${chooseHand ? "and the chosen hand card" : "when the optional hand choice is declined"}`, () => {
    const { state: initial, owner, source } = playFlipFromDamage("sv-92");
    const field = initial.pendingChoice?.schema.fields.find((candidate) => candidate.id === "handCardIds");
    assert.ok(field);
    assert.equal(field.minimum, 0);
    assert.equal(field.maximum, 1);
    const state = pendingOrSettled(submitCardChoice(initial, owner.id, {
      handCardIds: chooseHand ? ["held"] : [],
    }));
    checkUncharged(state, owner.id, chooseHand ? [source.id, "held"] : [source.id]);
    assert.equal(energy(state, owner.id).hand.some((entry) => entry.id === "held"), !chooseHand);
    assert.equal(energy(state, owner.id).discard.some((entry) => entry.id === source.id), false);
  });
}

test("Bakuassist! Energizes its chosen Hero and all opposing Heroes only with Boost", () => {
  const { match, owner, opponent, source } = matchFor("ff-38");
  owner.heroes = [card("bb-187", "owner-hero")];
  opponent.heroes = [card("bb-187", "opponent-hero-1"), card("bb-188", "opponent-hero-2")];
  let state = pendingOrSettled(playCard(match, owner.id, source.id));
  const heroField = state.pendingChoice?.schema.fields.find((field) => field.id === "targetHeroId");
  assert.ok(heroField);
  assert.ok(heroField.options.some((option) => option.id === "owner-hero"));
  state = pendingOrSettled(submitCardChoice(state, owner.id, { targetHeroId: "owner-hero" }));
  checkUncharged(state, owner.id, []);
  assert.ok(energy(state, owner.id).energyZone.some((entry) => entry.id === "owner-hero"));
  assert.ok(energy(state, opponent.id).energyZone.some((entry) => entry.id === "opponent-hero-1"));
  assert.ok(energy(state, opponent.id).energyZone.some((entry) => entry.id === "opponent-hero-2"));
  assert.deepEqual(energy(state, opponent.id).heroes, []);
  assert.deepEqual(energy(state, owner.id).heroes, []);
});

test("Bakuassist! without seven Energy leaves unchosen opposing Heroes in play", () => {
  const { match, owner, opponent, source } = matchFor("ff-38");
  // The first mandatory Hero Energize also counts towards Boost.
  owner.energyZone = owner.energyZone.slice(0, 5);
  owner.heroes = [card("bb-187", "owner-hero")];
  opponent.heroes = [card("bb-188", "opponent-hero")];
  let state = pendingOrSettled(playCard(match, owner.id, source.id));
  assert.ok(state.pendingChoice);
  state = pendingOrSettled(submitCardChoice(state, owner.id, { targetHeroId: "owner-hero" }));
  assert.ok(energy(state, opponent.id).heroes.some((hero) => hero.id === "opponent-hero"));
  assert.ok(energy(state, owner.id).energyZone.some((hero) => hero.id === "owner-hero"));
});

test("Prismatic Power-Up chooses a Hero and/or Gear owned by the opponent", () => {
  const { match, owner, opponent, source } = matchFor("sv-66");
  owner.heroes = [card("bb-187", "friendly-hero")];
  opponent.heroes = [card("bb-187", "opponent-hero-1"), card("bb-188", "opponent-hero-2")];
  const bakugan = opponent.bakugan[0];
  bakugan.bakuGear = [card("ff-98", "opponent-gear")];
  let state = pendingOrSettled(playCard(match, owner.id, source.id));
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetCardIds");
  assert.ok(field);
  assert.equal(field.kind, "permanent-cards", "mixed targets must have a modal selection in the game UI");
  assert.equal(field.chooserId, owner.id);
  assert.equal(field.minimum, 1);
  assert.equal(field.maximum, 2);
  assert.deepEqual(new Set(field.options.map((option) => option.id)),
    new Set(["opponent-hero-1", "opponent-hero-2", "opponent-gear"]));
  assert.throws(
    () => submitCardChoice(state, owner.id, { targetCardIds: ["opponent-hero-1", "opponent-hero-2"] }),
    /at most 1 Hero/i,
  );
  state = pendingOrSettled(submitCardChoice(state, owner.id, {
    targetCardIds: ["opponent-hero-1", "opponent-gear"],
  }));
  checkUncharged(state, opponent.id, ["opponent-hero-1", "opponent-gear"]);
  assert.equal(energy(state, owner.id).energyZone.some((entry) => entry.id === "opponent-gear"), false);
  assert.ok(energy(state, owner.id).heroes.some((entry) => entry.id === "friendly-hero"));
  assert.ok(energy(state, opponent.id).heroes.some((entry) => entry.id === "opponent-hero-2"));
  assert.equal(energy(state, opponent.id).bakugan[0].bakuGear?.some((entry) => entry.id === "opponent-gear"), false);
});

test("Prismatic Power-Up accepts a single opposing Hero without any Gear", () => {
  const { match, owner, opponent, source } = matchFor("sv-66");
  opponent.heroes = [card("bb-187", "only-target")];
  opponent.bakugan.forEach((bakugan) => { bakugan.bakuGear = []; });
  let state = pendingOrSettled(playCard(match, owner.id, source.id));
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetCardIds");
  assert.ok(field);
  assert.equal(field.options.length, 1);
  state = pendingOrSettled(submitCardChoice(state, owner.id, { targetCardIds: ["only-target"] }));
  checkUncharged(state, opponent.id, ["only-target"]);
});

test("Energize discard piles remain visible to their controller in the choice UI", () => {
  const queue = readFileSync(new URL("../components/game-screen-v2/ChoiceQueueLayer.tsx", import.meta.url), "utf8");
  assert.match(queue, /field\.kind === "discard-pile-cards"/);
  assert.match(queue, /field\.maxPerCardType/);
  const source = card("ps1-16");
  const clause = ruleDefinitionForCard(source).abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => instruction.choices.some((choice) => choice.id === "discardCardIds"));
  assert.ok(clause?.choices.some((choice) => choice.id === "discardCardIds" && choice.selector === "discard-card"));
});
