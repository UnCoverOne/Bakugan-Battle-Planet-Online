import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { playCardWithAutoEnergy } from "../lib/cardPayment";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { ruleConditionActive } from "../lib/rules/modifiers";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function addUntappedEnergy(player: ReturnType<typeof makePlayer>, amount: number) {
  player.energyZone = Array.from({ length: amount }, (_, index) => (
    card("bb-10", `${player.id}-maximus-energy-${index}`)
  ));
  player.energy = 0;
  player.maxEnergy = amount;
}

function resolveTopBatchObject(state: MatchState) {
  state = passPriority(state, state.priority);
  return passPriority(state, state.priority);
}

function maximusMatch(heroCatalogIds: string[]) {
  const player = makePlayer("maximus-player", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("maximus-opponent", "Beta", STARTER_DECKS[1]);
  const titanSource = BAKUGAN.find((bakugan) => bakugan.id === "ex-1");
  assert.ok(titanSource);
  const titan = {
    ...titanSource,
    id: "maximus-titan",
    character: { ...titanSource.character, id: "maximus-titan-character" },
    open: true,
    heldCoreCells: [],
    evoStack: [],
  };
  player.bakugan[0] = titan;
  player.heroes = heroCatalogIds.map((catalogId, index) => (
    card(catalogId, `maximus-hero-${index}`)
  ));
  const maximus = card("ex-2", "maximus-evo");
  player.hand = [maximus];
  addUntappedEnergy(player, 10);

  const state = createMatch("MAXPRINT", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = player.id;
  state.initialStartingPlayer = player.id;
  state.priority = player.id;
  state.selected[player.id] = titan.id;
  return { state, player, titan, maximus };
}

test("Dragonoid Maximus recognizes only the three Battle Brawlers Hero printings", () => {
  const exact = maximusMatch(["bb-207", "bb-215", "bb-202"]);
  const instruction = ruleDefinitionForCard(exact.maximus).abilities
    .flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.effects.some((effect) => effect.kind === "win-game"));
  assert.ok(instruction);
  assert.deepEqual(instruction.condition, {
    kind: "controls-named-cards",
    names: ["Dan", "Wynton", "Lia"],
  });
  assert.equal(ruleConditionActive(exact.state, exact.player, instruction.condition), true);

  const otherPrintings = maximusMatch(["br-81", "aa-75", "aa-71"]);
  assert.equal(
    ruleConditionActive(otherPrintings.state, otherPrintings.player, instruction.condition),
    false,
  );
});

test("other Dan, Wynton, and Lia Hero cards do not activate Dragonoid Maximus", () => {
  const { state, player, titan, maximus } = maximusMatch(["br-81", "aa-75", "aa-71"]);
  let resolved = playCardWithAutoEnergy(
    state,
    player.id,
    maximus.id,
    { targetBakuganId: titan.id },
  );
  resolved = resolveTopBatchObject(resolved);

  assert.equal(resolved.winner, "");
  assert.equal(resolved.resultReason, "");
  assert.equal(resolved.series[player.id], 0);
  assert.equal(resolved.phase, "power");
  assert.equal(resolved.batch.length, 0);
  assert.equal(
    resolved.players.find((candidate) => candidate.id === player.id)
      ?.bakugan.find((candidate) => candidate.id === titan.id)
      ?.evoStack.at(-1)?.catalogId,
    "ex-2",
  );
});
