import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function firstLayer(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`, "s"));
  assert.ok(match, `Expected ${selector} to declare a numeric z-index`);
  return Number(match[1]);
}

test("portrait mobile Tips render below Roll Result and Brawl Preview", () => {
  const tipsCss = readFileSync(
    new URL("../components/game-screen-v2/SelectionInteractionLayer.module.css", import.meta.url),
    "utf8",
  );
  const brawlCss = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
    "utf8",
  );
  const rollCss = readFileSync(
    new URL("../components/game-screen-v2/RollResultLayer.module.css", import.meta.url),
    "utf8",
  );

  const portraitTips = tipsCss.match(
    /@media \(max-width: 760px\) and \(orientation: portrait\)[\s\S]*?\.actionTooltip\s*\{[^}]*z-index:\s*(\d+)/,
  );
  assert.ok(portraitTips, "Expected a portrait-mobile Tips layer override");

  const tipsLayer = Number(portraitTips[1]);
  const brawlLayer = firstLayer(brawlCss, ".brawlHud");
  const rollLayer = firstLayer(rollCss, ".backdrop");

  assert.ok(tipsLayer < brawlLayer, "Brawl Preview must paint above Tips");
  assert.ok(tipsLayer < rollLayer, "Roll Result must paint above Tips");
});


test("mobile Core Placement constrains BakuCore art and clips opaque front backgrounds", () => {
  const layerSource = readFileSync(
    new URL("../components/game-screen-v2/CorePlacementLayer.tsx", import.meta.url),
    "utf8",
  );
  const placementCss = readFileSync(
    new URL("../components/game-screen-v2/CorePlacementLayer.module.css", import.meta.url),
    "utf8",
  );
  const artCss = readFileSync(
    new URL("../components/bakucore/BakuCoreArt.module.css", import.meta.url),
    "utf8",
  );

  assert.match(layerSource, /className=\{styles\.trayCoreArt\}/);
  assert.doesNotMatch(layerSource, /width="150"\s+height="130"/);
  assert.match(
    placementCss,
    /\.trayCoreArt\s*\{[^}]*width:\s*3\.6rem;[^}]*height:\s*3\.1rem;/s,
  );
  assert.match(
    placementCss,
    /@media \(max-width: 700px\)[\s\S]*?\.trayCoreArt\s*\{[^}]*width:\s*100%;[^}]*height:\s*2\.4rem;/s,
  );
  assert.match(
    artCss,
    /\.image\s*\{[^}]*clip-path:\s*polygon\(24% 0,\s*76% 0,\s*100% 50%,\s*76% 100%,\s*24% 100%,\s*0 50%\)/s,
  );
});
