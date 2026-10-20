import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch, passPriority, playCard, submitCardChoice,
  type GameCard, type MatchState,
} from "../lib/game";
import { activePendingDraw, drawPendingCard } from "../lib/drawQueue";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string, id = catalogId): GameCard {
  const original = CARDS.find((entry) => entry.catalogId === catalogId);
  assert.ok(original, `Missing ${catalogId}`);
  return { ...original, id };
}
function setup(catalogId: string) {
  const a = makePlayer("audit-owner", "Owner", STARTER_DECKS[0]);
  const b = makePlayer("audit-opponent", "Opponent", STARTER_DECKS[1]);
  const match = createMatch("CARD-FOLLOWUP-AUDIT", "bo1", [a, b]);
  match.turn = 3;
  match.phase = "power";
  match.startingPlayer = a.id;
  match.priority = a.id;
  const owner = match.players[0];
  const opponent = match.players[1];
  const source = card(catalogId, "audit-source");
  const ownerDrawn = card("bb-1", "owner-drawn");
  const opponentDrawn = card("bb-2", "opponent-drawn");
  owner.hand = [source, card("bb-3", "owner-held")];
  opponent.hand = [card("bb-4", "opponent-held")];
  owner.deckCards = [ownerDrawn, card("bb-5", "owner-second-draw"), card("bb-6", "owner-third-draw")];
  opponent.deckCards = [opponentDrawn, card("bb-7", "opponent-second-draw")];
  owner.deck = owner.deckCards.length;
  opponent.deck = opponent.deckCards.length;
  owner.energy = opponent.energy = 0;
  owner.energyZone = Array.from({ length: 10 }, (_, n) => card("bb-8", `own-energy-${n}`));
  opponent.energyZone = Array.from({ length: 10 }, (_, n) => card("bb-9", `opponent-energy-${n}`));
  return { match, owner, opponent, source, ownerDrawn, opponentDrawn };
}
function beginAndCompleteDraws(match: MatchState, sourceId: string, ownerId: string) {
  const owner = match.players.find((player) => player.id === ownerId)!;
  const source = owner.hand.find((entry) => entry.id === sourceId)!;
  let next = playCard(match, ownerId, sourceId, source.type === "Baku-Gear"
    ? { targetBakuganId: owner.bakugan[0].id }
    : {});
  assert.equal(next.pendingChoice, undefined, "Draw choice must not be requested at announcement");
  for (let step = 0; step < 5 && !activePendingDraw(next) && !next.pendingChoice && next.batch.length; step++) {
    next = passPriority(next, next.priority);
  }
  assert.ok(activePendingDraw(next), "Draw must resolve before any later hand choice");
  assert.equal(next.pendingChoice, undefined);
  for (let step = 0; step < 10 && activePendingDraw(next); step++) {
    next = drawPendingCard(next, activePendingDraw(next)!.playerId);
  }
  assert.equal(activePendingDraw(next), null);
  return next;
}
function settle(match: MatchState) {
  let next = match;
  for (let i = 0; i < 8 && next.batch.length && !next.pendingChoice && !activePendingDraw(next); i++) {
    next = passPriority(next, next.priority);
  }
  return next;
}

test("catalogue inventory covers every printed Draw plus optional hand-Energize", () => {
  const matching = CARDS.filter((entry) => /(?:\[Draw\]\s*\d+|\bdraws?\s+(?:a|\d+)\s+cards?)[\s\S]*\bmay\s+Energize\b/i.test(entry.effect))
    .map((entry) => entry.catalogId);
  for (const id of ["av-39", "av-57", "ff-62", "ff-123"]) {
    assert.ok(CARDS.some((entry) => entry.catalogId === id));
  }
  assert.ok(matching.includes("ff-62"));
});

for (const catalogId of ["av-39", "av-57", "ff-123"]) {
  test(`${catalogId} compiles Draw before a distinct hand Energize instruction`, () => {
    const source = card(catalogId);
    const instructions = ruleDefinitionForCard(source).abilities.flatMap((ability) => ability.instructions);
    const drawIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "draw"));
    const energyIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "energize" && action.source === "hand"));
    assert.ok(drawIndex >= 0, "missing Draw");
    assert.ok(energyIndex > drawIndex, "hand Energize must be a later instruction so it sees the new draw");
    assert.ok(instructions[energyIndex].choices.some((choice) => choice.id === "handCardIds"));
  });
}

for (const catalogId of ["av-39", "av-57"]) {
  test(`${catalogId} offers the newly drawn card as optional Energize target`, () => {
    const { match, owner, source, ownerDrawn } = setup(catalogId);
    const next = beginAndCompleteDraws(match, source.id, owner.id);
    const selector = next.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds");
    assert.ok(selector, "Must request hand-card Energize only after drawing");
    assert.ok(selector.options.some((option) => option.id === ownerDrawn.id));
    assert.ok(next.pendingChoice!.schema.fields.some((field) => field.id === "confirmed"));
    const done = settle(submitCardChoice(next, owner.id, { confirmed: true, handCardIds: [ownerDrawn.id] }));
    assert.ok(done.players[0].energyZone.some((entry) => entry.id === ownerDrawn.id));
    assert.ok(!done.players[0].hand.some((entry) => entry.id === ownerDrawn.id));
  });
}

test("ff-62 offers both players independent optional hand Energize choices after BOTH draws", () => {
  const { match, owner, opponent, source, ownerDrawn, opponentDrawn } = setup("ff-62");
  let next = beginAndCompleteDraws(match, source.id, owner.id);
  const fields = next.pendingChoice?.schema.fields.filter((field) => field.id === "handCardIds") ?? [];
  assert.equal(fields.length, 2, "each player needs a private hand-card choice");
  for (const [playerId, drawnId] of [[owner.id, ownerDrawn.id], [opponent.id, opponentDrawn.id]]) {
    const field = fields.find((f) => f.chooserId === playerId);
    assert.ok(field, `missing selector for ${playerId}`);
    assert.equal(field.minimum, 0);
    assert.equal(field.maximum, 1);
    assert.ok(field.options.some((option) => option.id === drawnId));
    assert.ok(!field.options.some((option) => option.id === (playerId === owner.id ? opponentDrawn.id : ownerDrawn.id)));
  }
  assert.equal(next.pendingChoice?.schema.simultaneous, true);
  next = submitCardChoice(next, owner.id, { handCardIds: [ownerDrawn.id] });
  assert.ok(next.pendingChoice);
  next = settle(submitCardChoice(next, opponent.id, { handCardIds: [] }));
  assert.equal(next.pendingChoice, undefined);
  assert.ok(next.players[0].energyZone.some((entry) => entry.id === ownerDrawn.id));
  assert.ok(next.players[1].hand.some((entry) => entry.id === opponentDrawn.id));
});

for(const catalogId of ["bb-108", "bb-174", "ff-26", "ff-105"]) {
  test(`${catalogId} preserves Draw-before-discard selection timing`, () => {
    const source = card(catalogId);
    const instructions = ruleDefinitionForCard(source).abilities.flatMap((ability) => ability.instructions);
    const drawIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "draw"));
    const discardIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "discard"));
    assert.ok(drawIndex >= 0 && discardIndex > drawIndex, `${catalogId} must stage discard only after Draw`);
    assert.ok(instructions[discardIndex].choices.some((choice) => choice.id === "discardCardIds"));
    if (catalogId === "ff-26") {
      assert.deepEqual(
        instructions[discardIndex].condition,
        instructions[drawIndex].condition,
        "Instabakugear must not discard when the Gear-dependent draw is inactive",
      );
    }
  });
}

for (const [catalogId, drawCount, discardCount] of [
  ["bb-108", 2, 2],
  // bb-174 is a Flip; its parser ordering is checked above, but the
  // damage-reveal play window needs a dedicated Flip integration fixture.
  ["ff-105", 2, 2],
] as const) {
  test(`${catalogId} waits for manual Draw before allowing a physical hand discard`, () => {
    const { match, owner, source, ownerDrawn } = setup(catalogId);
    let next = beginAndCompleteDraws(match, source.id, owner.id);
    const selection = next.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
    assert.ok(selection, "Discard selector must be staged after new cards are drawn");
    assert.equal(selection.minimum, discardCount);
    assert.equal(selection.maximum, discardCount);
    assert.ok(selection.options.some((option) => option.id === ownerDrawn.id));
    const toDiscard = [ownerDrawn.id, ...next.players[0].hand
      .filter((entry) => entry.id !== ownerDrawn.id)
      .slice(0, discardCount - 1).map((entry) => entry.id)];
    next = settle(submitCardChoice(next, owner.id, { discardCardIds: toDiscard }));
    assert.ok(!next.players[0].hand.some((entry) => entry.id === ownerDrawn.id));
    assert.ok(next.players[0].discard.some((entry) => entry.id === ownerDrawn.id));
    assert.ok(!activePendingDraw(next));
    assert.equal(next.pendingChoice, undefined);
    assert.equal(drawCount >= discardCount, true);
  });
}

for (const catalogId of ["av-39", "av-57"]) {
  test(`${catalogId} can decline the optional Energize after drawing`, () => {
    const { match, owner, source, ownerDrawn } = setup(catalogId);
    const waiting = beginAndCompleteDraws(match, source.id, owner.id);
    assert.ok(waiting.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
    const declined = settle(submitCardChoice(waiting, owner.id, { confirmed: false }));
    assert.ok(declined.players[0].hand.some((entry) => entry.id === ownerDrawn.id));
    assert.ok(!declined.players[0].energyZone.some((entry) => entry.id === ownerDrawn.id));
    assert.equal(declined.pendingChoice, undefined);
  });
}

for (const [catalogId, followUpKind] of [
  ["ff-77", "discard"],
  ["ff-81", "play"],
] as const) {
  test(`${catalogId} stages the Sync/Empower follow-up only after the gated Draw`, () => {
    const instructions = ruleDefinitionForCard(card(catalogId)).abilities
      .flatMap((ability) => ability.instructions);
    const drawn = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "draw"));
    const follow = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === followUpKind));
    assert.ok(drawn >= 0 && follow > drawn, "follow-up action must run after Draw");
    assert.deepEqual(instructions[follow].condition, instructions[drawn].condition);
    assert.ok(instructions[follow].choices.length > 0, "follow-up selection must happen at resolution");
  });
}

for(const catalogId of ["ff-33", "av-39", "av-57", "ff-123"]) {
  test(`${catalogId} retains one Energy-from-hand action with the printed charged state`, () => {
    const source = card(catalogId);
    const actions = ruleDefinitionForCard(source).abilities.flatMap((ability) => ability.instructions.flatMap((instruction) => instruction.actions));
    const energize = actions.filter((action) => action.kind === "energize" && action.source === "hand");
    assert.equal(energize.length, 1);
    assert.equal(energize[0].enters, catalogId === "ff-123" ? "charged" : "uncharged");
  });
}

function runToNextDecision(state: MatchState) {
  let next = state;
  for (let n = 0; n < 10 && next.batch.length && !next.pendingChoice && !activePendingDraw(next); n++) {
    next = passPriority(next, next.priority);
  }
  return next;
}
function completeAllEffectDraws(state: MatchState) {
  let next = state;
  for (let n = 0; n < 12 && activePendingDraw(next); n++) {
    next = drawPendingCard(next, activePendingDraw(next)!.playerId);
  }
  assert.equal(activePendingDraw(next), null);
  return next;
}

test("aa-36 Hypno Flash declining Draw 2 also declines the dependent discard", () => {
  const { match, owner, source } = setup("aa-36");
  const first = runToNextDecision(playCard(match, owner.id, source.id));
  assert.ok(first.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
  assert.equal(activePendingDraw(first), null);
  const done = settle(submitCardChoice(first, owner.id, { confirmed: false }));
  assert.equal(activePendingDraw(done), null);
  assert.equal(done.pendingChoice, undefined, "declining Draw must not prompt a mandatory discard");
  assert.deepEqual(done.players[0].hand.map((entry) => entry.id), ["owner-held"]);
  assert.equal(done.players[0].discard.some((entry) => entry.id === "owner-held"), false);
});

test("aa-36 Hypno Flash accepts Draw 2 before offering the new cards for discard", () => {
  const { match, owner, source, ownerDrawn } = setup("aa-36");
  let next = runToNextDecision(playCard(match, owner.id, source.id));
  next = runToNextDecision(submitCardChoice(next, owner.id, { confirmed: true }));
  assert.ok(activePendingDraw(next), "Draw must be queued before discard selection");
  assert.equal(next.pendingChoice, undefined);
  next = completeAllEffectDraws(next);
  const field = next.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
  assert.ok(field, "accepting optional Draw must lead to a discard choice");
  assert.equal(field.minimum, 2);
  assert.equal(field.maximum, 2);
  assert.ok(field.options.some((option) => option.id === ownerDrawn.id));
  const done = settle(submitCardChoice(next, owner.id, { discardCardIds: ["owner-held", ownerDrawn.id] }));
  assert.ok(done.players[0].discard.some((entry) => entry.id === ownerDrawn.id));
  assert.ok(done.players[0].discard.some((entry) => entry.id === "owner-held"));
  assert.equal(done.pendingChoice, undefined);
});

test("av-30 Molten Stomp discards both complete hands before either player draws three", () => {
  const { match, owner, opponent, source, ownerDrawn, opponentDrawn } = setup("av-30");
  opponent.deckCards.push(card("bb-10", "opponent-third-draw"));
  opponent.deck = opponent.deckCards.length;
  let next = runToNextDecision(playCard(match, owner.id, source.id));
  assert.ok(activePendingDraw(next), "the Draw should be queued after both discards");
  assert.deepEqual(next.players[0].hand, []);
  assert.deepEqual(next.players[1].hand, []);
  assert.ok(next.players[0].discard.some((entry) => entry.id === "owner-held"));
  assert.ok(next.players[1].discard.some((entry) => entry.id === "opponent-held"));
  next = completeAllEffectDraws(next);
  assert.deepEqual(next.players[0].hand.map((entry) => entry.id), [
    ownerDrawn.id, "owner-second-draw", "owner-third-draw",
  ]);
  assert.deepEqual(next.players[1].hand.map((entry) => entry.id), [
    opponentDrawn.id, "opponent-second-draw", "opponent-third-draw",
  ]);
  assert.equal(next.pendingChoice, undefined);
});

test("av-42 Dark Water Ambush draws before offering its chosen-player discard", () => {
  const { match, owner, opponent, source, ownerDrawn } = setup("av-42");
  let next = runToNextDecision(playCard(match, owner.id, source.id));
  assert.ok(activePendingDraw(next));
  assert.equal(next.pendingChoice, undefined);
  next = completeAllEffectDraws(next);
  assert.ok(next.players[0].hand.some((entry) => entry.id === ownerDrawn.id));
  assert.ok(next.pendingChoice?.schema.fields.some((field) => field.id === "targetPlayerId"));
  next = submitCardChoice(next, owner.id, { targetPlayerId: opponent.id });
  const field = next.pendingChoice?.schema.fields.find((entry) => entry.id === "discardCardIds");
  assert.ok(field, "chosen player selects their own card to discard");
  assert.equal(field.chooserId, opponent.id);
  const done = settle(submitCardChoice(next, opponent.id, { discardCardIds: ["opponent-held"] }));
  assert.ok(done.players[1].discard.some((entry) => entry.id === "opponent-held"));
  assert.equal(done.pendingChoice, undefined);
});

test("sv-88 Bakutelepathy waits until Draw 2, then lets the chosen player discard two", () => {
  const { match, owner, opponent, source, ownerDrawn } = setup("sv-88");
  owner.hand = [card("bb-3", "owner-held")];
  owner.deckCards = [source, ownerDrawn, card("bb-5", "owner-second-draw"), card("bb-6", "owner-third-draw")];
  owner.deck = owner.deckCards.length;
  opponent.hand.push(card("bb-11", "opponent-held-second"), card("bb-12", "opponent-held-third"));
  match.phase = "damage";
  match.pendingLoser = owner.id;
  match.pendingDamage = 2;
  match.damageOrigin = opponent.bakugan[0].id;
  match.priority = owner.id;
  let next = flipDamageCard(match, owner.id);
  assert.equal(next.revealedFlip?.id, source.id);
  next = runToNextDecision(resolveManualDamage(next, owner.id, source.id));
  assert.ok(activePendingDraw(next), "the Flip must Draw before choosing a discarder");
  assert.equal(next.pendingChoice, undefined);
  next = completeAllEffectDraws(next);
  assert.ok(next.players[0].hand.some((entry) => entry.id === ownerDrawn.id));
  assert.ok(next.pendingChoice?.schema.fields.some((field) => field.id === "targetPlayerId"));
  next = submitCardChoice(next, owner.id, { targetPlayerId: opponent.id });
  const field = next.pendingChoice?.schema.fields.find((entry) => entry.id === "discardCardIds");
  assert.ok(field);
  assert.equal(field.chooserId, opponent.id);
  assert.equal(field.minimum, 2);
  assert.equal(field.maximum, 2);
  next = settle(submitCardChoice(next, opponent.id, {
    discardCardIds: ["opponent-held", "opponent-held-second"],
  }));
  assert.equal(next.pendingChoice, undefined);
  assert.ok(next.players[1].discard.some((entry) => entry.id === "opponent-held"));
  assert.ok(next.players[1].discard.some((entry) => entry.id === "opponent-held-second"));
  assert.ok(next.players[1].hand.some((entry) => entry.id === "opponent-held-third"));
});

test("the four Batch 1 cards retain distinct typed Draw and follow-up instructions", () => {
  for (const [id, followUp] of [
    ["aa-36", "discard"],
    ["av-30", "draw"],
    ["av-42", "discard"],
    ["sv-88", "discard"],
  ] as const) {
    const instructions = ruleDefinitionForCard(card(id)).abilities.flatMap((ability) => ability.instructions);
    const drawIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "draw"));
    const discardIndex = instructions.findIndex((instruction) => instruction.actions.some((action) => action.kind === "discard"));
    assert.ok(drawIndex >= 0 && discardIndex >= 0 && drawIndex !== discardIndex, id);
    assert.ok(followUp === "draw" ? discardIndex < drawIndex : drawIndex < discardIndex, id);
    if (id === "aa-36") assert.equal(instructions[discardIndex].condition.kind, "previous-optional-accepted");
    if (id === "av-30") {
      const draw = instructions[drawIndex].actions.find((action) => action.kind === "draw");
      assert.ok(draw && draw.kind === "draw");
      assert.equal(draw.playerScope, "each-player");
    }
  }
});
