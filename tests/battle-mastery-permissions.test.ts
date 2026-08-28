import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type CardChoices, type GameCard } from "../lib/game";
import { buildChoiceSchemaFromSpecs, mergeChoiceAnswers } from "../lib/rules/choices";
import type { ChoiceSpec } from "../lib/rules/model";
import { activeRulePermissions } from "../lib/rules/permissions";
import { collectRuleTriggers } from "../lib/rules/triggers";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function matchWithPlayers() {
  const controller = makePlayer("permission-controller", "Controller", STARTER_DECKS[0]);
  const opponent = makePlayer("permission-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("RULE-PERMISSIONS", "bo1", [controller, opponent]);
  const liveController = state.players.find((player) => player.id === controller.id)!;
  const liveOpponent = state.players.find((player) => player.id === opponent.id)!;
  state.startingPlayer = liveController.id;
  state.initialStartingPlayer = liveController.id;
  state.priority = liveController.id;
  state.selected[liveController.id] = liveController.bakugan[0].id;
  state.selected[liveOpponent.id] = liveOpponent.bakugan[0].id;
  liveController.bakugan[0].open = true;
  liveOpponent.bakugan[0].open = true;
  return { state, controller: liveController, opponent: liveOpponent };
}

const battleMasteryModeSpec: ChoiceSpec = {
  id: "mode",
  selector: "mode",
  label: "Choose one of the following",
  timing: "resolve",
  minimum: 1,
  maximum: 1,
  options: [
    { id: "battle-mastery-1", label: "A Bakugan gets +600 B" },
    { id: "battle-mastery-2", label: "Recharge 6 Energy cards" },
  ],
};

test("Magnus grants Battle Mastery selection permission while active without adding a third option", () => {
  const { state, controller } = matchWithPlayers();
  const gorthion = card("aa-99", "gorthion-choice");

  let schema = buildChoiceSchemaFromSpecs(state, controller.id, gorthion, [battleMasteryModeSpec], "resolve");
  let field = schema.fields.find((candidate) => candidate.id === "mode");
  assert.equal(field?.maximum, 1);
  assert.deepEqual(field?.options.map((option) => option.id), ["battle-mastery-1", "battle-mastery-2"]);

  controller.heroes.push(card("aa-68", "magnus-static"));
  assert.equal(activeRulePermissions(state, controller.id).has("battle-mastery-select-both"), true);

  schema = buildChoiceSchemaFromSpecs(state, controller.id, gorthion, [battleMasteryModeSpec], "resolve");
  field = schema.fields.find((candidate) => candidate.id === "mode");
  assert.equal(field?.maximum, 2);
  assert.deepEqual(field?.options.map((option) => option.id), ["battle-mastery-1", "battle-mastery-2"]);

  const selectedBoth = { mode: ["battle-mastery-1", "battle-mastery-2"] } as unknown as CardChoices;
  const merged = mergeChoiceAnswers(schema, { [controller.id]: selectedBoth });
  assert.equal(merged.mode, "both");
});

test("Magnus static permission does not create its own Batch trigger", () => {
  const { state, controller } = matchWithPlayers();
  const magnus = card("aa-68", "magnus-trigger-source");
  const gorthion = card("aa-99", "gorthion-played");
  controller.heroes.push(magnus);

  const objects = collectRuleTriggers(state, {
    id: "battle-mastery-card-play",
    name: "CARD_PLAYED",
    actorId: controller.id,
    controllerId: controller.id,
    card: gorthion,
    cardType: gorthion.type,
    targetBakuganId: controller.bakugan[0].id,
    choices: { sourceBakuganId: controller.bakugan[0].id },
    createdAt: Date.now(),
  });

  assert.equal(objects.some((object) => object.card.id === magnus.id), false);
  assert.equal(objects.filter((object) => object.card.id === gorthion.id).length, 1);
});

test("implicit Character stat triggers target the Bakugan carrying the source", () => {
  const { state, controller } = matchWithPlayers();
  const goreene = card("aa-164", "goreene-source");
  const playedAquos = card("bb-10", "aquos-played-card");
  const sourceBakugan = controller.bakugan[0];
  const contextualTarget = controller.bakugan[1];
  sourceBakugan.character = goreene;
  sourceBakugan.open = true;
  contextualTarget.open = true;
  state.selected[controller.id] = contextualTarget.id;

  const objects = collectRuleTriggers(state, {
    id: "aquos-card-play",
    name: "CARD_PLAYED",
    actorId: controller.id,
    controllerId: controller.id,
    card: playedAquos,
    cardType: playedAquos.type,
    targetBakuganId: contextualTarget.id,
    choices: { targetBakuganId: contextualTarget.id },
    createdAt: Date.now(),
  });
  const goreeneTrigger = objects.find((object) => object.card.id === goreene.id);

  assert.ok(goreeneTrigger);
  assert.equal(goreeneTrigger.choices.sourceBakuganId, sourceBakugan.id);
  assert.equal(goreeneTrigger.choices.targetBakuganId, sourceBakugan.id);
});
