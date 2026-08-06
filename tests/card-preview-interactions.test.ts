import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const interactionCss = readFileSync(
  new URL("../app/card-preview-interactions.css", import.meta.url),
  "utf8",
);
const brawlCss = readFileSync(
  new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
  "utf8",
);
const previewLayerSource = readFileSync(
  new URL("../components/game-screen-v2/CardPreviewLayerImpl.tsx", import.meta.url),
  "utf8",
);

test("Batch effects restore pointer hit testing inside the non-interactive HUD", () => {
  assert.match(brawlCss, /\.batchHud\s*\{[\s\S]*?pointer-events:\s*none/);
  const selector = '[data-zone-kind="batch"] figure[data-card-id]';
  const start = interactionCss.indexOf(selector);
  assert.notEqual(start, -1);
  const block = interactionCss.slice(start, interactionCss.indexOf("}", start) + 1);
  assert.match(block, /pointer-events:\s*auto\s*!important/);
});

test("BakuCore previews use half of the original 23rem by 32vw footprint", () => {
  assert.match(interactionCss, /width:\s*min\(11\.5rem,\s*16vw\)\s*!important/);
  assert.match(interactionCss, /max-height:\s*min\(36dvh,\s*11\.5rem\)\s*!important/);
});

test("hand focus cannot own a preview after selection", () => {
  assert.match(
    previewLayerSource,
    /previewElementFromFocusTarget[\s\S]*?closest\('\[data-zone-kind="hand"\]'\)/,
  );
  assert.match(previewLayerSource, /onFocusIn[\s\S]*?previewElementFromFocusTarget\(event\.target\)/);
  assert.match(previewLayerSource, /onPointerOver[\s\S]*?previewElementFromTarget\(event\.target\)/);
});
