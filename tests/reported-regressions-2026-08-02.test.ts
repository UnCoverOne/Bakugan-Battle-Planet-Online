import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BAKUGAN, CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, resolveStructuredEffect } from "../lib/game";
import type { RuleObject } from "../lib/rules/model";
import { normalizeRuleObjects } from "../lib/rules/state";

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
