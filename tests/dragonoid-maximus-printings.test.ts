import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  DRAGONOID_MAXIMUS_HERO_CARD_IDS,
  DRAGONOID_MAXIMUS_PRESENTATION_MS,
  DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS,
  DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS,
  DRAGONOID_MAXIMUS_RESULT_DELAY_MS,
  dragonoidMaximusCard,
  dragonoidMaximusHeroCards,
  dragonoidMaximusPresentationStartedAt,
  dragonoidMaximusResolvedAt,
  dragonoidMaximusResultRemaining,
} from "../components/game-screen-v2/alternateWinPresentation";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.equal(
    ruleConditionActive(exact.state, exact.state.players[0], instruction.condition),
    true,
  );

  const otherPrintings = maximusMatch(["br-81", "aa-75", "aa-71"]);
  assert.equal(
    ruleConditionActive(
      otherPrintings.state,
      otherPrintings.state.players[0],
      instruction.condition,
    ),
    false,
  );
});

test("the three exact Battle Brawlers Heroes activate Dragonoid Maximus", () => {
  const { state, player, titan, maximus } = maximusMatch(["bb-207", "bb-215", "bb-202"]);
  let resolved = playCardWithAutoEnergy(
    state,
    player.id,
    maximus.id,
    { targetBakuganId: titan.id },
  );
  resolved = resolveTopBatchObject(resolved);
  assert.equal(resolved.phase, "power");
  assert.equal(resolved.batch.some((effect) => effect.alternateWin), true);

  resolved = resolveTopBatchObject(resolved);
  assert.equal(resolved.phase, "result");
  assert.equal(resolved.winner, player.id);
  assert.equal(resolved.series[player.id], 1);
  assert.equal(resolved.resultReason, "Dragonoid Maximus's alternate win condition");
  assert.deepEqual(
    dragonoidMaximusHeroCards(resolved).map((hero) => hero.catalogId),
    [...DRAGONOID_MAXIMUS_HERO_CARD_IDS],
  );
  assert.equal(dragonoidMaximusCard(resolved)?.id, maximus.id);

  const resolvedAt = dragonoidMaximusResolvedAt(resolved);
  assert.ok(resolvedAt > 0);
  const firstSeenAt = resolvedAt + 100;
  assert.equal(
    dragonoidMaximusPresentationStartedAt(resolved, firstSeenAt),
    firstSeenAt,
  );
  assert.equal(
    dragonoidMaximusResultRemaining(resolved, firstSeenAt + 100, 500),
    400,
  );
});

test("Dragonoid Maximus presentation overlaps its result handoff and shortens reduced motion", () => {
  assert.ok(DRAGONOID_MAXIMUS_RESULT_DELAY_MS < DRAGONOID_MAXIMUS_PRESENTATION_MS);
  assert.ok(
    DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS
      < DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS,
  );
  assert.ok(DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS < DRAGONOID_MAXIMUS_RESULT_DELAY_MS);
  assert.ok(DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS < DRAGONOID_MAXIMUS_PRESENTATION_MS);
});


test("Dragonoid Maximus presentation uses a client-local clock, remains skippable, and bounds mobile effects", () => {
  const layer = read("components/game-screen-v2/AlternateWinPresentationLayer.tsx");
  const css = read("components/game-screen-v2/AlternateWinPresentationLayer.module.css");
  const mobileCss = read("components/game-screen-v2/AlternateWinPresentationMobile.module.css");
  const coordinator = read("components/game-screen-v2/MatchStateCoordinator.tsx");
  const sound = read("components/game-screen-v2/GameplaySoundLayer.tsx");

  assert.doesNotMatch(layer, /setInterval/);
  assert.doesNotMatch(layer, /useLayoutEffect/);
  assert.doesNotMatch(layer, /dragonoidMaximusResolvedAt/);
  assert.match(layer, /dragonoidMaximusPresentationStartedAt/);
  assert.match(layer, /--timeline-offset/);
  assert.match(layer, /dragonoidMaximusHeroCards/);
  assert.match(layer, /aria-label="Skip Dragonoid Maximus win animation"/);
  assert.match(layer, /event\.key === "Tab"/);
  assert.match(layer, /event\.key === "Escape"/);
  assert.match(layer, /loading="eager"/);
  assert.match(layer, /decoding="async"/);
  assert.match(layer, /fetchPriority="high"/);
  assert.match(css, /var\(--timeline-offset\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?particles i:nth-child\(n\+7\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(mobileCss, /cardFrame[\s\S]*?filter:\s*none\s*!important/);
  assert.match(mobileCss, /energyRing:nth-child\(3\)[\s\S]*?display:\s*none/);
  assert.match(mobileCss, /particle:nth-child\(n \+ 5\)[\s\S]*?display:\s*none/);
  assert.match(coordinator, /DRAGONOID_MAXIMUS_SKIP_EVENT/);
  assert.match(coordinator, /dragonoidMaximusResultDelay\(reducedMotion\)/);
  assert.match(sound, /MAXIMUS_SEQUENCE/);
  assert.match(sound, /wins game\.\*Dragonoid Maximus/);
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
