import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deckRouteSource } from "./route-source";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Deck library starts with accessible section navigation, without a large page hero", async () => {
  const [route, css] = await Promise.all([deckRouteSource(), read("components/routes/DeckLibrary.module.css")]);
  assert.match(route, /function DeckLibraryHeader/);
  assert.match(route, /<h1 className=\{library\.srOnly\}>/);
  assert.match(route, /My Decks/);
  assert.match(route, /Public Decks/);
  assert.match(route, /New Deck/);
  assert.match(route, /Import deck code/);
  assert.match(css, /\.grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(route, /DeckAreaHeader|Selected for Play|Select for Play/);
});

test("Shared preview retains three vertically stacked portraits beside a featured card", async () => {
  const [component, css, route] = await Promise.all([
    read("components/routes/DeckGalleryCard.tsx"),
    read("components/routes/DeckGalleryCard.module.css"),
    deckRouteSource(),
  ]);
  assert.match(component, /function DeckPreview/);
  assert.match(component, /className=\{styles\.portraits\}/);
  assert.match(component, /Array\.from\(\{ length: 3 \}/);
  assert.match(component, /const featured = deckLeadCard\(deck\)/);
  assert.match(component, /className=\{styles\.featuredCard\}/);
  assert.match(css, /\.portraits\{display:grid;grid-template-rows:repeat\(3/);
  assert.equal((route.match(/<DeckGalleryBody/g) ?? []).length, 2);
});

test("Personal decks provide management actions but never select a deck for play", async () => {
  const [library, detail] = await Promise.all([
    read("components/routes/DeckLibraryScreen.tsx"),
    read("components/routes/DeckDetailScreen.tsx"),
  ]);
  const actions = library.slice(library.indexOf("function DeckTile"));
  for (const label of ["View", "Edit", "Duplicate", "Export text list", "Copy deck code", "Delete", "Showcase on Profile"]) {
    assert.match(actions, new RegExp(label));
  }
  assert.doesNotMatch(library + detail, /selectedDeckId|setSelectedDeckId|Select for Play|Selected for Play/);
});

test("Public deck cards retain creator identity and accessible favorites", async () => {
  const [publicLibrary, gallery] = await Promise.all([
    read("components/routes/PublicDeckLibraryScreen.tsx"),
    read("components/routes/DeckGalleryCard.tsx"),
  ]);
  assert.match(publicLibrary, /function PublicDeckTile/);
  assert.match(publicLibrary, /title="Copy to My Decks"/);
  assert.match(publicLibrary, /onLike=\{favoriteAvailable \? onFavorite : undefined\}/);
  assert.match(gallery, /DeckCreatorIdentity/);
  assert.match(gallery, /aria-pressed=\{liked\}/);
});

test("Obsolete deck library selection styles are removed", async () => {
  const [legacy, library] = await Promise.all([
    read("components/routes/DeckRoutes.module.css"),
    read("components/routes/DeckLibrary.module.css"),
  ]);
  assert.doesNotMatch(legacy, /\.deckCardSelected\s*\{|\.selectedBanner\s*\{|\.deckGrid_list\s*\{/);
  assert.match(library, /\.card\{/);
  assert.match(library, /\.filterPanel\{/);
});
