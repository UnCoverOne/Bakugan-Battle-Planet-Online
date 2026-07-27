import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Deck Library includes the complete responsive library composition", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  for (const contract of [
    "DeckAreaHeader",
    "DeckToolbar",
    "CharacterFan",
    "Selected for Play",
    "DeckLibrarySkeleton",
    "Working offline",
    "Deck storage needs attention",
    "No decks match these filters",
    "Build your first battle deck",
    'type LibraryView = "grid" | "list"',
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.toolbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.deckGrid_list/);
  assert.match(css, /\.deckCardSelected/);
});

test("Deck Builder exposes team, Main Deck, catalogue, inspector, legality, and save status", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  for (const contract of [
    "BuilderTeam",
    "BuilderDeckList",
    "BuilderCatalogue",
    "BuilderInspector",
    "ValidationPanel",
    "Draft saved locally",
    "Save Deck",
    "Energy curve",
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("public copying and read-only details reuse validation and preserve attribution", async () => {
  const [route, persistence] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("lib/persistence.ts"),
  ]);
  assert.match(route, /DeckDetailPresentation/);
  assert.match(route, /sourceDeckId:\s*deck\.id/);
  assert.match(route, /sourceCreator:/);
  assert.match(route, /validateDeck\(deck\)/);
  assert.match(route, /Copy to My Decks/);
  assert.match(persistence, /sourceDeckId:/);
  assert.match(persistence, /sourceCreator:/);
});

test("all legality boundaries delegate to the centralized engine", async () => {
  const [data, play, server, decks] = await Promise.all([
    read("lib/data.ts"),
    read("components/routes/PlayRoutes.tsx"),
    read("app/api/user-data/route.ts"),
    read("components/routes/DeckRoutes.tsx"),
  ]);
  assert.match(data, /validateDeckConstruction/);
  assert.match(play, /validateDeck\(chosenDeck\)/);
  assert.match(play, /playSetupStartBlockers/);
  assert.match(server, /validateDeck\(deck as unknown as DeckRecord\)/);
  assert.match(server, /firstIssue\.code/);
  assert.match(decks, /const report = useMemo\(\(\) => validateDeck\(deck\)/);
});
