import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, CARDS, CORES, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  flipStopsDamage,
  passPriority,
  revealedFlipCanBePlayed,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { resolveManualDamage } from "../lib/manualDamage";
import { advanceOpponentAi } from "../lib/opponentAi";
import { compileCardEffect } from "../lib/rules/effects";
import { ruleConditionActive } from "../lib/rules/modifiers";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { createRuleObject } from "../lib/rules/objects";
import { visibleMatchHudActions } from "../components/game-screen-v2/matchHudState";

function cardInstance(catalogId: string, suffix = "test") {
  const template = CARD_BY_ID.get(catalogId);
  assert.ok(template, `Missing ${catalogId}`);
  return { ...structuredClone(template), id: `${catalogId}-${suffix}` };
}

function openBrawl() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("VICTOR-STAT", "bo1", [first, second]);
  const firstBakugan = first.bakugan[0];
  const secondBakugan = second.bakugan[0];
  firstBakugan.open = true;
  secondBakugan.open = true;
  firstBakugan.bPower = 1200;
  firstBakugan.damage = 1;
  firstBakugan.character.bPower = 1200;
  firstBakugan.character.damage = 1;
  secondBakugan.bPower = 100;
  secondBakugan.damage = 9;
  secondBakugan.character.bPower = 100;
  secondBakugan.character.damage = 9;
  state.turn = 3;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected = { [first.id]: firstBakugan.id, [second.id]: secondBakugan.id };
  state.rolls = {
    [first.id]: { result: "intended-core" } as MatchState["rolls"][string],
    [second.id]: { result: "intended-core" } as MatchState["rolls"][string],
  };
  return { state, first, second, firstBakugan, secondBakugan };
}

for (const catalogId of ["bb-104", "bb-210"] as const) {
  test(`${catalogId} makes Damage Rating decide the current Brawl`, () => {
    const { state, first, second } = openBrawl();
    const card = cardInstance(catalogId, "victor");
    const program = compileCardEffect(card);
    const victorRule = program.instructions.find((instruction) => instruction.actions.some((action) => (
      action.kind === "set-rule" && action.rule === "victor-stat"
    )));
    assert.ok(victorRule);
    assert.equal(victorRule.condition.kind, "always");

    const definition = ruleDefinitionForCard(card);
    const ability = definition.abilities.find((candidate) => candidate.kind === "spell")
      ?? definition.abilities.find((candidate) => candidate.kind !== "triggered");
    assert.ok(ability);
    state.batch = [createRuleObject({
      controllerId: first.id,
      card,
      ability,
      kind: "card",
      sourceId: card.id,
    })];

    let next = passPriority(state, first.id);
    next = passPriority(next, second.id);
    assert.equal(next.victorByDamage, true);

    next = passPriority(next, first.id);
    next = passPriority(next, second.id);
    assert.equal(next.phase, "victor");
    assert.equal(next.brawlWinner, second.id);
    assert.match(next.log.at(-1)?.message ?? "", /Damage Rating/);
  });
}

function damageState(defenderId = "defender") {
  const attacker = makePlayer("attacker", "Attacker", STARTER_DECKS[0]);
  const defender = makePlayer(defenderId, defenderId === "training-bot" ? "Training AI" : "Defender", STARTER_DECKS[1]);
  const state = createMatch("CORE-STOP", "bo1", [attacker, defender]);
  const attackingBakugan = attacker.bakugan[0];
  attackingBakugan.open = true;
  state.turn = 4;
  state.phase = "damage";
  state.startingPlayer = attacker.id;
  state.priority = defender.id;
  state.selected = { [attacker.id]: attackingBakugan.id, [defender.id]: defender.bakugan[0].id };
  state.pendingLoser = defender.id;
  state.pendingDamage = 3;
  state.damageOrigin = attackingBakugan.id;
  state.damageFaction = attackingBakugan.faction;
  return { state, attacker, defender, attackingBakugan };
}

function attachCore(state: MatchState, playerId: string, bakuganId: string, coreType: GameCard extends never ? never : (typeof CORES)[number]["type"]) {
  const template = CORES.find((core) => core.type === coreType);
  assert.ok(template, `Missing ${coreType} core`);
  const core = { ...structuredClone(template), id: `${template.id}-${bakuganId}-${state.placements.length}` };
  const cell = `test-core-${state.placements.length}`;
  state.placements.push({ playerId, core, cell, order: state.placements.length + 1, attachedTo: bakuganId });
  const bakugan = state.players.flatMap((player) => player.bakugan).find((candidate) => candidate.id === bakuganId);
  assert.ok(bakugan);
  bakugan.heldCoreCells.push(cell);
}

const CORE_CODE = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
} as const;

const CORE_STOP_IDS = [
  "br-60", "br-61", "br-64", "br-66", "br-67",
  "br-68", "br-71", "br-72", "br-74", "br-76",
];

test("every BakuCore-conditioned Stop Flip checks the attacking Bakugan", () => {
  const cards = CARDS.filter((card) => (
    card.type === "Flip"
    && /\[Stop\]\s+(?:an?|the)\s+Bakugan\s+(?:is\s+)?holding/i.test(card.effect)
  ));
  assert.deepEqual(cards.map((card) => card.catalogId), CORE_STOP_IDS);

  for (const template of cards) {
    const { state, defender, attackingBakugan } = damageState();
    const card = { ...structuredClone(template), id: `${template.catalogId}-revealed` };
    defender.discard = [card];
    state.revealedFlip = card;
    assert.equal(revealedFlipCanBePlayed(state, defender.id, card), false, `${template.catalogId} was legal without its core`);
    assert.equal(flipStopsDamage(state, card), false);

    const code = card.effect.match(/\[(FT|FF|SD|MS|HE)\]/i)?.[1] as keyof typeof CORE_CODE | undefined;
    assert.ok(code);
    attachCore(state, state.players[0].id, attackingBakugan.id, CORE_CODE[code]);
    assert.equal(revealedFlipCanBePlayed(state, defender.id, card), true, `${template.catalogId} rejected its required core`);
    assert.equal(flipStopsDamage(state, card), true);
  }
});

test("an unmet Stop condition disables Play Flip but preserves Skip", () => {
  const { state, defender } = damageState();
  const freeze = cardInstance("br-61", "revealed");
  defender.discard = [freeze];
  state.revealedFlip = freeze;

  const actions = visibleMatchHudActions({
    match: state,
    playerId: defender.id,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });
  assert.equal(actions["play-flip"], false);
  assert.equal(actions["skip-flip"], true);
  assert.throws(
    () => resolveManualDamage(state, defender.id, freeze.id),
    /Stop condition is not met/,
  );
});

test("a core-conditioned Stop resolves after its required core is present", () => {
  const { state, attacker, defender, attackingBakugan } = damageState();
  const freeze = cardInstance("br-61", "revealed");
  defender.discard = [freeze];
  state.revealedFlip = freeze;
  attachCore(state, attacker.id, attackingBakugan.id, "Fist");

  let next = resolveManualDamage(state, defender.id, freeze.id);
  assert.equal(next.batch.some((effect) => effect.card.id === freeze.id), true);
  next = passPriority(next, defender.id);
  next = passPriority(next, attacker.id);
  assert.equal(next.pendingDamage, 0);
});

test("faction-conditioned Stop Flips use the same play-legality gate", () => {
  const { state, defender } = damageState();
  const counterAquos = cardInstance("bb-140", "revealed");
  defender.discard = [counterAquos];
  state.revealedFlip = counterAquos;
  state.damageFaction = "Pyrus";
  assert.equal(revealedFlipCanBePlayed(state, defender.id, counterAquos), false);
  state.damageFaction = "Aquos";
  assert.equal(revealedFlipCanBePlayed(state, defender.id, counterAquos), true);
});

test("the Training AI skips a Stop Flip whose condition is not met", () => {
  const { state, defender } = damageState("training-bot");
  const freeze = cardInstance("br-61", "ai-revealed");
  defender.discard = [freeze];
  state.revealedFlip = freeze;
  const next = advanceOpponentAi(state, defender.id);
  assert.ok(next);
  assert.equal(next.revealedFlip, undefined);
  assert.equal(next.batch.some((effect) => effect.card.id === freeze.id), false);
});

test("team-held-core riders are typed instead of resolving unconditionally", () => {
  const twistingInferno = cardInstance("br-47", "audit");
  const instruction = compileCardEffect(twistingInferno).instructions.find((candidate) => (
    /one of your Bakugan are holding/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);
  assert.deepEqual(instruction.condition, {
    kind: "held-core-type",
    coreTypes: ["Fist"],
    subject: "controller-team",
  });

  const { state, attacker, attackingBakugan } = damageState();
  const otherFriendly = attacker.bakugan[1];
  attachCore(state, attacker.id, otherFriendly.id, "Fist");
  assert.equal(ruleConditionActive(state, attacker, instruction.condition, attackingBakugan), true);
});

test("all printed core-condition clauses compile to held-core conditions", () => {
  const conditionalCoreText = /(?:^\s*\[(?:FT|FF|SD|MS|HE)\].*:|\bif\b.*\bholding\b.*\[(?:FT|FF|SD|MS|HE)\]|\[Stop\].*\bholding\b.*\[(?:FT|FF|SD|MS|HE)\])/i;
  const failures = CARDS.flatMap((card) => compileCardEffect(card).instructions
    .filter((instruction) => (
      conditionalCoreText.test(instruction.sourceText)
      && instruction.condition.kind !== "held-core-type"
      && !instruction.actions.some((action) => JSON.stringify(action).includes('"kind":"held-core-type"'))
    ))
    .map((instruction) => `${card.catalogId}: ${instruction.sourceText}`));
  assert.deepEqual(failures, []);
});
