import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../components/game-screen-v2/CardHandLayer.module.css", import.meta.url),
  "utf8",
);

test("hand hover inspection is not gated by primary pointer capabilities", () => {
  assert.match(css, /\.playerHandLayer \.handCard:hover \.handCardSurface/);
  assert.doesNotMatch(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
});

test("non-actionable hand cards retain the same hover lift and glow", () => {
  const selector = '.playerHandLayer[data-action-mode] .handCard[data-actionable="false"]:hover .handCardSurface';
  const start = css.indexOf(selector);
  assert.notEqual(start, -1);
  const block = css.slice(start, css.indexOf("}", start) + 1);
  assert.match(block, /translateY\(calc\(0px - var\(--hand-hover-lift\)\)\)/);
  assert.match(block, /drop-shadow/);
  assert.doesNotMatch(block, /transform:\s*none/);
});
