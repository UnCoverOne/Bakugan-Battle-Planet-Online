import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS } from "../lib/data";
import {
  deckEnergyCurve,
  deckExportFilename,
  groupedDeckCards,
} from "../lib/deck-presentation";

test("deck preview groups repeated cards and orders them by energy cost", () => {
  const candidates = CARDS
    .filter((card) => card.type !== "Character" && typeof card.cost === "number")
    .sort((left, right) => Number(left.cost) - Number(right.cost));
  assert.ok(candidates.length >= 2);
  const low = candidates[0];
  const high = candidates.find((card) => Number(card.cost) > Number(low.cost))!;
  const deck = { ...STARTER_DECKS[0], cardIds: [high.catalogId, low.catalogId, high.catalogId] };

  assert.deepEqual(
    groupedDeckCards(deck).map(({ card, count }) => [card.catalogId, count]),
    [[low.catalogId, 1], [high.catalogId, 2]],
  );
});

test("energy curve includes empty costs between zero and the deck maximum", () => {
  const candidates = CARDS.filter((card) => card.type !== "Character" && typeof card.cost === "number");
  const highest = candidates.reduce((current, card) => Number(card.cost) > Number(current.cost) ? card : current);
  const deck = { ...STARTER_DECKS[0], cardIds: [highest.catalogId, highest.catalogId] };
  const curve = deckEnergyCurve(deck);

  assert.equal(curve[0].label, "0");
  assert.equal(curve.at(-1)?.label, String(highest.cost));
  assert.equal(curve.at(-1)?.count, 2);
  assert.ok(curve.slice(0, -1).every((bucket) => bucket.count === 0));
});

test("deck export filenames are safe and predictable", () => {
  assert.equal(deckExportFilename("  Diamond Pegatrix Ultra!  ", "png"), "diamond-pegatrix-ultra.png");
  assert.equal(deckExportFilename("***", "txt"), "bakugan-deck.txt");
});

test("public preview exposes the complete sharing and export surface", async () => {
  const [route, exporter] = await Promise.all([
    readFile(new URL("../components/routes/DeckRoutes.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/deck-image-export.ts", import.meta.url), "utf8"),
  ]);
  for (const label of ["Copy to My Decks", "Copy Link", "Copy Code", "As a Text List", "As an Image", "Energy curve"]) {
    assert.match(route, new RegExp(label));
  }
  assert.match(exporter, /Created by/);
  assert.match(exporter, /CHARACTER CARDS/);
  assert.match(exporter, /BAKUCORES/);
  assert.match(exporter, /MAIN DECK/);
  assert.match(exporter, /badgeSize/);
});
