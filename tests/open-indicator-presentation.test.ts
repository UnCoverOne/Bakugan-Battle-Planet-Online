import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("OPEN is a real Character status overlay above single and stacked Evos", () => {
  const presentation = read("components/game-screen-v2/GameplayCardPresentationLayer.tsx");
  const presentationCss = read("components/game-screen-v2/GameplayCardPresentationLayer.module.css");
  const selectionCss = read("components/game-screen-v2/SelectionInteractionLayer.module.css");
  const globalPresentationCss = read("app/gameplay-card-presentation.css");

  assert.match(presentation, /if \(bakugan\.evoStack\.length \|\| bakugan\.open\)/);
  assert.match(presentation, /bakugan\.evoStack\.map\(/);
  assert.match(presentation, /className=\{styles\.openIndicator\}/);
  assert.match(presentation, /data-character-open-indicator="true"/);
  assert.match(presentation, /aria-hidden="true"[\s\S]*OPEN/);

  assert.match(globalPresentationCss, /--character-evo-layer:\s*120;/);
  assert.match(globalPresentationCss, /--character-status-layer:\s*130;/);
  assert.match(
    presentationCss,
    /\.evoStack\s*\{[\s\S]*z-index:\s*var\(--character-evo-layer,\s*120\);/,
  );
  assert.match(
    presentationCss,
    /\.openIndicator\s*\{[\s\S]*z-index:\s*var\(--character-status-layer,\s*130\);/,
  );

  assert.doesNotMatch(selectionCss, /content:\s*"OPEN"/);
  assert.doesNotMatch(globalPresentationCss, /\[data-character-open(?:=|\])/);
  assert.doesNotMatch(
    globalPresentationCss,
    /\[data-zone-kind="character-card"\]\s*>\s*\[data-evo-stack="true"\]\s*\{[\s\S]*z-index:\s*120/,
  );
});
