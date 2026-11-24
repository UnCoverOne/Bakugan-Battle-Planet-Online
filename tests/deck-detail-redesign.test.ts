import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");

test("View Deck uses the same preview as Deck Library in a full-width details header", async () => {
  const [view, library] = await Promise.all([
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/routes/DeckGalleryCard.tsx"),
  ]);
  assert.match(library, /export function DeckPreview/);
  assert.match(view, /<DeckPreview deck=\{deck\} \/>/);
  assert.ok(view.indexOf("className={styles.deckHeader}") < view.indexOf("className={styles.contentLayout}"));
  assert.doesNotMatch(view, /CharacterFan|DeckSharePanel|RouteHero/);
});

test("View Deck presents paired BakuCores and all main card types in order", async () => {
  const view = await read("components/routes/DeckDetailPresentation.tsx");
  assert.match(view, /const cardTypes = \["Action", "Hero", "Evo", "Baku-Gear", "Flip"\]/);
  assert.match(view, /pairedCoreIds\[index\]\?\.\[offset\]/);
  assert.match(view, /remainingCores\.splice\(index, 1\)/);
  assert.match(view, /Unassigned BakuCores/);
  assert.match(view, /preferredCorePrinting/);
  assert.match(view, /preferredCardPrinting/);
  assert.match(view, /const sections = cardTypes\.map/);
  assert.match(view, /<CardInspector/);
});

test("Statistics are sticky on desktop and a keyboard-managed full-screen dialog on mobile", async () => {
  const [view, css] = await Promise.all([
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/routes/DeckDetail.module.css"),
  ]);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /statsClose\.current\?\.focus\(\)/);
  assert.match(view, /event\.key === "Escape"/);
  assert.match(view, /event\.shiftKey/);
  assert.match(view, /statsTrigger\.current\?\.focus\(\)/);
  assert.match(css, /\.statsAside\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.statsOverlay\s*\{[^}]*position:\s*fixed;\s*inset:\s*0/);
  assert.match(css, /height:\s*100dvh/);
});

test("Personal and public actions retain ownership and the shared export tools", async () => {
  const [personal, community, shared] = await Promise.all([
    read("components/routes/DeckDetailScreen.tsx"),
    read("components/routes/PublicDeckDetailScreen.tsx"),
    read("components/routes/DeckDetailPresentation.tsx"),
  ]);
  assert.match(personal, /primaryAction=\{/);
  assert.match(personal, /Edit Deck/);
  assert.match(community, /Copy to My Decks/);
  assert.match(community, /favorite-deck/);
  assert.match(community, /Edit as Administrator/);
  for (const action of ["Copy link", "Copy deck code", "Export text list", "Export deck image"]) {
    assert.ok(shared.includes(action));
  }
});

test("Dead deck-detail presentation rules and exports are removed", async () => {
  const [shared, library] = await Promise.all([
    read("components/routes/DeckRoutes.module.css"),
    read("components/routes/DeckLibraryPresentation.tsx"),
  ]);
  assert.doesNotMatch(shared, /\.detailHero|\.detailTeam|\.coreStrip|\.sharePanel|\.energyChart|\.characterFan/);
  assert.doesNotMatch(library, /function CharacterFan|function DeckFactionTags/);
});
