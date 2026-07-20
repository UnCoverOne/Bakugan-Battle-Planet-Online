import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../app/gameplay-card-presentation.css", import.meta.url),
  "utf8",
);

const layer = readFileSync(
  new URL("../components/game-screen-v2/GameplayCardPresentationLayer.tsx", import.meta.url),
  "utf8",
);

test("discard browser is approximately twenty percent narrower at desktop and mobile scales", () => {
  assert.match(css, /width:\s*min\(54\.4rem,\s*calc\(80vw\s*-\s*1\.6rem\)\)\s*!important/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*width:\s*calc\(80vw\s*-\s*0\.8rem\)\s*!important/);
});

test("Flip cards fill the same vertical hand silhouette as regular cards", () => {
  assert.match(css, /li\[data-card-type="Flip"\][\s\S]*width:\s*140%\s*!important/);
  assert.match(css, /aspect-ratio:\s*7\s*\/\s*5\s*!important/);
  assert.match(css, /rotate\(90deg\)\s*!important/);
  assert.match(layer, /element\.dataset\.cardType\s*=\s*card\.type/);
});

test("Evo presentation uses the top Evo as the Character-zone preview identity", () => {
  assert.match(layer, /bakugan\.evoStack\.at\(-1\)\s*\?\?\s*bakugan\.character/);
  assert.match(layer, /zone\.dataset\.cardId\s*=\s*topCard\.id/);
  assert.match(layer, /bakugan\.evoStack\.map/);
});
