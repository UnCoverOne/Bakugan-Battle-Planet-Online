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

test("lobby owns deck and Ranked roster selection", async () => {
  const [lobby, preparation] = await Promise.all([
    read("components/routes/ManagedLobby.jsx"),
    read("lib/lobby-preparation-server.ts"),
  ]);
  assert.match(lobby, /<LobbyDeckPicker/);
  assert.match(lobby, /send\("select-decks",\{decks:selected\}\)/);
  assert.match(preparation, /body.action\s*===\s*"select-decks"/);
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

test("joining sends only the room code and admission command ID", async () => {
  const creation = await read("components/routes/MatchCreationScreen.tsx");
  assert.match(creation, /onSubmit=\{joinLobby\}/);
  assert.match(creation, /command\(\{ action: "join", commandId: crypto.randomUUID\(\), code \}\)/);
});
