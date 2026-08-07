import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  emitGameEvent,
  passPriority,
  playCard,
  resumePendingEffectAfterDraw,
  totalDamage,
  totalPower,
  type Bakugan,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";

let serial = 0;
function card(catalogId: string, id = `${catalogId}-${++serial}`): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing ${catalogId}`);
  return { ...source, id };
}

function bakugan(id: string, faction: Faction, bPower = 500, damage = 5): Bakugan {
  const source = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction && !candidate.effect.trim())
    ?? CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);
  assert.ok(source);
  const character = { ...source, id: `${id}-character`, bPower, damage };
  return {
    id,
    name: id,
    faction,
    bPower,
    damage,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character,
    open: true,
    heldCoreCells: [],
    evoStack: [],
  };
}

function player(id: string, active: Bakugan, hand: GameCard[] = []): PlayerState {
  return {
    id,
    name: id,
    bakugan: [active],
    cores: [],
    deck: 0,
    deckCards: [],
    hand,
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    maxEnergy: 0,
    ready: true,
    connected: true,
    lastSeen: Date.now(),
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
  };
}

function addEnergy(owner: PlayerState, amount: number) {
  owner.energyZone = Array.from({ length: amount }, (_, index) => card("bb-10", `${owner.id}-energy-${index}`));
  owner.maxEnergy = amount;
}

function roll(playerId: string, bakuganId: string): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result: "open-no-core",
    cores: [],
    accuracyRoll: 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 100,
    doubleCore: false,
    path: [],
    note: "test",
  };
}

function matchWith(a: PlayerState, b: PlayerState): MatchState {
  const match = createMatch("RULE-REGRESSION", "bo1", [a, b]);
  match.turn = 3;
  match.phase = "power";
  match.startingPlayer = a.id;
  match.initialStartingPlayer = a.id;
  match.priority = a.id;
  match.selected[a.id] = a.bakugan[0].id;
  match.selected[b.id] = b.bakugan[0].id;
  match.rolls[a.id] = roll(a.id, a.bakugan[0].id);
  match.rolls[b.id] = roll(b.id, b.bakugan[0].id);
  return match;
}

function resolveSimpleCard(state: MatchState, controllerId: string, opponentId: string, cardId: string) {
  let next = playCard(state, controllerId, cardId);
  next = passPriority(next, controllerId);
  next = passPriority(next, opponentId);
  return next;
}

function completeQueuedEffectDraw(state: MatchState) {
  const queued = state as MatchState & {
    pendingDrawQueue?: Array<{ playerId: string; remaining: number; sourceEffectId?: string }>;
  };
  const active = queued.pendingDrawQueue?.[0];
  assert.ok(active, "expected a queued effect draw");
  const owner = state.players.find((candidate) => candidate.id === active.playerId)!;
  for (let index = 0; index < active.remaining; index += 1) {
    const drawn = owner.deckCards.shift();
    if (drawn) owner.hand.push(drawn);
  }
  owner.deck = owner.deckCards.length;
  const sourceEffectId = active.sourceEffectId;
  queued.pendingDrawQueue = [];
  resumePendingEffectAfterDraw(state, sourceEffectId);
}

test("ShadowStrike filters each negative card modifier without reducing positive modifiers", () => {
  const positive = card("bb-42", "positive-prismatic-bolt"); // +300 B, +6 Damage.
  const negative = card("br-58", "negative-ventus-shield"); // -200 B, -2 Damage.
  const protectedBakugan = bakugan("protected", "Darkus", 500, 5);
  const defender = player("defender", protectedBakugan, [positive]);
  const attacker = player("attacker", bakugan("attacker-b", "Ventus", 500, 5), [negative]);
  addEnergy(defender, 4);
  addEnergy(attacker, 2);
  let state = matchWith(defender, attacker);

  state = resolveSimpleCard(state, defender.id, attacker.id, positive.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);

  state.priority = attacker.id;
  state = resolveSimpleCard(state, attacker.id, defender.id, negative.id);
  assert.equal(totalPower(state, defender.id), 600);
  assert.equal(totalDamage(state, defender.id), 9);

  // Gaining ShadowStrike after a reduction must immediately revert only the
  // reductions from cards/BakuCores while retaining unrelated positive buffs.
  state.shadowStrike[protectedBakugan.id] = true;
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);
  const evaluated = evaluateBakuganCharacteristics(state, state.players[0].bakugan[0], state.players[0]);
  assert.ok(evaluated.applied.some((modifier) => modifier.amount === 300 && modifier.stat === "power"));
  assert.ok(evaluated.applied.some((modifier) => modifier.amount === 6 && modifier.stat === "damage"));
  assert.ok(evaluated.prevented.some((modifier) => modifier.amount === -200 && modifier.stat === "power"));
  assert.ok(evaluated.prevented.some((modifier) => modifier.amount === -2 && modifier.stat === "damage"));
});

test("Clone Army FrostStrike equals the number of other cards played this turn", () => {
  for (const otherCards of [0, 1, 3]) {
    const cloneArmy = card("aa-3", `clone-army-${otherCards}`);
    const ai = player(`ai-${otherCards}`, bakugan(`ai-b-${otherCards}`, "Aquos"), [cloneArmy]);
    const human = player(`human-${otherCards}`, bakugan(`human-b-${otherCards}`, "Pyrus"));
    addEnergy(ai, 2);
    ai.cardsPlayedThisTurn = otherCards;
    ai.deckCards = [card("bb-10", `draw-filler-${otherCards}`)];
    ai.deck = 1;
    let state = matchWith(ai, human);
    const baseline = evaluateBakuganCharacteristics(state, ai.bakugan[0], ai).frostStrike;
    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    completeQueuedEffectDraw(state);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
    const currentBakugan = currentAi.bakugan[0];
    const evaluated = evaluateBakuganCharacteristics(state, currentBakugan, currentAi);
    assert.equal(evaluated.frostStrike - baseline, otherCards, `expected +${otherCards} FrostStrike after ${otherCards} other cards`);
  }
});

test("controller-open triggers ignore the opponent opening", () => {
  const controllerTriggerIds = ["br-77", "br-78", "br-79", "bb-207", "bb-209", "bb-215"];
  for (const catalogId of controllerTriggerIds) {
    const owner = player(`owner-${catalogId}`, bakugan(`owner-b-${catalogId}`, "Aquos"));
    const opponent = player(`opponent-${catalogId}`, bakugan(`opponent-b-${catalogId}`, "Pyrus"));
    owner.heroes = [card(catalogId, `hero-${catalogId}`)];
    const match = matchWith(owner, opponent);

    const opponentTriggers = emitGameEvent(match, {
      id: `opponent-open-${catalogId}`,
      type: "open",
      playerId: opponent.id,
      playerIds: [opponent.id],
      targetBakuganId: opponent.bakugan[0].id,
    });
    assert.equal(opponentTriggers.some((trigger) => trigger.card.catalogId === catalogId), false, `${catalogId} triggered on opponent open`);

    const ownMatch = matchWith(owner, opponent);
    ownMatch.players[0].heroes = [card(catalogId, `own-hero-${catalogId}`)];
    const ownTriggers = emitGameEvent(ownMatch, {
      id: `owner-open-${catalogId}`,
      type: "open",
      playerId: owner.id,
      playerIds: [owner.id],
      targetBakuganId: owner.bakugan[0].id,
    });
    assert.equal(ownTriggers.some((trigger) => trigger.card.catalogId === catalogId), true, `${catalogId} did not trigger on controller open`);
  }
});
