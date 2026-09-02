import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, redactForPlayer, resolveStructuredEffect, submitCardChoice } from "../lib/game";
import { createRuleObject } from "../lib/rules/objects";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string, id: string) {
  const template = CARD_BY_ID.get(catalogId);
  assert.ok(template, `Missing ${catalogId}`);
  return { ...structuredClone(template), id };
}

function darkushadowMatch() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("DARKUSHADOW", "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.priority = first.id;
  state.startingPlayer = first.id;
  return { state, first, second, darkushadow: card("ff-14", "darkushadow") };
}

function resolveDarkushadow(state: ReturnType<typeof createMatch>, darkushadow: ReturnType<typeof card>) {
  const ability = ruleDefinitionForCard(darkushadow).abilities.find((candidate) => candidate.kind === "spell");
  assert.ok(ability);
  return resolveStructuredEffect(state, createRuleObject({
    controllerId: "first",
    card: darkushadow,
    ability,
    kind: "card",
  }));
}

test("Darkushadow presents five faction choices only to its controller", () => {
  const { state, darkushadow } = darkushadowMatch();
  const next = resolveDarkushadow(state, darkushadow);
  const faction = next.pendingChoice?.schema.fields.find((field) => field.id === "mode");

  assert.ok(faction);
  assert.equal(faction.chooserId, "first");
  assert.equal(faction.minimum, 1);
  assert.equal(faction.maximum, 1);
  assert.deepEqual(faction.options.map((option) => option.id), ["Aquos", "Darkus", "Haos", "Pyrus", "Ventus"]);
  assert.equal(redactForPlayer(next, "second").pendingChoice?.schema.fields.some((field) => field.chooserId === "second"), false);
});

test("Darkushadow reveals the opponent hand, then discards the selected faction", () => {
  const { state, darkushadow, second } = darkushadowMatch();
  const aquos = card("br-1", "aquos-in-hand");
  const darkus = card("br-14", "darkus-in-hand");
  const allFactions = card("br-104", "all-factions-in-hand");
  const haos = card("br-25", "haos-in-hand");
  second.hand = [aquos, darkus, allFactions, haos];

  let next = resolveDarkushadow(state, darkushadow);
  next = submitCardChoice(next, "first", { mode: "Darkus" });
  const viewer = next.pendingChoice?.schema.fields.find((field) => field.viewerOnly);
  assert.deepEqual(new Set(viewer?.options.map((option) => option.id)), new Set(second.hand.map((card) => card.id)));
  assert.equal(redactForPlayer(next, "second").pendingChoice?.schema.fields.find((field) => field.viewerOnly)?.options.length, 0);

  next = submitCardChoice(next, "first", {});
  assert.deepEqual(next.players.find((player) => player.id === "second")?.hand.map((card) => card.id), [aquos.id, haos.id]);
  assert.deepEqual(next.players.find((player) => player.id === "second")?.discard.map((card) => card.id), [darkus.id, allFactions.id]);
  assert.equal(next.pendingChoice, undefined);
});
