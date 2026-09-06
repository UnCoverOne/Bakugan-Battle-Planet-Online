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

test("card-art presentation has one semantic physical/readable transform", () => {
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
