import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("View Deck reuses the library cover and established card artwork components", async () => {
  const view = await read("components/routes/DeckDetailPresentation.tsx");
  assert.ok(view.includes("<DeckPreview deck={deck} />"));
  assert.ok(view.includes("cardTileStyles.tile"));
  assert.ok(view.includes("cardTileStyles.artwork"));
  assert.ok(view.includes("<ResponsiveCardImage card={displayed}"));
  assert.ok(view.includes("<ResponsiveCardImage card={card}"));
  assert.ok(view.includes("<BakuCoreArt core={preferredCorePrinting("));
  assert.ok(view.includes("<CardFactionTag"));
  assert.ok(view.includes("<BakuganRollingStat"));
  assert.ok(!view.includes("CharacterFan"));
  assert.ok(!view.includes("DeckSharePanel"));
  assert.ok(!view.includes("RouteHero"));
});

test("View Deck shares card sizing across Team and type-grouped Main Deck", async () => {
  const [view, css] = await Promise.all([
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/routes/DeckDetail.module.css"),
  ]);
  assert.ok(css.includes("--view-card-width:168px"));
  assert.ok(css.includes("grid-template-columns:repeat(3,var(--view-card-width))"));
  assert.ok(css.includes("grid-template-columns:repeat(auto-fill,var(--view-card-width))"));
  assert.ok(css.includes("@container deck-body (max-width:580px)"));
  assert.ok(css.includes("grid-template-columns:var(--view-card-width) minmax(0,1fr)"));
  assert.ok(view.includes('const CARD_TYPES = ["Action", "Hero", "Evo", "Baku-Gear", "Flip"]'));
  assert.ok(view.includes('className={styles.quantity}'));
  assert.ok(view.includes(">×{quantity}</div>"));
  assert.ok(!view.includes("copyCount"));
  assert.ok(!view.includes("card.displayName}</strong>"));
});

test("Statistics uses composition, energy analysis and format legality, not completion meters", async () => {
  const view = await read("components/routes/DeckDetailPresentation.tsx");
  for (const part of ["Card Composition", "Energy Curve", "Average cost", "Most common cost", "Deck Legality"]) {
    assert.ok(view.includes(part), "Missing " + part);
  }
  assert.ok(!view.includes("Deck Completion"));
  assert.ok(view.includes("deckEnergyCurve(deck)"));
  assert.ok(view.includes("legalDeckFormats(deck, restrictions, competitiveSize)"));
  assert.ok(view.includes('format !== "competitive"'));
  assert.ok(view.includes("report.issues.map"));
});

test("Mobile statistics and sharing are accessible dialogs with contextual links", async () => {
  const [view, css] = await Promise.all([
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/routes/DeckDetail.module.css"),
  ]);
  assert.ok(view.includes('role="dialog" aria-modal="true"'));
  assert.ok(view.includes('event.key === "Escape"'));
  assert.ok(view.includes('event.key !== "Tab"'));
  assert.ok(view.includes('document.body.style.overflow = "hidden"'));
  assert.ok(view.includes("publicView && <button"));
  assert.ok(view.includes("Copy Deck Link"));
  assert.ok(view.includes("Copy Deck Code"));
  assert.ok(view.includes("Export Text List"));
  assert.ok(view.includes("Export Image"));
  assert.ok(css.includes(".statsSidebar{display:none}"));
  assert.ok(css.includes(".mobileStats{display:flex"));
  assert.ok(css.includes("height:100dvh"));
});

test("Deck Details keeps management actions out of the Stats panel", async () => {
  const [personal, publicView, view, shared] = await Promise.all([
    read("components/routes/DeckDetailScreen.tsx"),
    read("components/routes/PublicDeckDetailScreen.tsx"),
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  for (const label of ["Edit Deck", "Duplicate Deck", "Showcase on Profile", "Delete Deck"]) {
    assert.ok(personal.includes(label), "Missing " + label);
  }
  for (const label of ["Copy to My Decks", "Favorite", "Edit as Administrator", "Delete Public Deck"]) {
    assert.ok(publicView.includes(label), "Missing " + label);
  }
  assert.ok(view.includes("Share / Export"));
  assert.ok(view.includes("menuActions"));
  assert.ok(!shared.includes(".detailHero"));
  assert.ok(!shared.includes(".detailLayout"));
  assert.ok(!shared.includes(".sharePanel"));
});
