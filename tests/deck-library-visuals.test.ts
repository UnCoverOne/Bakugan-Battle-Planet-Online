import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("Deck Library previews use three Characters plus the deck Featured card", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  assert.match(route, /deckLeadCard/);
  assert.match(route, /featuredPreviewCard/);
  assert.match(route, /data-featured-preview=\{featuredPreviewCard \? "true"/);
  assert.equal((route.match(/<CharacterFan deck=\{deck\} compact=\{view === "list"\} featured \/>/g) ?? []).length, 2);
});

test("Deck Library faction metadata is symbol-first and remains accessible", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  assert.match(route, /function DeckFactionSymbols/);
  assert.match(route, /src=\{FACTION_SYMBOLS\[faction\]\}/);
  assert.match(route, /aria-label=\{`Factions: \$/);
  assert.match(route, /title=\{faction\}/);
  assert.equal((route.match(/<DeckFactionSymbols factions=\{deck\.factions\} \/>/g) ?? []).length, 2);
});

test("Public Deck actions keep Favorite compact while preserving count and accessibility", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  const start = route.indexOf("function PublicDeckTile");
  const end = route.indexOf("export function PublicDeckDetailScreen", start);
  const tile = route.slice(start, end);
  assert.match(tile, /publicDeckActions/);
  assert.match(tile, /title="Copy to My Decks">Copy<\/button>/);
  assert.match(tile, /className=\{styles\.favoriteButton\}/);
  assert.match(tile, /<span aria-hidden="true">\{favorite\.viewerHasFavorited \? "★" : "☆"\}<\/span>/);
  assert.match(tile, /<span>\{favorite\.favoriteCount\}<\/span>/);
  assert.doesNotMatch(tile, /Copy to My Decks<\/button>/);
});

test("Deck Library CSS keeps cards compact and places the Featured card fourth in the fan", async () => {
  const css = await read("components/routes/DeckRoutes.module.css");
  assert.match(css, /\.characterFanFeatured > :nth-child\(3\)\s*\{[^}]*left:\s*49%/s);
  assert.match(css, /\.characterFanFeatured > \.featuredPreviewCard\s*\{[^}]*right:\s*7%/s);
  assert.doesNotMatch(css, /\.characterFanFeatured > \.featuredPreviewCard\s*\{[^}]*left:\s*49%/s);
  assert.match(css, /\.factionSymbols img/);
  assert.match(css, /\.favoriteButton\[aria-pressed="true"\]/);
  assert.match(css, /grid-template-rows: 11\.25rem auto/);
  assert.doesNotMatch(css, /min-height: 2\.2em/);
});
