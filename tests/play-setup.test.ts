import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeRoomCode } from "../lib/room-code";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("lobby room code normalisation excludes ambiguous characters and limits length", () => {
  assert.equal(normalizeRoomCode("bpo1-7k3m"), "BP7K3M");
  assert.equal(normalizeRoomCode("bp7k3m extra"), "BP7K3M");
  assert.equal(normalizeRoomCode("o1-"), "");
});

test("current Play route opens match creation without a deck-selection step", async () => {
  const [page, creation] = await Promise.all([
    read("app/(workspace)/play/page.tsx"),
    read("components/routes/MatchCreationScreen.tsx"),
  ]);
  assert.match(page, /MatchCreationScreen/);
  assert.match(creation, /Create Lobby/);
  assert.match(creation, /Join Lobby/);
  assert.match(creation, /normalizeRoomCode/);
  assert.doesNotMatch(creation, /setSelectedDeckId|rankedDeckIds|SELECT_DECK|LoadoutStep/);
});

test("lobby owns the actual deck and Ranked roster selection", async () => {
  const [lobby, config] = await Promise.all([
    read("components/routes/StreamlinedLobbyRoomScreen.tsx"),
    read("lib/lobby-config.ts"),
  ]);
  assert.match(lobby, /Select your deck/);
  assert.match(lobby, /ranked-roster/);
  assert.match(lobby, /rankedRosterIds/);
  assert.match(lobby, /playerHasChosenLobbyDeck/);
  assert.match(config, /export function playerHasChosenLobbyDeck/);
});
