import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Select Your Deck keeps tags, title, and description in separate styled rows", async () => {
  const css = await read("app/(workspace)/play/presentation-fix.module.css");
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
  assert.match(css, /span:nth-child\(2\)[\s\S]*?grid-row:\s*1/);
  assert.match(css, /> strong\)[\s\S]*?grid-row:\s*2/);
  assert.match(css, /span:last-child:not\(:first-child\)[\s\S]*?grid-row:\s*3/);
  assert.match(css, /span:nth-child\(2\) > span\)[\s\S]*?text-transform:\s*uppercase[\s\S]*?clip-path:/);
});

test("desktop Deck Builder header pins to the top of the builder viewport below site navigation", async () => {
  const [page, css] = await Promise.all([
    read("app/(workspace)/builder/[id]/page.tsx"),
    read("app/(workspace)/builder/[id]/presentation-fix.module.css"),
  ]);
  assert.match(page, /className=\{styles\.builderScope\}/);
  assert.match(css, /\.builderScope\s*\{[^}]*height:\s*calc\(100dvh - 76px\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /header:first-child\)[^}]*top:\s*0\s*!important/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?height:\s*auto/);
});

test("Save Deck shows only the current Featured Card and opens a dedicated selection dialog", async () => {
  const [page, bridge, bridgeCss, presentationCss] = await Promise.all([
    read("app/(workspace)/builder/[id]/page.tsx"),
    read("components/routes/DeckBuilderPresentationBridge.tsx"),
    read("components/routes/DeckBuilderPresentationBridge.module.css"),
    read("app/(workspace)/builder/[id]/presentation-fix.module.css"),
  ]);
  assert.match(page, /DeckBuilderPresentationBridge/);
  assert.match(bridge, /data-featured-card-picker/);
  assert.match(bridge, /aria-label="Select Featured Card"/);
  assert.match(bridge, /createPortal/);
  assert.match(bridge, /option\.source\.click\(\)/);
  assert.match(bridge, /stopImmediatePropagation\(\)/);
  assert.match(presentationCss, /button\[aria-pressed="true"\][\s\S]*?display:\s*grid\s*!important/);
  assert.match(presentationCss, /button\)\s*\{\s*display:\s*none\s*!important/);
  assert.match(bridgeCss, /\.backdrop\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*1450/s);
  assert.match(bridgeCss, /\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/s);
});
