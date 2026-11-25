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

test("Play uses exactly two artwork layers and the shared design palette", async () => {
  const [creation, css, page] = await Promise.all([
    read("components/routes/MatchCreationScreen.tsx"),
    read("components/routes/MatchCreationScreen.module.css"),
    read("app/(workspace)/play/page.tsx"),
  ]);
  assert.match(creation, /Choose Your Mode/);
  for (const asset of ["aquos.png", "pyrus.png", "darkus.png"]) assert.ok(creation.includes("/assets/" + asset));
  assert.match(creation, /src=\{selectedMode.art\}/);
  assert.match(css, /Background%20Art%201\.webp/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|Red%20Gradient|::before|::after/);
  assert.match(css, /background:var\(--bb-selection\)/);
  assert.match(creation, /bb-button--primary/);
  assert.match(css, /grid-template-areas:"artwork" "controls"/);
  assert.doesNotMatch(page, /creationScope/);
});

test("joining is independent of the selected creation mode and structure", async () => {
  const [creation, provider, api] = await Promise.all([
    read("components/routes/MatchCreationScreen.tsx"),
    read("components/application/AppProvider.jsx"),
    read("app/api/game/route.ts"),
  ]);
  assert.match(creation, /onSubmit=\{joinLobby\}/);
  assert.match(creation, /joinOnline\(\{ bootstrapDeck, roomCode: code, structure: result.structure/);
  assert.match(provider, /format: structureOverride \?\? format/);
  assert.match(api, /export async function GET/);
  assert.match(api, /structure: state.format/);
});
