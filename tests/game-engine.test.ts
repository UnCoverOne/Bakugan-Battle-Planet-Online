import test from "node:test";
import assert from "node:assert/strict";
import { BAKUGAN, CARDS, CORES, STARTER_DECKS, deckErrors, makePlayer } from "../lib/data";
import { CONTENT_MANIFEST } from "../lib/content/catalogue";
import {
  CENTER_CELL, HEX_CELLS, beginCorePlacement, cardChoiceSpec, createMatch, discardToHandLimit, energizeCard, flipStopsDamage,
  legalPlacementCells, nextTurn, normalizeMatchState, orderTriggers, passPriority, placeCore, playCard, selectBakugan,
  setReady, startNextSeriesGame, submitCardChoice, targetCore, totalPower, type MatchState,
} from "../lib/game";
import { drawTurnCard } from "../lib/turnStart";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
import { timeoutChoicesForFields } from "../lib/engine/timeout-policy";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { drawPendingCard, hasPendingDraws } from "../lib/drawQueue";

const passWindow = (state: MatchState) => {
  state = passPriority(state, state.priority); return passPriority(state, state.priority);
};

const resolveMandatoryVictorDiscard = (state: MatchState) => {
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
  assert.ok(field?.options[0], "Victor discard must expose a legal opponent hand card");
  return submitCardChoice(state, field.chooserId, { discardCardIds: [field.options[0].id] });
};

const settleDamage = (input: MatchState) => {
  let state = input;
  while (state.phase === "damage") {
    state = state.revealedFlip
      ? resolveManualDamage(state, state.pendingLoser)
      : flipDamageCard(state, state.pendingLoser);
  }
  return state;
};

const buildPlacedMatch = () => {
  const a = makePlayer("a", "Alpha", STARTER_DECKS[0]); const b = makePlayer("b", "Beta", STARTER_DECKS[1]);
  let state = setReady(setReady(createMatch("TEST01", "bo3", [a, b]), "a"), "b");
  assert.equal(state.phase, "startingPlayer");
  state = beginCorePlacement(state, Number.POSITIVE_INFINITY);
  assert.deepEqual(legalPlacementCells(state), [CENTER_CELL]);
  for (let index = 0; index < 12; index += 1) {
    const player = state.players.find((candidate) => candidate.id === state.priority)!;
    const core = player.cores[state.placements.filter((placement) => placement.playerId === player.id).length];
    state = placeCore(state, player.id, core.id, legalPlacementCells(state)[0]);
  }
  return state;
};

const completeTurnDraws = (input: MatchState) => {
  let state = input;
  for (const player of state.players) state = drawTurnCard(state, player.id, Number.POSITIVE_INFINITY);
  return state;
};

const reachPower = () => {
  let state = buildPlacedMatch();
  state = completeTurnDraws(state);
  state = energizeCard(state, "a", state.players[0].hand[0].id); state = energizeCard(state, "b", state.players[1].hand[0].id);
  state = selectBakugan(state, "a", state.players[0].bakugan[0].id); state = selectBakugan(state, "b", state.players[1].bakugan[0].id);
  state = passWindow(state); assert.equal(state.phase, "target");
  const target = state.placements[0].cell; state = targetCore(state, "a", target); state = targetCore(state, "b", target);
  assert.equal(state.phase, "power"); return state;
};

test("the complete supplied Battle Planet catalogue is normalized and playable", () => {
  assert.equal(CARDS.length, CONTENT_MANIFEST.cardCount);
  assert.equal(BAKUGAN.length, CARDS.filter((card) => card.type === "Character" && card.fusionFace !== "b" && card.bPower != null && card.damage != null).length);
  assert.equal(CORES.filter((core) => core.set === "Battle Brawlers").length, 52);
  assert.equal(CORES.filter((core) => core.set === "Armored Alliance").length, 28);
  const typeCounts = Object.fromEntries(["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo", "Character"].map((type) => [type, CARDS.filter((card) => card.type === type).length]));
  assert.equal(Object.values(typeCounts).reduce((sum, count) => sum + count, 0), CONTENT_MANIFEST.cardCount);
  assert.equal(new Set(CARDS.map((card) => card.catalogId)).size, CONTENT_MANIFEST.cardCount);
  assert.ok(CARDS.every((card) => card.effect != null && card.mechanics && card.art));
  assert.ok(CARDS.filter((card) => ["Character","Evo"].includes(card.type)).every((card) => card.bPower != null && card.damage != null));
  assert.ok(STARTER_DECKS.every((deck) => deckErrors(deck).length === 0));
});

test("the Hide Matrix is a radius-three axial hex and placement remains connected", () => {
  assert.equal(HEX_CELLS.length, 61); assert.ok(HEX_CELLS.some((cell) => cell.id === CENTER_CELL && cell.q === 0 && cell.r === 0));
  const state = buildPlacedMatch(); assert.equal(state.placements[0].cell, CENTER_CELL); assert.equal(state.placements.length, 12); assert.equal(state.phase, "draw");
  for (let index = 1; index < state.placements.length; index += 1) {
    const current = HEX_CELLS.find((cell) => cell.id === state.placements[index].cell)!;
    assert.ok(state.placements.slice(0, index).some((placed) => { const prior = HEX_CELLS.find((cell) => cell.id === placed.cell)!; return (Math.abs(current.q-prior.q)+Math.abs(current.r-prior.r)+Math.abs(current.q+current.r-prior.q-prior.r))/2 === 1; }));
  }
});

test("separate copies of the same BakuCore catalogue entry can both be placed", () => {
  const source = STARTER_DECKS.find((deck) => {
    const types = deck.coreIds.map((id) => CORES.find((core) => core.id === id)?.type);
    return types.some((type, index) => types.indexOf(type) !== index);
  });
  assert.ok(source);
  const coreIds = [...source.coreIds];
  const firstIndex = coreIds.findIndex((id, index) => (
    coreIds.findIndex((candidate) => CORES.find((core) => core.id === candidate)?.type
      === CORES.find((core) => core.id === id)?.type) !== index
  ));
  assert.ok(firstIndex > 0);
  const matchingIndex = coreIds.findIndex((id, index) => index < firstIndex
    && CORES.find((core) => core.id === id)?.type === CORES.find((core) => core.id === coreIds[firstIndex])?.type);
  coreIds[firstIndex] = coreIds[matchingIndex];
  const duplicateDeck = { ...source, coreIds };
  assert.deepEqual(deckErrors(duplicateDeck), []);

  const player = makePlayer("copies", "Copies", duplicateDeck);
  const opponent = makePlayer("other", "Other", STARTER_DECKS[1]);
  const copies = player.cores.filter((core) => core.catalogId === coreIds[matchingIndex]);
  assert.equal(copies.length, 2);
  assert.notEqual(copies[0].id, copies[1].id);

  let match = createMatch("COPY02", "bo1", [player, opponent]);
  match.phase = "placement";
  match.priority = player.id;
  match = placeCore(match, player.id, copies[0].id, CENTER_CELL);
  match.priority = player.id;
  match = placeCore(match, player.id, copies[1].id, legalPlacementCells(match)[0]);
  assert.deepEqual(
    match.placements.filter((placement) => placement.playerId === player.id)
      .map((placement) => placement.core.catalogId),
    [coreIds[matchingIndex], coreIds[matchingIndex]],
  );

  let modern = createMatch("COPYID", "bo1", [player, opponent]);
  modern.phase = "placement";
  modern.priority = player.id;
  modern = placeCore(modern, player.id, copies[1].id, CENTER_CELL);
  const normalizedModern = normalizeMatchState(modern);
  assert.equal(normalizedModern.placements[0].core.id, copies[1].id);

  const legacy = createMatch("LEGACY", "bo1", [player, opponent]);
  legacy.players[0].cores = copies.map((core) => ({ ...core, id: core.catalogId!, catalogId: undefined }));
  const upgraded = normalizeMatchState(legacy);
  assert.equal(new Set(upgraded.players[0].cores.map((core) => core.id)).size, 2);
});

test("the full turn enters Draw/Energize, Selection, pre-roll priority, target and Power", () => {
  let state = buildPlacedMatch(); assert.equal(state.players[0].hand.length, 5); assert.equal(state.phase, "draw");
  state = completeTurnDraws(state); assert.equal(state.players[0].hand.length, 6); assert.equal(state.phase, "energize");
  state = energizeCard(state, "a", state.players[0].hand[0].id); state = energizeCard(state, "b"); assert.equal(state.phase, "selection");
  assert.equal(state.players[0].energyZone.length, 1); assert.equal(state.players[1].energyZone.length, 0);
  state = selectBakugan(state, "a", state.players[0].bakugan[0].id); state = selectBakugan(state, "b", state.players[1].bakugan[0].id); assert.equal(state.phase, "preRoll");
  state = passWindow(state); assert.equal(state.phase, "target"); state = targetCore(state, "a", state.placements[0].cell); assert.equal(Object.keys(state.rolls).length, 0);
  state = targetCore(state, "b", state.placements[0].cell); assert.equal(state.phase, "power"); assert.equal(Object.keys(state.rolls).length, 2); assert.ok(state.log.some((entry) => entry.kind === "random"));
});

test("priority is retained, the batch is LIFO, and an Action resolves only after sequential passes", () => {
  let state = reachPower(); const actor = state.priority; const player = state.players.find((candidate) => candidate.id === actor)!;
  const fireball = { ...CARDS.find((card) => card.number === 93)!, id:"test-fireball" }; player.hand.push(fireball); player.energy = 10;
  const target = state.players.find((candidate) => candidate.id === actor)!.bakugan.find((bakugan) => bakugan.id === state.selected[actor])!;
  state = playCard(state, actor, fireball.id); assert.equal(state.priority, actor); assert.equal(state.batch.length, 1); assert.equal(state.players.find((candidate) => candidate.id === actor)!.cardsPlayedThisTurn, 1);
  state = passPriority(state, actor); assert.notEqual(state.priority, actor); state = passPriority(state, state.priority);
  assert.equal(state.batch.length, 0); assert.equal(state.phase, "power"); assert.ok((state.damageBoost[target.id] ?? 0) >= 3); assert.ok(state.players.find((candidate) => candidate.id === actor)!.discard.some((card) => card.name === "Fireball"));
});

test("Baku-Gear resolves onto its chosen Bakugan and contributes printed stats", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  target.open = true;
  const source = CARDS.find((card) => card.type === "Baku-Gear" && typeof card.cost === "number" && !/Reroll/i.test(card.effect))!;
  const gear = { ...source, id: "test-baku-gear" };
  player.hand.push(gear);
  player.energy = 20;
  target.open = true;
  state.rolls[actor].result = "open-no-core";
  const before = totalPower(state, actor);

  state = playCard(state, actor, gear.id, { targetBakuganId: target.id });
  state = passWindow(state);

  const attached = state.players.find((candidate) => candidate.id === actor)!.bakugan
    .find((candidate) => candidate.id === target.id)!.bakuGear ?? [];
  assert.deepEqual(attached.map((card) => card.id), [gear.id]);
  assert.equal(totalPower(state, actor), before + (gear.bPower ?? 0));
});

test("Baku-Gear enforces open and faction-restricted targets", () => {
  const state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  const source = { ...CARDS.find((card) => card.catalogId === "ff-99")!, id: "aurelus-gear" };
  player.hand.push(source);
  player.energy = 20;
  target.open = false;
  assert.throws(() => playCard(state, actor, source.id, { targetBakuganId: target.id }), /open Bakugan/);
  target.open = true;
  assert.throws(() => playCard(state, actor, source.id, { targetBakuganId: target.id }), /Aurelus Bakugan/);
});

test("Baku-Gear count scaling and full-name BakuCore attachments are typed", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  target.open = true;
  target.bakuGear = [
    { ...CARDS.find((card) => card.catalogId === "av-87")!, id: "gear-one" },
    { ...CARDS.find((card) => card.catalogId === "av-88")!, id: "gear-two" },
  ];
  const action = { ...CARDS.find((card) => card.catalogId === "ff-44")!, id: "gear-scaling-action" };
  player.hand.push(action);
  player.energy = 20;
  const before = totalPower(state, actor);
  state = playCard(state, actor, action.id);
  state = passWindow(state);
  assert.equal(totalPower(state, actor), before + 1000);

  const gearWithCoreText = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "sv-114")!);
  const instruction = gearWithCoreText.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => /attach a \[Fist\]/i.test(candidate.sourceText));
  assert.ok(instruction);
  assert.ok(instruction.effects.some((effect) => effect.kind === "move" && effect.object === "bakucore" && effect.verb === "attach"));
  assert.deepEqual(instruction.choices.find((choice) => choice.id === "coreCell")?.coreTypes, ["Fist"]);
});

test("attaching Baku-Gear emits the Character attachment trigger", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  target.open = true;
  target.character = { ...CARDS.find((card) => card.catalogId === "ff-217")!, id: "howlkor-trigger" };
  target.evoStack = [];
  const gear = { ...CARDS.find((card) => card.catalogId === "av-87")!, id: "triggered-gear" };
  player.hand.push(gear);
  player.energy = 20;
  const handBefore = player.hand.length;
  state = playCard(state, actor, gear.id, { targetBakuganId: target.id });
  for (let index = 0; index < 8 && state.batch.length; index += 1) state = passPriority(state, state.priority);
  while (hasPendingDraws(state)) state = drawPendingCard(state, state.priority);
  const resolvedPlayer = state.players.find((candidate) => candidate.id === actor)!;
  const resolvedTarget = resolvedPlayer.bakugan.find((candidate) => candidate.id === target.id)!;
  assert.deepEqual(resolvedTarget.bakuGear?.map((card) => card.id), [gear.id]);
  assert.equal(resolvedPlayer.hand.length, handBefore, "the played Gear is replaced by Howlkor's attachment draw");
  assert.ok(state.log.some((entry) => entry.message.toLowerCase().includes("draw")));
});

test("Sync reveals only a qualifying hand card and replaces or gates its effect", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  target.open = true;
  const syncCard = { ...CARDS.find((card) => card.catalogId === "ff-2")!, id: "sync-action" };
  const tooCheap = { ...CARDS.find((card) => card.catalogId === "bb-1")!, id: "sync-too-cheap" };
  const qualifying = { ...CARDS.find((card) => card.cost === 6 && card.type === "Action")!, id: "sync-qualifying" };
  player.hand.push(syncCard, tooCheap, qualifying);
  player.energy = 20;
  const before = totalPower(state, actor);
  state = playCard(state, actor, syncCard.id);
  state = passWindow(state);
  const syncField = state.pendingChoice?.schema.fields.find((field) => field.id === "syncCardId");
  assert.ok(syncField);
  assert.ok(syncField.options.some((option) => option.id === qualifying.id));
  assert.ok(!syncField.options.some((option) => option.id === tooCheap.id));
  state = submitCardChoice(state, actor, { syncCardId: [qualifying.id] });
  assert.equal(totalPower(state, actor), before + 500, "the Sync branch replaces the base +200 B effect");
  assert.ok(state.log.some((entry) => entry.message.includes("Sync")));
});

test("Sync same-name clauses only offer a copy of the played card", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const syncCard = { ...CARDS.find((card) => card.catalogId === "av-77")!, id: "same-name-sync" };
  const matchingCard = { ...syncCard, id: "same-name-reveal" };
  const otherCard = { ...CARDS.find((card) => card.catalogId === "av-1")!, id: "different-name-reveal" };
  player.hand.push(syncCard, matchingCard, otherCard);
  player.energy = 20;
  state = playCard(state, actor, syncCard.id);
  state = passWindow(state);
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "syncCardId");
  assert.ok(field);
  assert.ok(field.options.some((option) => option.id === matchingCard.id));
  assert.ok(!field.options.some((option) => option.id === otherCard.id));
});

test("optional Sync can be declined without applying its bonus", () => {
  let state = reachPower();
  const actor = state.priority;
  const player = state.players.find((candidate) => candidate.id === actor)!;
  const target = player.bakugan.find((candidate) => candidate.id === state.selected[actor])!;
  target.open = true;
  const syncCard = { ...CARDS.find((card) => card.catalogId === "av-1")!, id: "optional-sync-action" };
  const qualifying = { ...CARDS.find((card) => card.cost === 1 && card.type === "Action")!, id: "sync-optional-card" };
  player.hand.push(syncCard, qualifying);
  player.energy = 20;
  const before = totalPower(state, actor);
  state = playCard(state, actor, syncCard.id);
  state = passWindow(state);
  assert.equal(state.pendingChoice?.schema.fields.find((field) => field.id === "syncCardId")?.minimum, 0);
  state = submitCardChoice(state, actor, { syncCardId: [] });
  assert.equal(totalPower(state, actor), before + 200);
});

test("Sync definitions keep played-card identity, follow-up choices, and revealed Evo damage typed", () => {
  const sameName = CARDS.find((card) => card.catalogId === "av-77")!;
  const sameNameDefinition = ruleDefinitionForCard(sameName);
  assert.equal(sameNameDefinition.play.choices.some((choice) => choice.id === "confirmed"), false);
  const sameNameChoice = sameNameDefinition.abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => instruction.sourceText.includes("same name"))?.choices.find((choice) => choice.id === "syncCardId");
  assert.equal(sameNameChoice?.sameNameAsEvent, true);

  const followUp = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "ff-77")!);
  const syncInstruction = followUp.abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => instruction.sourceText.includes("Sync:"));
  assert.deepEqual(syncInstruction?.actions.map((action) => action.kind), ["draw", "discard"]);
  assert.equal(syncInstruction?.choices.find((choice) => choice.id === "targetPlayerId")?.minimum, 1);

  const evoSync = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "av-136")!);
  const evoAction = evoSync.abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => instruction.sourceText.includes("reveal an Evo"))?.actions[0];
  assert.equal(evoAction?.kind, "modify-stat");
  if (evoAction?.kind === "modify-stat") {
    assert.deepEqual(evoAction.amount, {
      kind: "property",
      subject: { kind: "card", selector: "chosen", choiceId: "syncCardId" },
      property: "damage",
    });
  }
});

test("Hero, Evo, Action, Flip, Flip Hero, Baku-Gear and X-cost cards expose typed announcement and payment paths", () => {
  const state = reachPower(); const player = state.players[0];
  const evo = CARDS.find((card) => card.type === "Evo" && card.evolvesFrom === player.bakugan[0].name && card.faction === player.bakugan[0].faction);
  const xCard = CARDS.find((card) => card.cost === "X")!; const sacrifice = CARDS.find((card) => card.effect.toLowerCase().includes("sacrifice"))!;
  assert.ok(evo); assert.ok(cardChoiceSpec(state, player.id, evo!).includes("targetBakugan")); assert.ok(cardChoiceSpec(state, player.id, xCard).includes("xValue"));
  assert.equal(cardChoiceSpec(state, player.id, sacrifice).includes("discard"), false, "Sacrifice choices are made during resolution, not announcement.");
  assert.equal(CARDS.filter((card) => card.type === "Flip").length, 128);
  assert.equal(CARDS.filter((card) => card.type === "Flip Hero").length, 5);
  assert.equal(CARDS.filter((card) => card.type === "Hero").length, 83);
  assert.equal(CARDS.filter((card) => card.type === "Baku-Gear").length, 90);
});

test("B-Power ties use Energy-cost flips and the Victor Step precedes sequential damage", () => {
  let state = reachPower(); const a = state.players[0]; const b = state.players[1];
  const aBakugan = a.bakugan.find((bakugan) => bakugan.id === state.selected[a.id])!; const bBakugan = b.bakugan.find((bakugan) => bakugan.id === state.selected[b.id])!;
  aBakugan.open = true; bBakugan.open = true; state.rolls[a.id].result = "open-no-core"; state.rolls[b.id].result = "open-no-core";
  state.powerBoost[aBakugan.id] = totalPower(state,b.id)-totalPower(state,a.id); a.deckCards.unshift({ ...CARDS.find((card) => card.cost === 6)!, id:"tie-a" }); b.deckCards.unshift({ ...CARDS.find((card) => card.cost === 1)!, id:"tie-b" });
  state = passWindow(state); assert.equal(state.phase,"victor"); assert.equal(state.brawlWinner,"a"); assert.ok(state.log.some((entry) => entry.message.includes("tie-break")));
});

test("damage Flips enter the batch, open a response window, and Stop ends damage only on resolution", () => {
  let state = reachPower(); const wantedWinner = state.players[0]; const attacking = wantedWinner.bakugan.find((bakugan) => bakugan.id === state.selected[wantedWinner.id])!;
  attacking.open = true; state.rolls[wantedWinner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999; state = passWindow(state); assert.equal(state.phase,"victor");
  const loser = state.players[1]; const stop = { ...CARDS.find((card) => card.name === `Halt ${attacking.faction}` || card.name === `Counter ${attacking.faction}` || card.name === `Block ${attacking.faction}` || card.name === `Repel ${attacking.faction}`)!, id:"stop-flip" };
  loser.deckCards = [stop, ...loser.deckCards]; loser.deck = loser.deckCards.length; loser.energy = 10; state = passWindow(state);
  assert.equal(state.phase,"damage"); assert.equal(state.revealedFlip, undefined); state = flipDamageCard(state, loser.id);
  assert.equal(state.revealedFlip?.id,"stop-flip"); const remaining = state.pendingDamage;
  state = resolveManualDamage(state,loser.id,"stop-flip"); assert.equal(state.phase,"postDamage"); assert.equal(state.pendingDamage,remaining); assert.equal(state.batch.some((object) => object.card.id === "stop-flip"), true);
  const afterFlip = state.players.find((player) => player.id === loser.id)!;
  assert.equal(afterFlip.cardsPlayedThisTurn, 1);
  assert.ok(afterFlip.factionsPlayedThisTurn?.includes(stop.faction));
  state = passWindow(state); assert.equal(state.batch.length,0); assert.equal(state.pendingDamage,0);
});

test("a Team Attack combines open Bakugan, then all attackers retract", () => {
  let state = reachPower(); const winner = state.players[0]; winner.bakugan.forEach((bakugan) => { bakugan.open = true; }); const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999;
  state = passWindow(state);
  const loserId = state.players[1].id;
  const loserBeforeDamage = state.players.find((player) => player.id === loserId)!;
  loserBeforeDamage.deckCards = [CARDS.find((card) => card.type !== "Flip")!, ...loserBeforeDamage.deckCards];
  loserBeforeDamage.deck = loserBeforeDamage.deckCards.length;
  for (let guard = 0; state.phase === "victor" && guard < 10; guard += 1) {
    state = state.pendingChoice ? resolveMandatoryVictorDiscard(state) : passWindow(state);
  }
  assert.equal(state.phase, "damage");
  assert.equal(state.teamAttack, true);
  while (state.phase === "damage") {
    state = state.revealedFlip ? resolveManualDamage(state, loserId) : flipDamageCard(state, loserId);
  }
  for (let guard = 0; state.phase === "postDamage" && guard < 10; guard += 1) {
    assert.equal(state.pendingChoice, undefined, "Team Attack fixture reached an unexpected post-damage choice");
    state = passWindow(state);
  }
  assert.equal(state.phase,"endPlay");
  assert.ok(state.players.find((player)=>player.id===winner.id)!.bakugan.every((bakugan) => !bakugan.open));
  assert.deepEqual(state.pendingBrawlRetracts, []);
});

test("a Team Attack consumes its retraction list once after a played Flip", () => {
  let state = reachPower();
  const winnerId = state.players[0].id;
  const winner = state.players.find((player) => player.id === winnerId)!;
  winner.bakugan.forEach((bakugan) => { bakugan.open = true; });
  const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winnerId])!;
  state.rolls[winnerId].result = "open-no-core";
  state.powerBoost[attacking.id] = 9999;
  state = passWindow(state);
  const loserId = state.players.find((player) => player.id !== winnerId)!.id;
  for (let guard = 0; state.phase === "victor" && guard < 10; guard += 1) {
    state = state.pendingChoice ? resolveMandatoryVictorDiscard(state) : passWindow(state);
  }
  assert.equal(state.phase, "damage");
  assert.equal(state.teamAttack, true);
  const printing = CARDS.find((card) => card.type === "Flip"
    && card.cost === 0
    && flipStopsDamage(state, card)
    && ruleDefinitionForCard(card).abilities.every((ability) => ability.instructions.every((instruction) => instruction.choices.length === 0)));
  assert.ok(printing, "the catalogue must contain a legal zero-cost Stop Flip for the Team Attack");
  const flip = { ...printing, id: "team-attack-stop-flip" };
  const loser = state.players.find((player) => player.id === loserId)!;
  loser.deckCards = [flip, ...loser.deckCards];
  loser.deck = loser.deckCards.length;
  state = flipDamageCard(state, loserId);
  assert.equal(state.revealedFlip?.id, flip.id);
  state = resolveManualDamage(state, loserId, flip.id, {});
  assert.equal(state.phase, "postDamage");
  for (let guard = 0; state.phase === "postDamage" && guard < 10; guard += 1) {
    assert.equal(state.pendingChoice, undefined);
    state = passWindow(state);
  }
  assert.equal(state.phase, "endPlay");
  assert.ok(state.players.find((player) => player.id === winnerId)!.bakugan.every((bakugan) => !bakugan.open));
  assert.deepEqual(state.pendingBrawlRetracts, []);
});

test("the End Phase exposes Play, Charge, and Reset before hand limits and the next Start Phase", () => {
  let state = reachPower(); const winner = state.players[0]; const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; attacking.open = true; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999; state = passWindow(state);
  const loser = state.players[1]; loser.deckCards = loser.deckCards.filter((card) => card.type !== "Flip"); loser.deck = loser.deckCards.length; state = settleDamage(passWindow(state));
  if (state.phase === "postDamage") state = passWindow(state); assert.equal(state.phase,"endPlay"); const currentWinner=state.players.find((player)=>player.id===winner.id)!; currentWinner.hand.push(...currentWinner.deckCards.splice(0, Math.max(0, 9-currentWinner.hand.length))); currentWinner.deck=currentWinner.deckCards.length;
  for (const player of state.players) {
    const tracked = player as typeof player & { tappedEnergyIds?: string[]; energyTapTurn?: number };
    tracked.energyTapTurn = state.turn;
    tracked.tappedEnergyIds = player.energyZone.map((card) => card.id);
    player.energy = 0;
  }
  state = passWindow(state);
  assert.equal(state.phase, "charge");
  assert.equal(state.powerBoost[attacking.id], 9999, "Charge must not perform Reset cleanup.");
  assert.ok(state.players.every((player) => player.energy === 0));
  assert.ok(state.players.every((player) => ((player as typeof player & { tappedEnergyIds?: string[] }).tappedEnergyIds ?? []).length === 0));
  state = nextTurn(state);
  assert.equal(state.phase, "reset");
  assert.deepEqual(state.powerBoost, {});
  assert.deepEqual(state.damageBoost, {});
  state = nextTurn(state);
  assert.equal(state.phase,"handLimit"); const actor=state.players.find((player) => player.id===state.priority)!; state=discardToHandLimit(state,actor.id,actor.hand.slice(0,actor.hand.length-7).map((card)=>card.id));
  const nextOver=state.players.find((player)=>state.phase==="handLimit"&&player.id===state.priority); if(nextOver) state=discardToHandLimit(state,nextOver.id,nextOver.hand.slice(0,nextOver.hand.length-7).map((card)=>card.id));
  let triggerWindows = 0;
  while (state.phase === "reset" && (state.pendingChoice || state.triggerOrders.length || state.batch.length) && triggerWindows < 40) {
    if (state.pendingChoice) {
      const fields = state.pendingChoice.schema.fields.filter((field) => field.chooserId === state.priority);
      state = submitCardChoice(state, state.priority, timeoutChoicesForFields(state, state.priority, fields));
    } else {
      const triggerOrder = state.triggerOrders.find((request) => request.controllerId === state.priority && !request.orderedIds);
      state = triggerOrder
        ? orderTriggers(state, state.priority, triggerOrder.id, triggerOrder.triggerIds)
        : passWindow(state);
    }
    triggerWindows += 1;
  }
  assert.ok(triggerWindows < 40, "Discard-trigger and choice resolution must terminate.");
  if (state.phase === "reset") state = nextTurn(state);
  assert.equal(state.phase,"draw"); assert.equal(state.turn,2);
});

test("best-of-three creates a fully reset second game", () => {
  let state = reachPower(); const winner = state.players[0]; const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; attacking.open = true; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999; state = passWindow(state);
  const loser = state.players[1]; loser.discard.push(...loser.deckCards); loser.deckCards = []; loser.deck = 0; state = settleDamage(passWindow(state)); assert.equal(state.phase,"result"); assert.equal(state.series[winner.id],1);
  state = startNextSeriesGame(state); assert.equal(state.gameNumber,2); assert.equal(state.phase,"startingPlayer"); assert.equal(state.placements.length,0); assert.ok(state.players.every((player)=>player.deckCards.length===35&&player.hand.length===5));
});
