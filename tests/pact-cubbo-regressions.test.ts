import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  submitCardChoice,
} from "../lib/game";
import { effectiveCardEnergyCost } from "../lib/cardPayment";
import { resolveManualDamage } from "../lib/manualDamage";
import { advanceOpponentAi } from "../lib/opponentAi";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { buildChoiceSchema } from "../lib/rules/choices";
import { createRuleObject } from "../lib/rules/objects";
import {
  compactMatchHudSlots,
  visibleMatchHudActions,
} from "../components/game-screen-v2/matchHudState";

test("Pact of Darkness uses the generic Sacrifice payment route", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("PACT152", "bo1", [first, second]);
  state.turn = 3;
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;

  const pactTemplate = CARD_BY_ID.get("bb-152");
  const discardTemplate = CARD_BY_ID.get("bb-1");
  assert.ok(pactTemplate && discardTemplate);
  const pact = { ...structuredClone(pactTemplate), id: "bb-152-revealed" };
  const sacrificed = { ...structuredClone(discardTemplate), id: "pact-sacrifice-card" };
  first.hand = [sacrificed];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(discardTemplate),
    id: `pact-energy-${index}`,
  }));
  state.revealedFlip = pact;

  assert.equal(effectiveCardEnergyCost(state, first.id, pact), 4);
  let next = resolveManualDamage(state, first.id, pact.id);
  const mode = next.pendingChoice?.schema.fields.find((field) => field.id === "paymentMode");
  assert.ok(mode);
  const sacrificeMode = mode.options.find((option) => option.id.endsWith(":discard-for-free"));
  assert.ok(sacrificeMode && !sacrificeMode.disabled);

  next = submitCardChoice(next, first.id, { paymentMode: sacrificeMode.id });
  assert.equal(next.pendingChoice?.schema.fields[0]?.id, "discardCardIds");
  const actions = visibleMatchHudActions({
    match: next,
    playerId: first.id,
    mode: "discard",
    selectedCardId: "",
    selectionPending: false,
  });
  assert.deepEqual(compactMatchHudSlots(actions), ["discard", "skip-flip"]);

  next = submitCardChoice(next, first.id, { discardCardIds: [sacrificed.id] });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.players[0].hand.some((card) => card.id === sacrificed.id), false);
  assert.equal(next.players[0].discard.some((card) => card.id === sacrificed.id), true);
  assert.equal(next.batch.some((effect) => effect.card.id === pact.id), true);
  assert.equal(next.players[0].energy, 0);
  assert.equal(next.revealedFlip, undefined);
});

test("Darkus Hyper Cubbo lets the Training AI complete its forced discard", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const bot = makePlayer("training-bot", "Training AI", STARTER_DECKS[1]);
  const state = createMatch("CUBBO106", "bo1", [first, bot]);
  state.turn = 4;
  state.phase = "power";
  state.priority = bot.id;

  const hyperTemplate = CARD_BY_ID.get("aa-106");
  const discardTemplate = CARD_BY_ID.get("bb-1");
  assert.ok(hyperTemplate && discardTemplate);
  const hyper = { ...structuredClone(hyperTemplate), id: "aa-106-active", bPower: 400 };
  const expendable = {
    ...structuredClone(discardTemplate),
    id: "ai-forced-discard",
  };
  bot.hand = [expendable];
  const opened = first.bakugan[0];
  const opposing = bot.bakugan[0];
  opened.open = true;
  opened.evoStack = [hyper];
  opposing.open = true;
  opposing.bPower = 700;
  opposing.character = { ...opposing.character, bPower: 700 };
  state.selected[first.id] = opened.id;
  state.selected[bot.id] = opposing.id;

  const definition = ruleDefinitionForCard(hyper);
  const ability = definition.abilities.find((candidate) => candidate.kind === "triggered");
  assert.ok(ability);
  const effect = createRuleObject({
    controllerId: first.id,
    card: hyper,
    ability,
    kind: "trigger",
    sourceId: hyper.id,
    choices: { sourceBakuganId: opened.id },
  });
  state.batch = [effect];
  const instruction = ability.instructions[0];
  const schema = buildChoiceSchema(
    state,
    first.id,
    hyper,
    instruction.sourceText,
    {},
    "resolve",
  );
  assert.equal(schema.fields[0]?.chooserId, bot.id);
  assert.equal(schema.fields[0]?.id, "discardCardIds");
  state.pendingChoice = {
    id: "hyper-cubbo-ai-discard",
    kind: "resolution",
    controllerId: first.id,
    cardId: hyper.id,
    schema,
    answers: {},
    createdVersion: state.version,
    pendingEffectId: effect.id,
    instructionIndex: 0,
    resumePriority: first.id,
    resumeStepLabel: state.stepLabel,
    resumeDeadline: state.deadline,
  };

  const next = advanceOpponentAi(state, bot.id);
  assert.ok(next);
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.players[1].hand.some((card) => card.id === expendable.id), false);
  assert.equal(next.players[1].discard.some((card) => card.id === expendable.id), true);
});
