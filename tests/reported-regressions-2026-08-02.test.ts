import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BAKUGAN, CARDS, CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { alternateWinEffectPending, createMatch, emitGameEvent, passPriority, playCard, resolveStructuredEffect, submitCardChoice, totalDamage } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import type { RuleObject } from "../lib/rules/model";
import { createRuleObject } from "../lib/rules/objects";
import { normalizeRuleObjects } from "../lib/rules/state";
import {
  DRAGONOID_MAXIMUS_ANIMATION_MS,
  DRAGONOID_MAXIMUS_PRESENTATION_MS,
  DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS,
  DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS,
  DRAGONOID_MAXIMUS_RESULT_DELAY_MS,
} from "../components/game-screen-v2/alternateWinPresentation";

test("the result route does not remount the gameplay runtime", () => {
  const source = readFileSync(
    new URL("../app/(workspace)/play/result/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /MatchRuntime/);
  assert.match(source, /<ResultScreen\s*\/>/);
});

test("Haos Gorthion Ultra has 600 B and 2 base Damage", () => {
  const card = CARD_BY_ID.get("bb-330");
  const bakugan = BAKUGAN.find((candidate) => candidate.id === "bb-330");

  assert.equal(card?.bPower, 600);
  assert.equal(card?.damage, 2);
  assert.equal(bakugan?.bPower, 600);
  assert.equal(bakugan?.damage, 2);
});

test("stale Haos Gorthion Ultra snapshots migrate from 7 to 2 Damage", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[1]);
  const second = makePlayer("second", "Second", STARTER_DECKS[0]);
  const state = createMatch("GOR330", "bo1", [first, second]);
  const canonical = BAKUGAN.find((candidate) => candidate.id === "bb-330")!;
  const stale = structuredClone(canonical);
  stale.id = "bb-330-first";
  stale.character.id = "bb-330-first-character";
  stale.damage = 7;
  stale.character.damage = 7;
  state.players[0].bakugan[0] = stale;

  normalizeRuleObjects(state);

  assert.equal(state.players[0].bakugan[0].damage, 2);
  assert.equal(state.players[0].bakugan[0].character.damage, 2);
});

test("Dan Kouzo played by Lia after opening does not trigger retroactively", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("LIA207", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";

  const dan = structuredClone(CARD_BY_ID.get("bb-207")!);
  dan.id = "bb-207-lia-free-play";
  const nextCard = structuredClone(CARD_BY_ID.get("bb-1")!);
  nextCard.id = "bb-1-after-dan";
  state.players[0].deckCards = [nextCard];
  state.players[0].deck = 1;

  // Lia's resolving effect creates a legacy free-play batch object after the
  // BAKUGAN_OPENED event has already happened. Normalization must bind Dan to
  // his enter-play spell, not execute his separate open trigger immediately.
  state.batch = [{
    id: "lia-free-play-dan",
    controllerId: state.players[0].id,
    card: dan,
    choices: {},
    kind: "card",
  }];
  normalizeRuleObjects(state);

  const pending = state.batch[0] as RuleObject;
  assert.equal(pending.abilityId, "bb-207:spell");
  assert.equal(pending.effect, "When you open a Bakugan");

  const resolved = resolveStructuredEffect(state, pending);
  const player = resolved.players[0];
  assert.equal(player.heroes.some((candidate) => candidate.id === dan.id), true);
  assert.equal(player.revealedDeckCardId, undefined);
  assert.equal(player.deckCards[0]?.id, nextCard.id);
});


test("Dragonoid Maximus stages an unrespondable alternate-win effect before the game ends", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("MAXWIN", "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;

  const titanTemplate = BAKUGAN.find((candidate) => candidate.id === "ex-1");
  const maximusTemplate = CARD_BY_ID.get("ex-2");
  assert.ok(titanTemplate && maximusTemplate);
  const titan = structuredClone(titanTemplate);
  titan.id = "ex-1-first";
  titan.character = { ...structuredClone(titan.character), id: "ex-1-first-character" };
  first.bakugan[0] = titan;
  state.selected[first.id] = titan.id;

  for (const name of ["Dan", "Wynton", "Lia"]) {
    const hero = CARDS.find((candidate) => (
      candidate.type === "Hero" && new RegExp(`^${name}\\b`, "i").test(candidate.displayName)
    ));
    assert.ok(hero, `Missing ${name} Hero`);
    first.heroes.push({ ...structuredClone(hero), id: `${hero.catalogId}-maximus-condition` });
  }

  const maximus = { ...structuredClone(maximusTemplate), id: "ex-2-first" };
  const definition = ruleDefinitionForCard(maximus);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: first.id,
    card: maximus,
    ability,
    kind: "card",
    choices: { targetBakuganId: titan.id },
  });
  state.batch = [pending];

  let next = resolveStructuredEffect(state, pending);
  assert.equal(next.phase, "power");
  assert.equal(next.winner, "");
  assert.equal(next.players[0].bakugan[0].evoStack.at(-1)?.catalogId, "ex-2");
  assert.equal(alternateWinEffectPending(next), true);
  const winEffect = next.batch.find((effect) => effect.alternateWin);
  assert.ok(winEffect);
  assert.equal(winEffect.card.catalogId, "ex-2");
  assert.equal(winEffect.kind, "trigger");

  const response = { ...structuredClone(CARD_BY_ID.get("bb-1")!), id: "locked-response" };
  next.players[0].hand.push(response);
  assert.throws(
    () => playCard(next, first.id, response.id),
    /cannot be responded to with cards/i,
  );

  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.phase, "result");
  assert.equal(next.winner, first.id);
  assert.match(next.resultReason, /Dragonoid Maximus/i);
});

test("Dragonoid Maximus uses a red ultimate-effect treatment and ordered presentation timing", () => {
  const runtime = readFileSync(
    new URL("../components/game-screen-v2/GameplayRuntime.tsx", import.meta.url),
    "utf8",
  );
  const experience = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.tsx", import.meta.url),
    "utf8",
  );
  const experienceCss = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../components/game-screen-v2/AlternateWinPresentationLayer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /<AlternateWinPresentationLayer\s*\/>/);
  assert.match(experience, /data-alternate-win/);
  assert.match(experience, /NO CARDS MAY BE PLAYED/);
  assert.match(experienceCss, /border:\s*2px solid #ff3128/);
  assert.match(experienceCss, /alternate-win-batch-pulse/);
  assert.match(presentation, /Dragonoid Maximus/);
  assert.match(presentation, /assets\/cards\/sets\/ex\/full\/ex-2\.webp/);
  assert.ok(DRAGONOID_MAXIMUS_ANIMATION_MS < DRAGONOID_MAXIMUS_RESULT_DELAY_MS);
  assert.ok(DRAGONOID_MAXIMUS_RESULT_DELAY_MS < DRAGONOID_MAXIMUS_PRESENTATION_MS);
  assert.ok(DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS < DRAGONOID_MAXIMUS_RESULT_DELAY_MS);
  assert.ok(DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS < DRAGONOID_MAXIMUS_PRESENTATION_MS);
});



test("Dan Kouzo applies a revealed Dragonoid Maximus Evo to Titan Dragonoid", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("DANMAX", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;

  const titanTemplate = BAKUGAN.find((candidate) => candidate.id === "ex-1");
  const maximusTemplate = CARD_BY_ID.get("ex-2");
  const danTemplate = CARD_BY_ID.get("bb-207");
  assert.ok(titanTemplate && maximusTemplate && danTemplate);

  const titan = structuredClone(titanTemplate);
  titan.id = "ex-1-dan-target";
  titan.character = { ...structuredClone(titan.character), id: "ex-1-dan-character" };
  titan.open = true;
  state.players[0].bakugan[0] = titan;
  state.selected[first.id] = titan.id;

  const dan = { ...structuredClone(danTemplate), id: "bb-207-active" };
  state.players[0].heroes = [dan];
  const maximus = { ...structuredClone(maximusTemplate), id: "ex-2-revealed-by-dan" };
  state.players[0].deckCards = [maximus];
  state.players[0].deck = 1;

  emitGameEvent(state, {
    id: `${state.turn}:open:${titan.id}`,
    type: "open",
    playerId: first.id,
    targetBakuganId: titan.id,
  });
  assert.equal(state.batch.at(-1)?.card.catalogId, "bb-207");

  let next = passPriority(state, state.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.pendingChoice?.controllerId, first.id);
  assert.match(next.pendingChoice?.schema.sourceName ?? "", /Dan Kouzo/i);

  next = submitCardChoice(next, first.id, { orderedCardIds: [maximus.id], confirmed: true });
  assert.equal(next.batch.at(-1)?.card.catalogId, "ex-2");
  assert.equal(next.batch.at(-1)?.choices.targetBakuganId, titan.id);

  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  const resolvedPlayer = next.players.find((player) => player.id === first.id)!;
  assert.equal(resolvedPlayer.bakugan[0].evoStack.at(-1)?.catalogId, "ex-2");
  assert.equal(resolvedPlayer.discard.some((card) => card.id === maximus.id), false);
});

test("Lia Venegas searches for a Hero when played and grants +10 Damage with five Heroes", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("LIA202", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "preRoll";
  state.startingPlayer = first.id;
  state.priority = first.id;

  const liaTemplate = CARD_BY_ID.get("bb-202");
  const searchedHeroTemplate = CARD_BY_ID.get("bb-208");
  const energyTemplate = CARD_BY_ID.get("bb-1");
  assert.ok(liaTemplate && searchedHeroTemplate && energyTemplate);
  const lia = { ...structuredClone(liaTemplate), id: "bb-202-played" };
  const searchedHero = { ...structuredClone(searchedHeroTemplate), id: "bb-208-search-target" };
  const nonHero = { ...structuredClone(energyTemplate), id: "bb-1-nonhero" };

  const passiveHeroIds = ["bb-207", "bb-206", "bb-205", "bb-197"];
  state.players[0].heroes = passiveHeroIds.map((catalogId, index) => {
    const hero = CARD_BY_ID.get(catalogId);
    assert.ok(hero);
    return { ...structuredClone(hero), id: `${catalogId}-lia-count-${index}` };
  });
  state.players[0].hand = [lia];
  state.players[0].deckCards = [searchedHero, nonHero];
  state.players[0].deck = 2;
  state.players[0].energyZone = Array.from({ length: 10 }, (_, index) => ({
    ...structuredClone(energyTemplate),
    id: `lia-energy-${index}`,
  }));
  state.players[0].energy = 10;

  const active = state.players[0].bakugan[0];
  active.open = true;
  state.selected[first.id] = active.id;
  const baseDamage = totalDamage(state, first.id);

  let next = playCard(state, first.id, lia.id);
  const liaTrigger = next.batch.find((effect) => effect.card.id === lia.id && effect.kind === "trigger");
  assert.ok(liaTrigger, "Lia's when-play trigger should enter the batch");

  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  const deckChoice = next.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId");
  assert.ok(deckChoice);
  assert.equal(deckChoice.options.some((option) => option.id === searchedHero.id), true);
  assert.equal(deckChoice.options.some((option) => option.id === nonHero.id), false);

  next = submitCardChoice(next, first.id, { deckCardId: searchedHero.id });
  assert.equal(next.players[0].hand.some((card) => card.id === searchedHero.id), true);
  assert.equal(next.players[0].deckCards.some((card) => card.id === searchedHero.id), false);

  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.players[0].heroes.some((hero) => hero.id === lia.id), true);
  assert.equal(next.players[0].heroes.length, 5);
  assert.equal(totalDamage(next, first.id), baseDamage + 10);
});
