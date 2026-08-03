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
