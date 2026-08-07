import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { roomOwnerId, setLobbyReadyOrStart } from "../lib/lobby";

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

test("the lobby route has live room transport, chat, ready state, and owner-only start UI", async () => {
  const [room, page] = await Promise.all([
    readFile(new URL("../components/routes/LobbyRoomScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/lobby/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const contract of [
    "useMatchTransport",
    "chatEntries",
    "LOCK IN & READY",
    "ROOM OWNER",
    "Both players must be ready",
    "Waiting for room owner",
    "START MATCH",
    "Ready status does not start the match automatically",
  ]) assert.match(room, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(room, /\{isOwner \? \(/);
  assert.match(room, /match\.phase === "lobby"/);
  assert.match(page, /LobbyRoomScreen/);
  assert.doesNotMatch(page, /MatchRuntime|LobbyScreen/);
});
