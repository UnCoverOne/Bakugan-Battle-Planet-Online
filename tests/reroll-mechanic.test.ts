import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { evoCanTarget } from "../lib/evo";
import {
  activateIntrinsicReroll,
  beginCorePlacement,
  cardRerollTimingLegal,
  confirmReroll,
  createMatch,
  flipStopsDamage,
  legalPlacementCells,
  passPriority,
  placeCore,
  playerCanActivateIntrinsicReroll,
  playCard,
  resolveStructuredEffect,
  selectRerollTarget,
  setReady,
  submitCardChoice,
  type GameCard,
  type MatchState,
  type PendingEffect,
  type RollOutcome,
} from "../lib/game";
import {
  captureCoreReturns,
  legalCoreReturnCells,
  pendingCoreReturnsForPlayer,
  placeCoreOrReturnCore,
} from "../lib/coreReturns";
import { availableRollTargets } from "../lib/rolling";
import { drawPendingCard } from "../lib/drawQueue";
import { flipDamageCard, resolveManualDamage, resumeDamageAfterFlipWindow } from "../lib/manualDamage";
import { apiActionToCommand } from "../lib/engine/commands";
import { compileCardEffect } from "../lib/rules/effects";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { cardCostBreakdown } from "../lib/rules/costs";

function catalogueCard(name: string, instance = name.toLowerCase().replace(/\W+/g, "-")) {
  const found = CARDS.find((card) => card.name === name || card.displayName === name);
  assert.ok(found, `${name} must exist in the catalogue`);
  return { ...found, id: `test-${instance}` };
}

function buildPlacedMatch() {
  const a = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const b = makePlayer("b", "Beta", STARTER_DECKS[1]);
  let state = setReady(setReady(createMatch("REROLL", "bo1", [a, b]), "a"), "b");
  state = beginCorePlacement(state, Number.POSITIVE_INFINITY);
  for (let index = 0; index < 12; index += 1) {
    const player = state.players.find((candidate) => candidate.id === state.priority)!;
    const used = state.placements.filter((placement) => placement.playerId === player.id).length;
    state = placeCore(state, player.id, player.cores[used].id, legalPlacementCells(state)[0]);
  }
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = "a";
  state.priority = "a";
  state.passes = [];
  state.selected = {
    a: state.players[0].bakugan[0].id,
    b: state.players[1].bakugan[0].id,
  };
  return state;
}

function outcome(
  state: MatchState,
  playerId: string,
  result: RollOutcome["result"],
  cores: string[] = [],
): RollOutcome {
  const bakuganId = state.selected[playerId];
  const target = cores[0] ?? state.placements.find((placement) => !placement.attachedTo)?.cell ?? "h3-3";
  return {
    playerId,
    bakuganId,
    target,
    resolvedTarget: target,
    result,
    cores,
    accuracyRoll: result === "miss-closed" || result === "open-no-core" ? 100 : 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 1,
    doubleCore: false,
    path: [],
    note: result,
    simulationProfileId: "test",
    attempt: 1,
    collisionDecisions: [],
  };
}

function establishRolls(
  state: MatchState,
  aResult: RollOutcome["result"],
  bResult: RollOutcome["result"],
  aCores: string[] = [],
  bCores: string[] = [],
) {
  for (const placement of state.placements) delete placement.attachedTo;
  for (const player of state.players) for (const bakugan of player.bakugan) {
    bakugan.open = false;
    bakugan.heldCoreCells = [];
  }
  state.rolls = {
    a: outcome(state, "a", aResult, aCores),
    b: outcome(state, "b", bResult, bCores),
  };
  for (const playerId of ["a", "b"]) {
    const roll = state.rolls[playerId];
    const bakugan = state.players.flatMap((player) => player.bakugan)
      .find((candidate) => candidate.id === roll.bakuganId)!;
    bakugan.open = roll.result !== "miss-closed";
    bakugan.heldCoreCells = [...roll.cores];
    for (const cell of roll.cores) {
      const placement = state.placements.find((candidate) => candidate.cell === cell);
      if (placement) placement.attachedTo = bakugan.id;
    }
  }
  state.targets = {};
  state.pendingReroll = undefined;
  state.pendingChoice = undefined;
  state.repeatRollAfterReroll = false;
  state.priority = "a";
  state.phase = "power";
  return state;
}

function effect(card: GameCard, controllerId = "a", id = `effect-${card.id}`): PendingEffect {
  return { id, controllerId, card, choices: {}, kind: "card" };
}

function randomSequence(...values: number[]) {
  let index = 0;
  return (maximum: number) => values[index++ % values.length] % maximum;
}

function chooseRerollTarget(state: MatchState, playerId: string) {
  const cell = availableRollTargets(state)[0]?.cell;
  assert.ok(cell, "a field BakuCore must be available for the Reroll");
  return selectRerollTarget(state, playerId, cell);
}

test("the typed catalogue separates independent effects, Rerolls, and open-on-Reroll clauses", () => {
  const darkWaters = compileCardEffect(catalogueCard("Dark Waters"));
  assert.equal(darkWaters.instructions.length, 2);
  assert.ok(darkWaters.instructions[0].effects.some((action) => action.kind === "modify-stat"));
  assert.ok(darkWaters.instructions[1].effects.some((action) => action.kind === "reroll"));
  assert.ok(darkWaters.instructions[1].choices.some((choice) => choice.id === "confirmed"));

  const fierce = compileCardEffect(catalogueCard("Rip Tide"));
  const openClauses = fierce.instructions.filter((instruction) => instruction.condition.kind === "reroll-opened");
  assert.equal(openClauses.length, 2);
  assert.ok(openClauses[0].effects.some((action) => action.kind === "modify-stat"));
  assert.equal(openClauses[0].choices.some((choice) => choice.id === "confirmed"), false);
  assert.ok(openClauses[1].effects.some((action) => action.kind === "draw"));
  assert.ok(openClauses[1].choices.some((choice) => choice.id === "confirmed"));

  const divine = compileCardEffect(catalogueCard("Divine Intervention"));
  assert.ok(divine.instructions.some((instruction) => instruction.effects.some(
    (action) => action.kind === "play" && action.source === "hand" && action.free,
  )));

  const superfuel = compileCardEffect(catalogueCard("Superfuel"));
  assert.ok(superfuel.instructions.some((instruction) => instruction.effects.some(
    (action) => action.kind === "cost" && action.duration === "next-card" && action.amount === 3,
  )));
});

test("every printed Reroll card maps to exactly one appropriate authoritative ability", () => {
  const printed = CARDS.filter((card) => /\bReroll\b/i.test(card.effect));
  const actions = printed.filter((card) => (
    !(["Character", "Evo"].includes(card.type)
      && /(?:once each turn|any time).*miss a Roll|miss a Roll.*(?:once each turn|any time)/i.test(card.effect))
    || /when[^.]*Reroll/i.test(card.effect)
  ));
  const intrinsic = printed.filter((card) => !actions.includes(card));
  assert.equal(actions.length, 33);
  assert.equal(intrinsic.length, 27);
  for (const card of actions) {
    const rerolls = compileCardEffect(card).instructions
      .flatMap((instruction) => instruction.effects)
      .filter((action) => action.kind === "reroll");
    assert.equal(rerolls.length, 1, `${card.name} must have one Reroll action`);
  }
  for (const card of intrinsic) {
    const rerolls = compileCardEffect(card).instructions
      .flatMap((instruction) => instruction.effects)
      .filter((action) => action.kind === "reroll");
    assert.equal(rerolls.length, 0, `${card.name} must use its intrinsic Reroll action instead of a spell action`);
  }
  assert.deepEqual(apiActionToCommand("reroll", {}), { type: "ACTIVATE_REROLL" });
});

test("all-closed first rolls reject mandatory Rerolls and silently skip optional Reroll clauses", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "miss-closed");
  assert.equal(cardRerollTimingLegal(state, "a", catalogueCard("Superfuel")), false);
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Dark Waters"), "a", "both-missed-dark-waters"),
  );
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.pendingReroll, undefined);
  assert.equal(state.powerBoost[state.players[0].bakugan[0].id], 200);
});

test("effect draws finish before a later optional Reroll clause is offered", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "open-no-core", "open-no-core");
  const before = state.players[0].hand.length;
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Deep Dive"), "a", "deep-dive-effect"),
  );
  assert.equal(state.pendingChoice, undefined);
  assert.equal((state as MatchState & { pendingDrawQueue?: unknown[] }).pendingDrawQueue?.length, 1);
  state = drawPendingCard(state, "a");
  assert.equal(state.players[0].hand.length, before + 1);
  assert.equal(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"), true);
  state = submitCardChoice(state, "a", { confirmed: false });
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.pendingReroll, undefined);
});

test("mandatory Reroll cards are playable only after the first roll and before Victor", () => {
  const state = buildPlacedMatch();
  const card = catalogueCard("Superfuel");
  establishRolls(state, "miss-closed", "intended-core", [], [state.placements[0].cell]);
  state.phase = "preRoll";
  assert.equal(cardRerollTimingLegal(state, "a", card), false);
  state.phase = "power";
  assert.equal(cardRerollTimingLegal(state, "a", card), true);
  state.phase = "victor";
  assert.equal(cardRerollTimingLegal(state, "a", card), false);
});

test("an open Bakugan returns held Cores before its Reroll and can land on a new Core", () => {
  const before = buildPlacedMatch();
  const heldCell = before.placements[0].cell;
  establishRolls(before, "intended-core", "miss-closed", [heldCell], []);
  const superfuel = catalogueCard("Superfuel", "superfuel-return");
  const started = resolveStructuredEffect(before, effect(superfuel, "a", "superfuel-return-effect"));
  assert.equal(started.phase, "reroll");
  assert.equal(started.players[0].bakugan[0].open, false);

  let pending = captureCoreReturns(before, started);
  assert.equal(pending.phase, "retract");
  const returnedCore = pendingCoreReturnsForPlayer(pending, "a")[0];
  assert.equal(returnedCore?.core.id, before.placements[0].core.id);
  pending = placeCoreOrReturnCore(
    pending,
    "a",
    returnedCore.core.id,
    legalCoreReturnCells(pending)[0],
  );
  assert.equal(pending.phase, "reroll");

  const target = availableRollTargets(pending).find((placement) => placement.core.id !== returnedCore.core.id)
    ?? availableRollTargets(pending)[0];
  assert.ok(target);
  pending = selectRerollTarget(pending, "a", target.cell);
  const resolved = confirmReroll(pending, "a", randomSequence(0, 0, 99, 0));
  assert.equal(resolved.phase, "power");
  assert.equal(resolved.rolls.a.rerollSequence, 1);
  assert.equal(resolved.players[0].bakugan[0].open, true);
  assert.ok(resolved.players[0].bakugan[0].heldCoreCells.length >= 1);
  assert.equal(resolved.nextCardCostReduction.a, 3);
});

test("forced opponent Rerolls preserve the controller target for conditional follow-up effects", () => {
  const state = buildPlacedMatch();
  establishRolls(state, "intended-core", "open-no-core", [state.placements[0].cell], []);
  state.players[0].energyZone = state.players[0].hand.slice(0, 2);
  state.players[1].energyZone = [];
  const opponentBakugan = state.players[1].bakugan[0];
  const opticBeam = catalogueCard("Optic Beam");
  let next = resolveStructuredEffect(state, effect(opticBeam, "a", "optic-effect"));
  assert.equal(next.phase, "reroll");
  assert.equal(next.pendingReroll?.playerId, "b");
  next = chooseRerollTarget(next, "b");
  next = confirmReroll(next, "b", randomSequence(99, 0, 99, 0));
  assert.equal(next.phase, "power");
  assert.equal(next.rolls.b.result, "miss-closed");
  assert.equal(next.powerBoost[opponentBakugan.id], -500);
  assert.notEqual(next.powerBoost[state.players[0].bakugan[0].id], -500);
});

test("Mind Slip makes the chosen player discard before its optional Reroll decision", () => {
  const state = buildPlacedMatch();
  establishRolls(state, "open-no-core", "open-no-core");
  const mindSlip = catalogueCard("Mind Slip");
  const betaBefore = state.players[1].hand.length;
  let next = resolveStructuredEffect(state, effect(mindSlip, "a", "mind-slip-effect"));
  assert.equal(next.pendingChoice?.schema.fields[0]?.id, "targetPlayerId");
  next = submitCardChoice(next, "a", { targetPlayerId: "b" });
  assert.equal(next.pendingChoice?.kind, "resolution");
  assert.equal(next.priority, "b");
  const discardField = next.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.equal(discardField?.chooserId, "b");
  assert.ok(discardField?.options[0]);
  next = submitCardChoice(next, "b", { discardCardIds: [discardField.options[0].id] });
  assert.equal(next.players[1].hand.length, betaBefore - 1);
  assert.equal(next.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"), true);
  next = submitCardChoice(next, "a", { confirmed: false });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.phase, "power");
});

test("Reroll-open clauses do nothing when the Reroll misses", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "open-no-core", "open-no-core");
  const active = state.players[0].bakugan[0];
  const handBefore = state.players[0].hand.length;
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Rip Tide"), "a", "failed-rip-tide-effect"),
  );
  state = chooseRerollTarget(state, "a");
  state = confirmReroll(state, "a", randomSequence(99, 0, 99, 0));
  assert.equal(state.rolls.a.result, "miss-closed");
  assert.equal(state.powerBoost[active.id] ?? 0, 0);
  assert.equal(state.pendingChoice, undefined);
  assert.equal((state as MatchState & { pendingDrawQueue?: unknown[] }).pendingDrawQueue, undefined);
  assert.equal(state.players[0].hand.length, handBefore);
});

test("Reroll-open draws complete before the deferred open event is emitted", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Rip Tide"), "a", "rip-tide-effect"),
  );
  state = chooseRerollTarget(state, "a");
  state = confirmReroll(state, "a", randomSequence(0, 0, 99, 0));
  const active = state.players[0].bakugan[0];
  assert.equal(state.powerBoost[active.id], 500);
  assert.equal(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"), true);
  assert.equal(state.collectedEventKeys.some((key) => key.includes("reroll-open")), false);
  state = submitCardChoice(state, "a", { confirmed: true });
  assert.equal((state as MatchState & { pendingDrawQueue?: unknown[] }).pendingDrawQueue?.length, 1);
  state = drawPendingCard(state, "a");
  assert.equal((state as MatchState & { pendingDrawQueue?: Array<{ remaining: number }> }).pendingDrawQueue?.[0]?.remaining, 1);
  assert.equal(state.collectedEventKeys.some((key) => key.includes("reroll-open")), false);
  state = drawPendingCard(state, "a");
  assert.equal(state.collectedEventKeys.some((key) => key.includes("reroll-open")), true);
  assert.equal(state.pendingRerollOpenEvent, undefined);
});

test("Quickfire finishes its separate attack before offering its optional Reroll", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  const nonFlip = state.players[1].deckCards.find((card) => card.type !== "Flip");
  assert.ok(nonFlip);
  state.players[1].deckCards = [
    nonFlip,
    ...state.players[1].deckCards.filter((card) => card.id !== nonFlip.id),
  ];
  state.players[1].deck = state.players[1].deckCards.length;
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Quickfire"), "a", "quickfire-effect"),
  );
  assert.equal(state.phase, "damage");
  assert.equal(state.pendingDamage, 1);
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.pendingEffectDamageResume?.sourceEffectId, "quickfire-effect");
  state = flipDamageCard(state, "b");
  assert.equal(state.phase, "power");
  assert.equal(state.pendingEffectDamageResume, undefined);
  assert.equal(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"), true);
  state = submitCardChoice(state, "a", { confirmed: true });
  assert.equal(state.phase, "reroll");
  state = chooseRerollTarget(state, "a");
  state = confirmReroll(state, "a", randomSequence(0, 0, 99, 0));
  assert.equal(state.phase, "power");
  assert.equal(state.rolls.a.rerollSource, "Quickfire");
});

test("Quickfire resumes its Reroll clause after a played Flip finishes resolving", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Quickfire"), "a", "quickfire-flip-effect"),
  );
  assert.equal(state.phase, "damage");
  const printing = CARDS.find((card) => card.type === "Flip"
    && card.cost === 0
    && flipStopsDamage(state, card)
    && ruleDefinitionForCard(card).abilities.every((ability) => ability.instructions.every((instruction) => instruction.choices.length === 0)));
  assert.ok(printing, "the catalogue must contain a legal zero-cost Flip for Quickfire's Pyrus attack");
  const flip = { ...printing, id: "quickfire-response-flip" };
  state.players[1].deckCards = [flip, ...state.players[1].deckCards];
  state.players[1].deck = state.players[1].deckCards.length;
  state = flipDamageCard(state, "b");
  assert.equal(state.revealedFlip?.id, flip.id);
  state = resolveManualDamage(state, "b", flip.id, {});
  assert.equal(state.phase, "postDamage");
  state = passPriority(state, state.priority);
  state = resumeDamageAfterFlipWindow(passPriority(state, state.priority));
  assert.equal(state.phase, "power");
  assert.equal(state.pendingEffectDamageResume, undefined);
  assert.equal(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"), true);
});

test("Divine Intervention offers only a matching Evo and plays it for free after a successful Reroll", () => {
  const state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  const active = state.players[0].bakugan[0];
  const evo = CARDS.find((card) => card.type === "Evo" && evoCanTarget(card, active));
  assert.ok(evo);
  const evoInstance = { ...evo, id: "free-reroll-evo" };
  state.players[0].hand = [evoInstance, ...state.players[0].hand];

  let next = resolveStructuredEffect(
    state,
    effect(catalogueCard("Divine Intervention"), "a", "divine-effect"),
  );
  next = chooseRerollTarget(next, "a");
  next = confirmReroll(next, "a", randomSequence(0, 0, 99, 0));
  const handField = next.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds");
  assert.deepEqual(handField?.options.map((option) => option.id), [evoInstance.id]);
  next = submitCardChoice(next, "a", { confirmed: true, handCardIds: [evoInstance.id] });
  assert.equal(next.players[0].hand.some((card) => card.id === evoInstance.id), false);
  assert.equal(next.batch.some((pending) => pending.card.id === evoInstance.id), true);

  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(active.id, next.players[0].bakugan[0].id);
  assert.equal(next.players[0].bakugan[0].evoStack.some((card) => card.id === evoInstance.id), true);
});

test("Thunder Storm sacrifices exactly the chosen card before beginning its optional Reroll", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  const cardToSacrifice = state.players[0].hand[0];
  const before = state.players[0].hand.length;
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Thunder Storm"), "a", "thunder-storm-effect"),
  );
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
  assert.equal(field?.minimum, 0);
  assert.equal(field?.maximum, 1);
  state = submitCardChoice(state, "a", { discardCardIds: [cardToSacrifice.id] });
  assert.equal(state.players[0].hand.length, before - 1);
  assert.equal(state.players[0].discard.some((card) => card.id === cardToSacrifice.id), true);
  assert.equal(state.phase, "reroll");
});

test("successful Superfuel copies stack and the complete reduction is consumed by the next card", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  const superfuel = catalogueCard("Superfuel", "stacking-superfuel");
  for (const id of ["superfuel-copy-one", "superfuel-copy-two"]) {
    state = resolveStructuredEffect(state, effect({ ...superfuel, id }, "a", `${id}-effect`));
    state = chooseRerollTarget(state, "a");
    // Accuracy misses, but the weighted deviation opens without collecting a Core.
    state = confirmReroll(state, "a", randomSequence(99, 6999, 99, 0));
    assert.equal(state.rolls.a.result, "open-no-core");
  }
  assert.equal(state.nextCardCostReduction.a, 6);

  const nextCard = catalogueCard("Blaze", "discounted-next-card");
  const instance = { ...nextCard, id: "discounted-next-card" };
  state.players[0].hand.unshift(instance);
  state.players[0].energy = 0;
  assert.equal(cardCostBreakdown(state, "a", instance).total, 0);
  const played = playCard(state, "a", instance.id, {});
  assert.equal(played.nextCardCostReduction.a, 0);
});

test("a stacked Superfuel reduction is consumed by a played Flip card", () => {
  const state = buildPlacedMatch();
  establishRolls(state, "open-no-core", "open-no-core");
  const printing = CARDS.find((card) => card.type === "Flip" && card.cost !== "X" && card.cost <= 6);
  assert.ok(printing);
  const flip = { ...printing, id: "discounted-damage-flip" };
  state.players[0].discard.push(flip);
  state.players[0].energy = 0;
  state.nextCardCostReduction.a = 6;
  state.phase = "damage";
  state.pendingLoser = "a";
  state.pendingDamage = 1;
  state.damageFaction = "Pyrus";
  state.revealedFlip = flip;
  const played = resolveManualDamage(
    state,
    "a",
    flip.id,
    {},
  );
  assert.equal(played.nextCardCostReduction.a, 0);
  assert.equal(played.batch.some((pending) => pending.card.id === flip.id), true);
});

test("a failed Reroll against a closed Bakugan repeats the normal Rolling Step after showing the result", () => {
  const state = buildPlacedMatch();
  establishRolls(state, "open-no-core", "miss-closed");
  let next = resolveStructuredEffect(
    state,
    effect(catalogueCard("Superfuel"), "a", "repeat-reroll-effect"),
  );
  next = chooseRerollTarget(next, "a");
  next = confirmReroll(next, "a", randomSequence(99, 0, 99, 0));
  assert.equal(next.phase, "target");
  assert.deepEqual(next.targets, {});
  assert.equal(next.rolls.a.result, "miss-closed");
  assert.equal(next.rolls.a.rerollSequence, 1);
  assert.equal(next.rolls.b.result, "miss-closed");
});

test("intrinsic once-per-turn and any-time miss abilities expose an authoritative Reroll action", () => {
  let once = buildPlacedMatch();
  establishRolls(once, "miss-closed", "open-no-core");
  const oncePrinting = CARDS.find((card) => card.type === "Character" && /Reroll this once each turn/i.test(card.effect));
  assert.ok(oncePrinting);
  const onceSource = { ...oncePrinting, id: "test-once-reroll-character" };
  once.players[0].bakugan[0].character = onceSource;
  assert.equal(playerCanActivateIntrinsicReroll(once, "a"), true);
  once = activateIntrinsicReroll(once, "a");
  once = chooseRerollTarget(once, "a");
  once = confirmReroll(once, "a", randomSequence(0, 0, 99, 0));
  establishRolls(once, "miss-closed", "open-no-core");
  assert.equal(playerCanActivateIntrinsicReroll(once, "a"), false);

  let unlimited = buildPlacedMatch();
  establishRolls(unlimited, "miss-closed", "open-no-core");
  const anyTime = catalogueCard("Maximus Webam Ultra", "any-time-reroll");
  assert.match(anyTime.effect, /any time you miss/i);
  unlimited.players[0].bakugan[0].character = anyTime;
  unlimited = activateIntrinsicReroll(unlimited, "a");
  unlimited = chooseRerollTarget(unlimited, "a");
  unlimited = confirmReroll(unlimited, "a", randomSequence(0, 0, 99, 0));
  establishRolls(unlimited, "miss-closed", "open-no-core");
  assert.equal(playerCanActivateIntrinsicReroll(unlimited, "a"), true);
});

test("Shadow Dogs grants the rerolled Bakugan a Victor discard choice", () => {
  let state = buildPlacedMatch();
  establishRolls(state, "miss-closed", "open-no-core");
  state.players[1].hand = state.players[1].hand.slice(0, 4);
  state = resolveStructuredEffect(
    state,
    effect(catalogueCard("Shadow Dogs"), "a", "shadow-dogs-effect"),
  );
  state = chooseRerollTarget(state, "a");
  state = confirmReroll(state, "a", randomSequence(0, 0, 99, 0));
  const active = state.players[0].bakugan[0];
  assert.equal(state.powerBoost[active.id], 400);
  assert.equal(state.temporaryVictorDiscards[active.id]?.amount, 2);

  state = passPriority(state, state.priority);
  state = passPriority(state, state.priority);
  assert.equal(state.phase, "victor");
  assert.equal(state.pendingChoice?.kind, "forced-discard");
  const discardOptions = state.pendingChoice?.schema.fields[0].options.map((option) => option.id) ?? [];
  const before = state.players[1].hand.length;
  state = submitCardChoice(state, "b", { discardCardIds: discardOptions.slice(0, 2) });
  assert.equal(state.players[1].hand.length, before - 2);
  assert.equal(state.pendingChoice, undefined);
});
