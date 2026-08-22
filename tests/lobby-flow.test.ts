import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, makeCanonicalPlayer, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  lobbyConfig,
  playerLobbyDeckFormat,
  tagLobbyPlayerDeck,
} from "../lib/lobby-config";
import {
  lobbyCanStart,
  replaceLobbyDeck,
  roomOwnerId,
  setLobbyReady,
  startLobbyMatch,
  updateLobbySettings,
} from "../lib/lobby";
import { createTrainingLobbyState } from "../lib/training-lobby";

function taggedPlayer(index: number, deck = STARTER_DECKS[index]) {
  return tagLobbyPlayerDeck(
    makePlayer(`player-${index + 1}`, `Player ${index + 1}`, deck),
    deck,
  );
}

test("lobby configuration defaults to Standard Battle Brawlers and the first player owns the room", () => {
  const state = createMatch("ABC123", "bo1", [taggedPlayer(0), taggedPlayer(1)]);
  assert.deepEqual(lobbyConfig(state), {
    mode: "casual",
    rulesFormat: "standard",
    meta: "battle-brawlers",
  });
  assert.equal(roomOwnerId(state), "player-1");
});

test("canonical lobby players carry approved profile avatars", () => {
  const player = makeCanonicalPlayer({
    playerId: "avatar-player",
    name: "Avatar Player",
    cosmetics: { avatar: "preset:shun-kazami" },
    deck: STARTER_DECKS[0],
  });
  assert.equal((player as typeof player & { avatar?: string }).avatar, "preset:shun-kazami");
});

test("only the owner can change lobby settings and a change un-readies both seats", () => {
  let state = createMatch("ABC123", "bo1", [taggedPlayer(0), taggedPlayer(1)]);
  state = setLobbyReady(state, "player-1", true);
  state = setLobbyReady(state, "player-2", true);
  assert.equal(lobbyCanStart(state), true);

  assert.throws(
    () => updateLobbySettings(state, "player-2", "singleton", "battle-brawlers"),
    /Only the room owner/,
  );

  state = updateLobbySettings(state, "player-1", "singleton", "battle-brawlers");
  assert.equal(lobbyConfig(state).rulesFormat, "singleton");
  assert.equal(state.players.every((player) => !player.ready), true);
});

test("competitive lobby format is rejected for Casual rooms", () => {
  const state = createMatch("ABC123", "bo1", [taggedPlayer(0), taggedPlayer(1)]);
  assert.throws(
    () => updateLobbySettings(state, "player-1", "competitive", "battle-brawlers"),
    /only available in Ranked/,
  );
});

test("deck replacement stays in the lobby and un-readies the player", () => {
  let state = createMatch("ABC123", "bo1", [taggedPlayer(0), taggedPlayer(1)]);
  state = setLobbyReady(state, "player-1", true);
  const replacement = taggedPlayer(0, STARTER_DECKS[1]);
  state = replaceLobbyDeck(state, "player-1", replacement);

  assert.equal(state.phase, "lobby");
  assert.equal(state.players[0].ready, false);
  assert.equal(playerLobbyDeckFormat(state.players[0]), "standard");
  assert.equal(state.players[0].bakugan[0].character.catalogId, STARTER_DECKS[1].bakuganIds[0]);
});

test("ready and start are separate owner-controlled actions", () => {
  let state = createMatch("ABC123", "bo1", [taggedPlayer(0), taggedPlayer(1)]);
  state = setLobbyReady(state, "player-1", true);
  state = setLobbyReady(state, "player-2", true);
  assert.equal(state.phase, "lobby");
  assert.equal(lobbyCanStart(state), true);

  assert.throws(() => startLobbyMatch(state, "player-2"), /Only the room owner/);
  state = startLobbyMatch(state, "player-1");
  assert.equal(state.phase, "startingPlayer");
});

test("Training creates a lobby first and keeps the AI ready", () => {
  const state = createTrainingLobbyState("TRAIN1", "bo1", "player-1", "Player 1", STARTER_DECKS[0]);
  assert.equal(state.phase, "lobby");
  assert.equal(state.players.length, 2);
  assert.equal(state.players[1].id, "training-bot");
  assert.equal(state.players[1].ready, true);
  assert.equal(lobbyConfig(state).mode, "training");
});

test("streamlined Match Creation and Lobby source contracts stay in place", async () => {
  const [creation, room, playPage, lobbyPage, provider, runtime] = await Promise.all([
    readFile(new URL("../components/routes/MatchCreationScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/routes/StreamlinedLobbyRoomScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/lobby/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/application/AppProvider.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8"),
  ]);

  for (const contract of [
    "Training",
    "Casual",
    "Ranked",
    "Best of One",
    "Best of Three",
    "Create Lobby",
    "Join Lobby",
  ]) assert.match(creation, new RegExp(contract));
  assert.doesNotMatch(creation, /DECK SELECTION MOVED TO LOBBY/);

  for (const contract of [
    "Configure the match",
    "Standard",
    "Singleton",
    "Competitive",
    "Battle Brawlers",
    "YOUR DECK",
    "SELECT YOUR DECK",
    "LOBBY CHAT",
    "START GAME",
    "ProfileAvatar",
    "deckChoiceDescription",
    "deck.description",
    "cardArtSource",
    "deckLeadCard",
    "deckPickerGrid",
    "featuredDeckStack",
    "deck.tags",
  ]) assert.match(room, new RegExp(contract));
  assert.doesNotMatch(room, /<select[\s\S]*?Select a deck/);
  assert.match(room, /deckPickerOpen/);
  assert.match(room, /compatibleDeckIds/);
  assert.match(room, /setDeckPickerOpen\(false\)/);
  assert.match(provider, /cosmetics:\s*\{\s*avatar:\s*profile\.avatar\s*\}/);
  assert.match(playPage, /MatchCreationScreen/);
  assert.match(lobbyPage, /LobbyRoomScreen/);
  assert.doesNotMatch(playPage, /OnlinePlayScreen/);
  assert.doesNotMatch(lobbyPage, /OnlinePlayScreen/);
  assert.match(provider, /router\.push\("\/play\/lobby"\)/);
  assert.match(provider, /router\.push\("\/play\/match"\)/);
  assert.match(runtime, /router\.replace\("\/play\/result"\)/);
});
