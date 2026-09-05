import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../app/gameplay-card-presentation.css", import.meta.url),
  "utf8",
);

const handCss = readFileSync(
  new URL("../components/game-screen-v2/CardHandLayer.module.css", import.meta.url),
  "utf8",
);

const layer = readFileSync(
  new URL("../components/game-screen-v2/GameplayCardPresentationLayer.tsx", import.meta.url),
  "utf8",
);
const layerCss = readFileSync(
  new URL("../components/game-screen-v2/GameplayCardPresentationLayer.module.css", import.meta.url),
  "utf8",
);
const cardArt = readFileSync(
  new URL("../components/cards/CardArt.tsx", import.meta.url),
  "utf8",
);
const cardArtCss = readFileSync(
  new URL("../components/cards/CardArt.module.css", import.meta.url),
  "utf8",
);

test("discard browser is approximately twenty percent narrower at desktop and mobile scales", () => {
  assert.match(css, /width:\s*min\(54\.4rem,\s*calc\(80vw\s*-\s*1\.6rem\)\)\s*!important/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*width:\s*calc\(80vw\s*-\s*0\.8rem\)\s*!important/);
});

test("Flip cards fill the same vertical hand silhouette as regular cards", () => {
  assert.match(cardArt, /presentation\s*=\s*"physical"/);
  assert.match(cardArt, /data-card-art-presentation=\{presentation\}/);
  assert.match(cardArtCss, /data-card-art-presentation="readable"/);
  assert.match(cardArtCss, /rotate:\s*-90deg/);
  assert.match(cardArtCss, /scale:\s*0\.7142857143/);
  assert.doesNotMatch(css, /data-art-orientation/);
  assert.match(layer, /element\.dataset\.cardType\s*=\s*card\.type/);
});

test("cards that cannot be played remain at full visual opacity", () => {
  const nonActionableRule = handCss.match(
    /\.playerHandLayer\[data-action-mode\][\s\S]*?\.handCard\[data-actionable="false"\][\s\S]*?\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  assert.doesNotMatch(nonActionableRule, /opacity\s*:\s*(?:0|\.[0-9])/);
  assert.doesNotMatch(handCss, /data-actionable="false"[^}]*grayscale/);
});

test("the active Character halo is drawn on the unclipped slot", () => {
  assert.match(layer, /slot\.dataset\.characterActive\s*=\s*active\s*\?\s*"true"\s*:\s*"false"/);
  assert.match(layer, /slot\.dataset\.faction\s*=\s*bakugan\.faction/);
  assert.match(css, /\[data-character-slot\]::after[\s\S]*aspect-ratio:\s*5\s*\/\s*7/);
  assert.match(css, /data-character-slot\]\[data-character-active="true"\]::after[\s\S]*box-shadow/);
  assert.doesNotMatch(css, /data-zone-kind="character-card"\]\[data-character-active="true"\][\s\S]*box-shadow/);
  for (const faction of ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]) {
    assert.match(css, new RegExp(`data-faction="${faction}"`));
  }
});

test("Haos uses a light-blue active Character glow", () => {
  const haosRule = css.match(
    /data-faction="Haos"\][\s\S]*?\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  assert.match(haosRule, /rgba\(189,\s*232,\s*255/);
  assert.match(haosRule, /rgba\(92,\s*188,\s*255/);
});

test("Evo presentation hides the base Character and owns the top layer", () => {
  assert.match(layer, /bakugan\.evoStack\.at\(-1\)\s*\?\?[\s\S]*bakugan\.fusionCharacter[\s\S]*\?\?\s*bakugan\.character/);
  assert.match(layer, /zone\.dataset\.cardId\s*=\s*topCard\.id/);
  assert.match(layer, /zone\.dataset\.evoCount\s*=\s*String\(bakugan\.evoStack\.length\)/);
  assert.match(layer, /bakugan\.evoStack\.map/);
  assert.match(css, /data-evo-count\]:not\(\[data-evo-count="0"\]\)\s*>\s*img[\s\S]*visibility:\s*hidden\s*!important/);
  assert.match(layerCss, /\.evoStack[\s\S]*z-index:\s*var\(--character-evo-layer,\s*120\)/);
});
