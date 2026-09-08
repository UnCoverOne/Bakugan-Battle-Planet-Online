import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cardArtSource, isFlipCardType } from "../lib/content/card-art";
import { CARDS } from "../lib/data";

function webpContract(source: string) {
  const pathname = source.split("?", 1)[0];
  const bytes = readFileSync(path.join(process.cwd(), "public", pathname));
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${source} must be RIFF WebP`);
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${source} must be WebP`);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (chunk === "VP8X") {
      return {
        alpha: Boolean(bytes[offset + 8] & 0x10),
        width: 1 + bytes.readUIntLE(offset + 12, 3),
        height: 1 + bytes.readUIntLE(offset + 15, 3),
      };
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error(`${source} is missing the extended WebP contract chunk`);
}

test("every Flip-family scan uses one transparent portrait asset contract", () => {
  const cards = CARDS.filter((card) => isFlipCardType(card.type));
  assert.equal(cards.length, 133);
  for (const card of cards) {
    const full = webpContract(cardArtSource(card, "full"));
    const thumbnail = webpContract(cardArtSource(card, "thumbnail"));
    assert.equal(full.alpha, true, `${card.catalogId} full artwork must preserve transparency`);
    assert.ok(full.width >= 320 && full.height >= 448, `${card.catalogId} full artwork is unexpectedly small`);
    assert.ok(Math.abs(full.width / full.height - 5 / 7) < 0.035, `${card.catalogId} full artwork must be portrait`);
    assert.deepEqual(
      { width: thumbnail.width, height: thumbnail.height, alpha: thumbnail.alpha },
      { width: 160, height: 224, alpha: true },
      `${card.catalogId} thumbnail artwork`,
    );
  }
});

test("card-art presentation keeps the compact readable Flip fallback", () => {
  const component = readFileSync(
    new URL("../components/cards/CardArt.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../components/cards/CardArt.module.css", import.meta.url),
    "utf8",
  );
  assert.match(component, /fingerprintedAsset\(src\)/);
  assert.match(component, /isFlipCardType\(cardType\)/);
  assert.match(css, /data-card-art-presentation="readable"/);
  assert.match(css, /data-card-art-kind="flip"/);
  assert.match(css, /rotate:\s*-90deg/);
  assert.match(css, /scale:\s*0\.7142857143/);
});

test("large responsive card presentations avoid thumbnail upscaling and transform scaling", () => {
  const responsive = readFileSync(
    new URL("../components/cards/ResponsiveCardImage.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../components/cards/CardArt.module.css", import.meta.url),
    "utf8",
  );

  assert.match(
    responsive,
    /presentation === "thumbnail"\s*\? cardArtSource\(card, "thumbnail"\)\s*:\s*cardArtSource\(card, "full"\)/,
  );
  assert.match(responsive, /data-responsive-card-presentation=\{presentation\}/);

  assert.match(
    css,
    /data-responsive-card-presentation="tile"[\s\S]*?width:\s*71\.8%;[\s\S]*?scale:\s*1;/,
  );
  assert.match(
    css,
    /data-responsive-card-presentation="inspector"[\s\S]*?aspect-ratio:\s*500\s*\/\s*359;[\s\S]*?scale:\s*1;/,
  );
  assert.match(
    css,
    /aria-label\$=" copies"[\s\S]*?aspect-ratio:\s*500\s*\/\s*359;[\s\S]*?scale:\s*1;/,
  );
});

test("deck-detail Flip cards are explicitly centered and copy badges straddle the art edge", () => {
  const css = readFileSync(
    new URL("../components/cards/CardArt.module.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /data-card-art-kind="flip"[\s\S]*?aria-label\$=" copies"[\s\S]*?>\s*img\.image[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?translate:\s*-50%\s+-50%;/,
  );
  assert.match(
    css,
    />\s*span\[aria-label\$=" copies"\][\s\S]*?left:\s*50%;[\s\S]*?right:\s*auto;[\s\S]*?bottom:\s*0;[\s\S]*?translate:\s*-50%\s+50%;/,
  );
  assert.match(css, /background:\s*rgba\(0,\s*0,\s*0,\s*\.72\);/);
  assert.match(
    css,
    />\s*span\[aria-label\$=" copies"\][\s\S]*?height:\s*1\.5rem;[\s\S]*?min-height:\s*1\.5rem;[\s\S]*?padding:\s*0\s+\.55rem;[\s\S]*?border-radius:\s*\.3rem;/,
  );
});