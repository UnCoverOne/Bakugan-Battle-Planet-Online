import test from "node:test";
import assert from "node:assert/strict";
import { BAKUGAN, CARDS, CORES, STARTER_DECKS, deckErrors, makePlayer } from "../lib/data";
import {
  CENTER_CELL, HEX_CELLS, beginCorePlacement, cardChoiceSpec, createMatch, discardToHandLimit, energizeCard,
  legalPlacementCells, normalizeMatchState, passPriority, placeCore, playCard, selectBakugan,
  setReady, startNextSeriesGame, targetCore, totalPower, type MatchState,
} from "../lib/game";
import { drawTurnCard } from "../lib/turnStart";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";

const passWindow = (state: MatchState) => {
  state = passPriority(state, state.priority); return passPriority(state, state.priority);
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
  assert.equal(CARDS.length, 374); assert.equal(BAKUGAN.length, 93); assert.equal(CORES.length, 52);
  assert.deepEqual(Object.fromEntries(["Action","Flip","Hero","Evo","Character"].map((type) => [type, CARDS.filter((card) => card.type === type).length])), { Action:137, Flip:49, Hero:29, Evo:66, Character:93 });
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

  const legacy = createMatch("LEGACY", "bo1", [player, opponent]);
  legacy.players[0].cores = copies.map((core) => ({ ...core, id: core.catalogId!, catalogId: undefined }));
  const upgraded = normalizeMatchState(legacy);
  assert.equal(new Set(upgraded.players[0].cores.map((core) => core.id)).size, 2);
});

test("the full turn enters Draw/Energize, Selection, pre-roll priority, target and Power", () => {
  let state = buildPlacedMatch(); assert.equal(state.players[0].hand.length, 5); assert.equal(state.phase, "draw");
  state = completeTurnDraws(state); assert.equal(state.players[0].hand.length, 6); assert.equal(state.phase, "energize");
  state = energizeCard(state, "a", state.players[0].hand[0].id); state = energizeCard(state, "b"); assert.equal(state.phase, "selection");
  assert.equal(state.players[0].maxEnergy, 1); assert.equal(state.players[1].maxEnergy, 0);
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

test("Hero, Evo, Action, Flip and X-cost cards expose typed announcement and payment paths", () => {
  const state = reachPower(); const player = state.players[0];
  const evo = CARDS.find((card) => card.type === "Evo" && card.evolvesFrom === player.bakugan[0].name && card.faction === player.bakugan[0].faction);
  const xCard = CARDS.find((card) => card.cost === "X")!; const sacrifice = CARDS.find((card) => card.effect.toLowerCase().includes("sacrifice"))!;
  assert.ok(evo); assert.ok(cardChoiceSpec(state, player.id, evo!).includes("targetBakugan")); assert.ok(cardChoiceSpec(state, player.id, xCard).includes("xValue"));
  assert.equal(cardChoiceSpec(state, player.id, sacrifice).includes("discard"), false, "Sacrifice choices are made during resolution, not announcement.");
  assert.equal(CARDS.filter((card) => card.type === "Flip").length, 49); assert.equal(CARDS.filter((card) => card.type === "Hero").length, 29);
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
  state = passWindow(state); assert.equal(state.batch.length,0); assert.equal(state.pendingDamage,0);
});

test("a Team Attack combines open Bakugan, then all attackers retract", () => {
  let state = reachPower(); const winner = state.players[0]; winner.bakugan.forEach((bakugan) => { bakugan.open = true; }); const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999;
  state = passWindow(state); const loser = state.players[1]; loser.deckCards = [CARDS.find((card) => card.type !== "Flip")!, ...loser.deckCards]; loser.deck = loser.deckCards.length; state = passWindow(state); assert.equal(state.teamAttack,true);
  while (state.phase === "damage") {
    state = state.revealedFlip ? resolveManualDamage(state, loser.id) : flipDamageCard(state, loser.id);
  }
  if (state.phase === "postDamage") state = passWindow(state);
  assert.equal(state.phase,"endPlay"); assert.ok(state.players.find((player)=>player.id===winner.id)!.bakugan.every((bakugan) => !bakugan.open));
});

test("the End Phase charges Energy, enforces seven cards, and begins the next Start Phase", () => {
  let state = reachPower(); const winner = state.players[0]; const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; attacking.open = true; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999; state = passWindow(state);
  const loser = state.players[1]; loser.deckCards = loser.deckCards.filter((card) => card.type !== "Flip"); loser.deck = loser.deckCards.length; state = settleDamage(passWindow(state));
  if (state.phase === "postDamage") state = passWindow(state); assert.equal(state.phase,"endPlay"); const currentWinner=state.players.find((player)=>player.id===winner.id)!; currentWinner.hand.push(...currentWinner.deckCards.splice(0, Math.max(0, 9-currentWinner.hand.length))); currentWinner.deck=currentWinner.deckCards.length;
  state = passWindow(state); assert.equal(state.phase,"handLimit"); const actor=state.players.find((player) => player.id===state.priority)!; state=discardToHandLimit(state,actor.id,actor.hand.slice(0,actor.hand.length-7).map((card)=>card.id));
  const nextOver=state.players.find((player)=>state.phase==="handLimit"&&player.id===state.priority); if(nextOver) state=discardToHandLimit(state,nextOver.id,nextOver.hand.slice(0,nextOver.hand.length-7).map((card)=>card.id));
  assert.equal(state.phase,"draw"); assert.equal(state.turn,2); assert.ok(state.players.every((player)=>player.energy===player.maxEnergy));
});

test("best-of-three creates a fully reset second game", () => {
  let state = reachPower(); const winner = state.players[0]; const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; attacking.open = true; state.rolls[winner.id].result = "open-no-core"; state.powerBoost[attacking.id] = 9999; state = passWindow(state);
  const loser = state.players[1]; loser.discard.push(...loser.deckCards); loser.deckCards = []; loser.deck = 0; state = settleDamage(passWindow(state)); assert.equal(state.phase,"result"); assert.equal(state.series[winner.id],1);
  state = startNextSeriesGame(state); assert.equal(state.gameNumber,2); assert.equal(state.phase,"startingPlayer"); assert.equal(state.placements.length,0); assert.ok(state.players.every((player)=>player.deckCards.length===35&&player.hand.length===5));
});
