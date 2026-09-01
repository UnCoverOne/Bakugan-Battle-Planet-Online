import assert from "node:assert/strict";
import test from "node:test";
import { activePendingDraw, drawPendingCard } from "../lib/drawQueue";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, playCard, resolveStructuredEffect } from "../lib/game";
import { createRuleObject } from "../lib/rules/objects";
import { cardCostBreakdown, cardPaymentModes } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import type { GameCard, MatchState } from "../lib/game";

function card(catalogId: string, id: string): GameCard {
  const template = CARD_BY_ID.get(catalogId);
  assert.ok(template, `Missing ${catalogId}`);
  return { ...structuredClone(template), id };
}

function baseMatch(code: string) {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch(code, "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.priority = first.id;
  state.startingPlayer = first.id;
  return { state, first: state.players[0], second: state.players[1] };
}

function resolveCardBatch(state: ReturnType<typeof createMatch>) {
  let next = passPriority(state, "first");
  next = passPriority(next, "second");
  return next;
}

function advanceEndPlay(state: MatchState): MatchState {
  let next: MatchState = { ...state, phase: "endPlay", priority: "first", stepLabel: "End Phase • Play Step" };
  next = passPriority(next, "first");
  return passPriority(next, "second");
}

test("InstaBrawl exposes its alternate cost and applies ordinary Hero reductions", () => {
  const { state, first } = baseMatch("INSTA_COST");
  const hero = card("ps1-17", "insta-shun");
  first.hand = [hero];
  first.heroes = [card("br-80", "strata")];

  const modes = cardPaymentModes(state, first.id, hero);
  const normal = modes.find((mode) => mode.id === "normal");
  const instabrawl = modes.find((mode) => mode.instabrawl);
  assert.ok(normal && instabrawl);
  assert.equal(normal.energyCost, 2);
  assert.equal(instabrawl.id, "instabrawl:1");
  assert.equal(instabrawl.energyCost, 0);

  const breakdown = cardCostBreakdown(
    state,
    first.id,
    hero,
    { paymentMode: instabrawl.id },
    { instabrawlBaseCost: 1 },
  );
  assert.equal(breakdown.total, 0);
});

test("InstaBrawl marks the resolved Hero and destroys it at end of turn", () => {
  const { state, first } = baseMatch("INSTA_LIFETIME");
  const hero = card("ps1-21", "insta-wynton");
  first.hand = [hero];
  first.energy = 1;

  let next = playCard(state, first.id, hero.id, { paymentMode: "instabrawl:1" });
  next = resolveCardBatch(next);
  const liveHero = next.players[0].heroes.find((candidate) => candidate.id === hero.id);
  assert.equal(liveHero?.instabrawl, true);

  next = advanceEndPlay(next);
  assert.equal(next.players[0].heroes.some((candidate) => candidate.id === hero.id), false);
  assert.equal(next.players[0].discard.some((candidate) => candidate.id === hero.id), true);
  assert.equal(next.log.some((entry) => entry.message.includes("destroyed by InstaBrawl")), true);
});

test("Honey Trap prevents InstaBrawl destruction and consumes the temporary status", () => {
  const { state, first } = baseMatch("INSTA_HONEY");
  const hero = card("ps1-21", "protected-wynton");
  first.heroes = [{ ...hero, instabrawl: true }];
  first.deckCards = [card("bb-1", "honey-draw")];

  const honey = card("av-21", "honey-trap");
  const ability = ruleDefinitionForCard(honey).abilities[0];
  assert.ok(ability);
  let next = resolveStructuredEffect(state, createRuleObject({
    controllerId: first.id,
    card: honey,
    ability,
    kind: "card",
  }));
  while (activePendingDraw(next)) next = drawPendingCard(next, first.id);

  next = advanceEndPlay(next);
  const protectedHero = next.players[0].heroes.find((candidate) => candidate.id === hero.id);
  assert.ok(protectedHero);
  assert.equal(protectedHero.instabrawl, undefined);
  assert.equal(next.players[0].discard.some((candidate) => candidate.id === hero.id), false);
});
