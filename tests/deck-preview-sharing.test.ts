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
  assert.match(exporter, /const WIDTH = 2200;/);
  assert.match(exporter, /const TEAM_RAIL_WIDTH = 460;/);
  assert.match(exporter, /const CONTENT_LEFT = OUTER \+ TEAM_RAIL_WIDTH \+ CONTENT_GUTTER;/);
  assert.match(exporter, /context\.fillText\("TEAM", OUTER, 78\);/);
  assert.match(exporter, /MAIN DECK/);
  assert.match(exporter, /FLIP CARDS/);
  assert.doesNotMatch(exporter, /CHARACTER CARDS/);
  assert.doesNotMatch(exporter, /BAKUCORES/);
  assert.doesNotMatch(exporter, /Multiple copies are grouped into a single card\./);
  assert.doesNotMatch(exporter, /Shown at full card size in landscape orientation\./);
  assert.match(exporter, /const unusedCores = \[\.\.\.cores\];/);
  assert.match(exporter, /item\?\.character\.coreTypes/);
  assert.match(exporter, /unusedCores\.findIndex\(\(core\) => core\?\.type === type\)/);
  assert.match(exporter, /const teamGroupX = OUTER \+ \(TEAM_RAIL_WIDTH - teamGroupWidth\) \/ 2;/);
  assert.match(exporter, /const coreX = characterX \+ teamCharacterWidth \+ teamImageGap;/);
  assert.match(exporter, /const coreY = y \+ coreIndex \* \(teamCoreSize \+ teamCoreGap\);/);
  assert.match(exporter, /const mainDeckCards = cards\.filter\(\(\{ card \}\) => !isFlipCardType\(card\.type\)\);/);
  assert.match(exporter, /const flipCards = cards\.filter\(\(\{ card \}\) => isFlipCardType\(card\.type\)\);/);
  assert.match(exporter, /const flipCardWidth = cardImageHeight;/);
  assert.match(exporter, /const flipCardHeight = cardWidth;/);
  assert.match(exporter, /Math\.min\(width \/ image\.naturalHeight, height \/ image\.naturalWidth\)/);
  assert.match(exporter, /drawContainedImage\(context, flipCardImages\[index\], x, y, flipCardWidth, flipCardHeight, true\);/);
  assert.doesNotMatch(exporter, /context\.scale\(5 \/ 7, 5 \/ 7\);/);
  assert.match(exporter, /const badgeWidth = 58;/);
  assert.match(exporter, /const badgeHeight = 32;/);
  assert.match(exporter, /const badgeX = x \+ \(width - badgeWidth\) \/ 2;/);
  assert.match(exporter, /const badgeY = y \+ height - badgeHeight \/ 2;/);
  assert.match(exporter, /context\.fillStyle = "rgba\(0, 0, 0, \.72\)";/);
  assert.match(exporter, /context\.strokeStyle = "rgba\(255, 255, 255, \.32\)";/);
  assert.match(exporter, /context\.fillText\(`×\$\{count\}`, x \+ width \/ 2, y \+ height\);/);
});
