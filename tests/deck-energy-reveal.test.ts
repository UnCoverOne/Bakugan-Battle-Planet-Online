import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, redactForPlayer } from "../lib/game";
import {
  DECK_ENERGY_FACE_REVEAL_MS,
  applyEnergyEntryVisibility,
  deckEnergyFaceVisible,
  nextDeckEnergyFaceRevealExpiry,
} from "../lib/energyVisibility";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("top-deck Energize grants exactly five seconds of owner visibility", () => {
  const first = { id: "first-energy", energyFaceRevealUntil: undefined as number | undefined };
  const second = { id: "second-energy", energyFaceRevealUntil: undefined as number | undefined };
  applyEnergyEntryVisibility([first, second], "deck", 10_000);

  assert.equal(DECK_ENERGY_FACE_REVEAL_MS, 5_000);
  assert.equal(first.energyFaceRevealUntil, 15_000);
  assert.equal(second.energyFaceRevealUntil, 15_000);
  assert.equal(deckEnergyFaceVisible(first, 14_999), true);
  assert.equal(deckEnergyFaceVisible(first, 15_000), false);
  assert.equal(nextDeckEnergyFaceRevealExpiry([first, second], 10_000), 15_000);
  assert.equal(nextDeckEnergyFaceRevealExpiry([first, second], 15_000), null);
});

test("Energizing from a non-deck zone clears a stale face-reveal deadline", () => {
  for (const source of ["hand", "hero", "self"] as const) {
    const card: { id: string; energyFaceRevealUntil?: number } = {
      id: `${source}-energy`,
      energyFaceRevealUntil: 99_999,
    };
    applyEnergyEntryVisibility([card], source, 10_000);
    assert.equal(card.energyFaceRevealUntil, undefined);
  }
});

test("temporary Energy faces remain private to their owner", () => {
  const player = makePlayer("reveal-player", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("reveal-opponent", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("DECKENERGYREVEAL", "bo1", [player, opponent]);
  const livePlayer = match.players.find((candidate) => candidate.id === player.id)!;
  const liveOpponent = match.players.find((candidate) => candidate.id === opponent.id)!;
  const playerCard = livePlayer.hand.pop()!;
  const opponentCard = liveOpponent.hand.pop()!;
  applyEnergyEntryVisibility([playerCard], "deck", 1_000);
  applyEnergyEntryVisibility([opponentCard], "deck", 1_000);
  livePlayer.energyZone.push(playerCard);
  liveOpponent.energyZone.push(opponentCard);

  const redacted = redactForPlayer(match, livePlayer.id);
  const ownEnergy = redacted.players.find((candidate) => candidate.id === livePlayer.id)!.energyZone[0];
  const hiddenOpponentEnergy = redacted.players.find((candidate) => candidate.id === liveOpponent.id)!.energyZone[0];
  assert.equal(ownEnergy.id, playerCard.id);
  assert.equal(ownEnergy.energyFaceRevealUntil, 6_000);
  assert.notEqual(hiddenOpponentEnergy.id, opponentCard.id);
  assert.equal(hiddenOpponentEnergy.energyFaceRevealUntil, undefined);
});

test("engine and game screen wire the reveal only to deck entries and the local Energy zone", () => {
  const game = read("lib/game.ts");
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  assert.match(game, /applyEnergyEntryVisibility\(energized, "deck"\);/);
  assert.match(game, /applyEnergyEntryVisibility\(energized, "hand"\);/);
  assert.match(screen, /temporaryEnergyFaceCardIds/);
  assert.match(screen, /temporaryEnergyRevealCardIds=\{temporaryEnergyFaceCardIds\}/);

  const opponentStart = screen.indexOf('owner="opponent"');
  const playerStart = screen.indexOf('owner="player"', opponentStart + 1);
  assert.ok(opponentStart >= 0 && playerStart > opponentStart);
  assert.doesNotMatch(screen.slice(opponentStart, playerStart), /temporaryEnergyRevealCardIds/);
});
