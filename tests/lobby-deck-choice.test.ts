import assert from "node:assert/strict";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { createMatch } from "../lib/game";
import { playerHasChosenLobbyDeck, playerLobbyDeckName, tagLobbyPlayerDeck } from "../lib/lobby-config";
import { lobbyCanStart, replaceLobbyDeck, setLobbyReady } from "../lib/lobby";
import { initializeRankedLobby, joinRankedLobby, rankedSeries } from "../lib/ranked-lobby";

test("a provisional lobby seat cannot ready or start until the player explicitly selects a deck", () => {
  const first = tagLobbyPlayerDeck(makePlayer("first", "First", STARTER_DECKS[0]), STARTER_DECKS[0], false);
  const second = tagLobbyPlayerDeck(makePlayer("second", "Second", STARTER_DECKS[1]), STARTER_DECKS[1], false);
  const match = createMatch("ROOM42", "bo1", [first, second]);
  assert.equal(playerHasChosenLobbyDeck(match.players[0]), false);
  assert.equal(playerLobbyDeckName(match.players[0]), "");
  assert.equal(lobbyCanStart(match), false);
  assert.throws(() => setLobbyReady(match, "first", true), /Choose a deck in this lobby/);

  const selected = tagLobbyPlayerDeck(makePlayer("first", "First", STARTER_DECKS[0]), STARTER_DECKS[0]);
  const updated = replaceLobbyDeck(match, "first", selected);
  assert.equal(playerHasChosenLobbyDeck(updated.players[0]), true);
  assert.equal(playerLobbyDeckName(updated.players[0]), STARTER_DECKS[0].name);
  assert.equal(playerHasChosenLobbyDeck(updated.players[1]), false);
  assert.doesNotThrow(() => setLobbyReady(updated, "first", true));
});

test("Ranked lobbies stay in deck-lock until both players submit their rosters", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const match = createMatch("RANK42", "bo3", [first, second]);
  const ranked = initializeRankedLobby(match, "first", "account-first", "First", [], 1, [], 50);
  assert.equal(rankedSeries(ranked)?.stage, "deck-lock");
  assert.equal(rankedSeries(ranked)?.players.first.decks.length, 0);
  const joined = joinRankedLobby(ranked, "second", "account-second", "Second", [], []);
  assert.equal(rankedSeries(joined)?.stage, "deck-lock");
  assert.equal(rankedSeries(joined)?.players.second.decks.length, 0);
});

test("a joining seat is a provisional Standard loadout until lobby selection", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../app/api/game/route.ts", import.meta.url), "utf8");
  assert.match(server, /const provisionalFormat = ranked \? "competitive" : "standard"/);
  assert.match(server, /effectiveSelection\.deck,\s*false/);
});

test("the application provider no longer persists or exposes a selected-for-play deck", async () => {
  const { readFile } = await import("node:fs/promises");
  const provider = await readFile(new URL("../components/application/AppProvider.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(provider, /useStoredState\("bbp-selected-deck-v1"/);
  assert.doesNotMatch(provider, /\bsetSelectedDeckId\b|\bstartSolo\b/);
  assert.match(provider, /selectedDeckId: ""/); // Historical snapshot shape remains readable.
  assert.match(provider, /localStorage\.removeItem\("bbp-selected-deck-v1"\)/);
});
