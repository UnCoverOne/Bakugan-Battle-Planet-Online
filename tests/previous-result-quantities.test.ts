import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, resolveStructuredEffect } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string) {
  const value = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(value, `Missing ${catalogId} from catalogue fixtures.`);
  return value;
}

function instance(catalogId: string, id: string) {
  return { ...card(catalogId), id };
}

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("PREVIOUS-RESULT", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected = { [first.id]: first.bakugan[0].id, [second.id]: second.bakugan[0].id };
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return state;
}

function queuedDraws(state: ReturnType<typeof createMatch>) {
  return (state as typeof state & {
    pendingDrawQueue?: Array<{ playerId: string; total: number }>;
  }).pendingDrawQueue ?? [];
}

test("previous-result grammar compiles for that-many and this-way printings", () => {
  const inferno = ruleDefinitionForCard(card("aa-33"));
  const infernoInstruction = inferno.abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => /that many/i.test(instruction.sourceText));
  const infernoDraw = infernoInstruction?.effects.find((effect) => effect.kind === "draw");
  assert.ok(infernoDraw && infernoDraw.kind === "draw");
  assert.deepEqual(infernoDraw.amount, { kind: "previous-result", property: "amount", scope: "chooser" });
  assert.equal(infernoDraw.playerScope, "all-players");

  const touch = ruleDefinitionForCard(card("aa-58"));
  const touchDraw = touch.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((effect) => effect.kind === "draw" && /previous-result/.test(JSON.stringify(effect)));
  assert.ok(touchDraw && touchDraw.kind === "draw");
  assert.deepEqual(touchDraw.amount, {
    kind: "product",
    factors: [1, { kind: "previous-result", property: "amount", scope: "total" }],
  });

  const cyndeus = ruleDefinitionForCard(card("bb-86"));
  const cyndeusDamage = cyndeus.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((effect) => effect.kind === "modify-stat" && effect.stat === "damage" && /previous-result/.test(JSON.stringify(effect.amount)));
  assert.ok(cyndeusDamage && cyndeusDamage.kind === "modify-stat");
  assert.deepEqual(cyndeusDamage.amount, {
    kind: "product",
    factors: [1, { kind: "previous-result", property: "amount", scope: "total" }],
  });
});

test("Inferno Cannon draws each player exactly the number that player actually discarded", () => {
  const state = match();
  const first = state.players[0];
  const second = state.players[1];
  first.hand = [instance("bb-1", "first-a"), instance("bb-2", "first-b")];
  second.hand = [instance("bb-3", "second-a"), instance("bb-4", "second-b"), instance("bb-5", "second-c")];
  const inferno = { ...card("aa-33"), id: "inferno-cannon-instance" };
  const resolved = resolveStructuredEffect(state, {
    id: "inferno-cannon-effect",
    controllerId: first.id,
    cardOwnerId: first.id,
    card: inferno,
    choices: {},
    kind: "card",
  });
  assert.equal(resolved.players[0].hand.length, 0);
  assert.equal(resolved.players[1].hand.length, 0);
  assert.deepEqual(queuedDraws(resolved).map(({ playerId, total }) => ({ playerId, total })), [
    { playerId: first.id, total: 2 },
    { playerId: second.id, total: 3 },
  ]);
});

test("Touch of Darkness counts all Heroes actually destroyed this way", () => {
  const state = match();
  const first = state.players[0];
  const second = state.players[1];
  const heroes = CARDS.filter((candidate) => candidate.type === "Hero").slice(0, 3);
  assert.equal(heroes.length, 3);
  first.heroes = [{ ...heroes[0], id: "hero-one" }];
  second.heroes = [{ ...heroes[1], id: "hero-two" }, { ...heroes[2], id: "hero-three" }];
  const touch = { ...card("aa-58"), id: "touch-of-darkness-instance" };
  const resolved = resolveStructuredEffect(state, {
    id: "touch-of-darkness-effect",
    controllerId: first.id,
    cardOwnerId: first.id,
    card: touch,
    choices: { confirmed: true },
    kind: "card",
  });
  assert.equal(resolved.players[0].heroes.length, 0);
  assert.equal(resolved.players[1].heroes.length, 0);
  assert.equal(queuedDraws(resolved)[0]?.playerId, first.id);
  assert.equal(queuedDraws(resolved)[0]?.total, 3);
});

test("Cyndeus Stand uses the actual number of hand cards shuffled", () => {
  const state = match();
  const first = state.players[0];
  first.hand = [instance("bb-1", "shuffle-a"), instance("bb-2", "shuffle-b"), instance("bb-3", "keep-c")];
  const active = first.bakugan[0];
  const cyndeus = { ...card("bb-86"), id: "cyndeus-stand-instance" };
  const resolved = resolveStructuredEffect(state, {
    id: "cyndeus-stand-effect",
    controllerId: first.id,
    cardOwnerId: first.id,
    card: cyndeus,
    choices: {
      handCardIds: ["shuffle-a", "shuffle-b"],
      targetBakuganId: active.id,
    },
    kind: "card",
  });
  assert.deepEqual(resolved.players[0].hand.map((candidate) => candidate.id), ["keep-c"]);
  assert.ok(resolved.players[0].deckCards.some((candidate) => candidate.id === "shuffle-a"));
  assert.ok(resolved.players[0].deckCards.some((candidate) => candidate.id === "shuffle-b"));
  assert.equal(resolved.damageBoost[active.id], 2);
});
