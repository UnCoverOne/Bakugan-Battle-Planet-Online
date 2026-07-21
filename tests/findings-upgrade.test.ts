import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAKUGAN, CARDS, STARTER_DECKS, deckErrors, makePlayer } from "../lib/data";
import {
  collectTriggersForEvent,
  createMatch,
  passPriority,
  playCard,
  submitCardChoice,
  type GameCard,
} from "../lib/game";
import { nextMatchAlarmAt, resolveExpiredDeadline } from "../lib/deadlines";
import { canUndoLatest } from "../lib/undo";

const rootFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function priorityMatch(code = "FIND01") {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch(code, "bo1", [player, opponent]);
  match.turn = 2;
  match.phase = "power";
  match.startingPlayer = player.id;
  match.priority = player.id;
  match.passes = [];
  return { match, player, opponent };
}

test("Cloudflare Images and transformed-image caching are declared in source control", () => {
  const config = JSON.parse(rootFile("wrangler.jsonc")) as {
    images?: { binding?: string };
    cache?: { enabled?: boolean };
  };
  const worker = rootFile("worker/index.ts");
  assert.equal(config.images?.binding, "IMAGES");
  assert.equal(config.cache?.enabled, true);
  assert.match(worker, /env\.IMAGES\.input/);
  assert.match(worker, /cache-control/);
});

test("canonical deck construction rejects every unresolved catalogue ID", () => {
  const invalid = {
    ...structuredClone(STARTER_DECKS[0]),
    id: "invalid-ids",
    cardIds: Array.from({ length: 40 }, (_, index) => `missing-card-${index}`),
  };
  assert.ok(deckErrors(invalid).some((error) => /catalogue ID/i.test(error)));
  assert.throws(() => makePlayer("invalid", "Invalid", invalid), /catalogue ID/i);
});

test("a clause target is chosen only when that clause resolves, then RuleActions mutate state", () => {
  const { match, player, opponent } = priorityMatch("CHOICE");
  const base = CARDS.find((card) => card.type === "Action")!;
  const card: GameCard = {
    ...structuredClone(base),
    id: "structured-target-action",
    catalogId: "test-structured-target-action",
    name: "Structured Target",
    displayName: "Structured Target",
    cost: 0,
    effect: "Choose a Bakugan. +500 [B].",
  };
  player.hand = [card];

  let state = playCard(match, player.id, card.id);
  assert.equal(state.pendingChoice, undefined, "the card enters the batch before its target clause resolves");
  assert.equal(state.batch.length, 1);
  state = passPriority(state, player.id);
  state = passPriority(state, opponent.id);
  assert.equal(state.pendingChoice?.kind, "resolution");
  assert.deepEqual(state.pendingChoice?.schema.fields.map((field) => field.id), ["targetBakuganId"]);

  const target = state.players[0].bakugan[0];
  state = submitCardChoice(state, player.id, { targetBakuganId: target.id });
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.batch.length, 0);
  assert.equal(state.powerBoost[target.id], 500);
  assert.ok(state.log.some((entry) => /structured RuleAction program/.test(entry.message)));
});

test("compound clauses preserve earlier targets while an opponent answers only their own later choice", () => {
  const { match, player, opponent } = priorityMatch("GRAVTY");
  const source = CARDS.find((card) => card.name === "Gravity Shift")!;
  const card = { ...structuredClone(source), id: "gravity-shift-test", cost: 0 as const };
  player.hand = [card];

  let state = playCard(match, player.id, card.id);
  state = passPriority(state, player.id);
  state = passPriority(state, opponent.id);
  assert.equal(state.pendingChoice?.schema.fields[0]?.chooserId, player.id);
  const target = state.players[0].bakugan[1];
  state = submitCardChoice(state, player.id, { targetBakuganId: target.id });
  assert.equal(state.pendingChoice?.schema.fields[0]?.id, "mode");
  assert.equal(state.pendingChoice?.schema.fields[0]?.chooserId, opponent.id);

  state = submitCardChoice(state, opponent.id, { mode: "damage" });
  assert.equal(state.damageBoost[target.id], 10);
  assert.equal(state.powerBoost[target.id] ?? 0, 0);
});

test("general event collection finds matching active-card and Hero triggers once per event", () => {
  const { match, player } = priorityMatch("TRIGGR");
  const hero: GameCard = {
    ...structuredClone(CARDS.find((card) => card.type === "Hero")!),
    id: "general-trigger-hero",
    catalogId: "test-general-trigger-hero",
    effect: "When you play an Action card, draw a card.",
  };
  player.heroes.push(hero);
  const event = { id: "turn-2-action", type: "card-play" as const, playerId: player.id, cardType: "Action" as const };
  const first = collectTriggersForEvent(match, event);
  const duplicate = collectTriggersForEvent(match, event);
  assert.equal(first.length, 1);
  assert.equal(first[0].sourceId, hero.id);
  assert.equal(duplicate.length, 0);
});

test("draw, damage, and turn-start modules contain no state-rewind compatibility path", () => {
  for (const path of ["lib/drawQueue.ts", "lib/manualDamage.ts", "lib/turnStart.ts"]) {
    assert.doesNotMatch(rootFile(path), /reconcile|rewind|restoreImmediate|preparePendingDraw/i, path);
  }
});

test("undo retains an explicit irreversible-information flag from preparation through play", () => {
  const { match, player } = priorityMatch("UNDO01");
  const card = { ...structuredClone(CARDS.find((candidate) => candidate.type === "Action")!), id: "undo-card", cost: 0 as const };
  player.hand = [card];
  match.pendingChoice = {
    id: "irreversible-preparation",
    kind: "card-play",
    controllerId: player.id,
    cardId: card.id,
    schema: {
      id: "irreversible-schema",
      sourceId: card.id,
      sourceName: card.name,
      controllerId: player.id,
      fields: [],
      simultaneous: false,
    },
    answers: {},
    createdVersion: match.version,
    beforeState: JSON.stringify({ ...match, pendingChoice: undefined, undoWindow: undefined }),
    irreversibleInformation: true,
  };
  const played = playCard(match, player.id, card.id);
  assert.equal(played.undoWindow?.irreversibleInformation, true);
  assert.equal(canUndoLatest(played, player.id), false);
});

test("Durable Object alarms resolve deadlines and abandonment without client heartbeats", () => {
  const { match, player, opponent } = priorityMatch("ALARM1");
  match.deadline = 1_000;
  const resolved = resolveExpiredDeadline(match, 1_001);
  assert.equal(resolved.priority, opponent.id);
  assert.ok(resolved.version > match.version);
  assert.equal(nextMatchAlarmAt(match, 500), 1_500, "alarms keep Cloudflare's one-second minimum scheduling margin");

  const worker = rootFile("worker/index.ts");
  const store = rootFile("components/game-screen-v2/matchStore.ts");
  assert.match(worker, /async alarm\(\)/);
  assert.match(worker, /resolveExpiredDeadline/);
  assert.match(worker, /Opponent abandoned the match/);
  assert.doesNotMatch(worker, /webSocketMessage/);
  assert.doesNotMatch(store, /heartbeatTimer|type:\s*["']ping["']/);
  assert.equal(player.id, match.priority);
});

test("every Ultra has the 85% / 10% roll profile and all other Bakugan retain 90% / 5%", () => {
  const ultras = BAKUGAN.filter((bakugan) => /\bUltra\b/i.test(bakugan.character.displayName));
  const standard = BAKUGAN.filter((bakugan) => !/\bUltra\b/i.test(bakugan.character.displayName));
  assert.ok(ultras.length > 0);
  assert.ok(standard.length > 0);
  assert.ok(ultras.every((bakugan) => bakugan.rollAccuracy === 85 && bakugan.doubleCoreChance === 10));
  assert.ok(standard.every((bakugan) => bakugan.rollAccuracy === 90 && bakugan.doubleCoreChance === 5));
});
