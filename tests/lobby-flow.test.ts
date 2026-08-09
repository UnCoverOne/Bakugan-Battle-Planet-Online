import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { lobbyConfig, tagLobbyPlayerDeck } from "../lib/lobby-config";
import {
  roomOwnerId,
  setLobbyReady,
  setLobbyReadyOrStart,
  startLobbyMatch,
  updateLobbySettings,
} from "../lib/lobby";

test("online room readiness never starts automatically and only the owner can start", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const guest = makePlayer("guest", "Guest", STARTER_DECKS[1]);
  let match = createMatch("ROOM01", "bo1", [owner, guest]);

  assert.equal(roomOwnerId(match), "owner");
  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "lobby");
  assert.equal(match.players.find((player) => player.id === "owner")?.ready, true);

  match = setLobbyReadyOrStart(match, "guest");
  assert.equal(match.phase, "lobby");
  assert.equal(match.players.every((player) => player.ready), true);
  assert.throws(
    () => setLobbyReadyOrStart(match, "guest"),
    /Only the room owner can start the match/,
  );

  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "startingPlayer");
  assert.equal(match.log.filter((entry) => entry.message === "Owner locked a legal deck.").length, 1);
});

test("the owner cannot start before the second ready player exists", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  let match = createMatch("ROOM02", "bo1", [owner]);
  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "lobby");
  assert.throws(
    () => setLobbyReadyOrStart(match, "owner"),
    /Wait for another Brawler to join/,
  );
});

test("streamlined lobby supports owner settings, Ready/Unready, and explicit owner start", () => {
  const owner = tagLobbyPlayerDeck(makePlayer("owner", "Owner", STARTER_DECKS[0]), STARTER_DECKS[0]);
  const guest = tagLobbyPlayerDeck(makePlayer("guest", "Guest", STARTER_DECKS[1]), STARTER_DECKS[1]);
  let match = createMatch("ROOM03", "bo3", [owner, guest]);

  assert.deepEqual(lobbyConfig(match), {
    mode: "casual",
    rulesFormat: "standard",
    meta: "battle-brawlers",
  });

  match = setLobbyReady(match, "owner", true);
  assert.equal(match.phase, "lobby");
  match = setLobbyReady(match, "guest", true);
  assert.equal(match.phase, "lobby");
  assert.ok(match.players.every((player) => player.ready));

  match = setLobbyReady(match, "guest", false);
  assert.equal(match.players.find((player) => player.id === "guest")?.ready, false);
  match = setLobbyReady(match, "guest", true);
  assert.throws(() => startLobbyMatch(match, "guest"), /Only the room owner/);
  match = startLobbyMatch(match, "owner");
  assert.equal(match.phase, "startingPlayer");
});

test("changing lobby format clears readiness and enforces the compatible deck format", () => {
  const owner = tagLobbyPlayerDeck(makePlayer("owner", "Owner", STARTER_DECKS[0]), STARTER_DECKS[0]);
  const guest = tagLobbyPlayerDeck(makePlayer("guest", "Guest", STARTER_DECKS[1]), STARTER_DECKS[1]);
  let match = createMatch("ROOM04", "bo1", [owner, guest]);
  match = setLobbyReady(match, "owner", true);
  match = updateLobbySettings(match, "owner", "singleton", "battle-brawlers");

  assert.equal(lobbyConfig(match).rulesFormat, "singleton");
  assert.ok(match.players.every((player) => !player.ready));
  assert.throws(() => setLobbyReady(match, "owner", true), /Select a Singleton deck/);
  assert.throws(() => updateLobbySettings(match, "guest", "standard", "battle-brawlers"), /Only the room owner/);
  assert.throws(() => updateLobbySettings(match, "owner", "competitive", "battle-brawlers"), /only available in Ranked/);
});

test("the streamlined Play route is a one-screen creation flow and the lobby exposes all room controls", async () => {
  const [creation, room, playPage, lobbyPage, provider, runtime] = await Promise.all([
    readFile(new URL("../components/routes/MatchCreationScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/routes/StreamlinedLobbyRoomScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/lobby/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/application/AppProvider.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/routes/MatchRuntime.tsx", import.meta.url), "utf8"),
  ]);

  for (const contract of [
    "Training",
    "Casual",
    "Ranked",
    "Under development",
    "Best of One",
    "Best of Three",
    "Create Lobby",
    "Join Lobby",
    "DECK SELECTION MOVED TO LOBBY",
  ]) assert.match(creation, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(creation, /disabled aria-disabled="true"/);
  assert.match(playPage, /MatchCreationScreen/);
  assert.doesNotMatch(playPage, /PlayScreen/);

  for (const contract of [
    "useMatchTransport",
    "chatEntries",
    "Standard",
    "Singleton",
    "Competitive",
    "Battle Brawlers",
    "Select your deck",
    "UNREADY",
    "READY",
    "START GAME",
    "Ready status never starts the game automatically",
    "LOBBY CHAT",
  ]) assert.match(room, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(room, /\{isOwner \? \(/);
  assert.match(room, /match\.phase === "lobby"/);
  assert.match(lobbyPage, /StreamlinedLobbyRoomScreen/);
  assert.doesNotMatch(lobbyPage, /MatchRuntime|LobbyScreen/);

  // Match capability lives in React state before the debounced sessionStorage write.
  // Route-local stores must be primed from that live value or room commands can send
  // the previous room's capability and fail authorization.
  assert.match(provider, /playerId, matchCapability, matchError/);
  assert.match(provider, /playerId, matchCapability, requestAccountAccess/);
  assert.match(room, /matchCapability: appMatchCapability/);
  assert.match(room, /capability: appMatchCapability/);
  assert.match(runtime, /playerId, matchCapability, settings/);
  assert.match(runtime, /capability: matchCapability/);
});
