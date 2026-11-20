import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEVELOPER_RULINGS, RULING_CATEGORIES } from "../lib/developer-rulings";
import { rulingMatchLocation, rulingTranscriptBlocks } from "../lib/rulings-reader";

const read = (path: string) => readFileSync(path, "utf8");
const get = (number: number) => {
  const ruling = DEVELOPER_RULINGS.find(entry => entry.number === number);
  assert.ok(ruling, "Missing source ruling Q" + number);
  return ruling;
};

test("the complete published ruling archive keeps its original numbering and seven topics", () => {
  assert.equal(DEVELOPER_RULINGS.length, 52);
  assert.equal(RULING_CATEGORIES.length, 7);
  const numbers = DEVELOPER_RULINGS.map(ruling => ruling.number);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.deepEqual([5, 14, 26].filter(n => !numbers.includes(n)), [5, 14, 26]);
  assert.equal(Math.max(...numbers), 55);
  for (const ruling of DEVELOPER_RULINGS) {
    assert.equal(ruling.slug, "q" + ruling.number);
    assert.ok(RULING_CATEGORIES.includes(ruling.category as typeof RULING_CATEGORIES[number]));
    assert.ok(ruling.preview.trim());
    assert.ok(ruling.transcript.trim());
  }
});

test("search preserves full summaries and identifies transcript-only or card-only hits", () => {
  assert.equal(rulingMatchLocation(get(3), ""), "visible");
  assert.equal(rulingMatchLocation(get(3), "Gear-reducing BakuCores"), "visible");
  assert.equal(rulingMatchLocation(get(3), "Baku-Gear & BakuCores"), "visible");
  assert.equal(rulingMatchLocation(get(3), "Q3"), "visible");
  assert.equal(rulingMatchLocation(get(3), "My response here was inaccurate"), "source");
  assert.equal(rulingMatchLocation(get(1), "dragonoid maximus"), "visible");
  const cardOnly = DEVELOPER_RULINGS.find(ruling => ruling.mentionedCards.some(name =>
    ![ruling.title, ruling.preview, ruling.category, ruling.transcript].some(text =>
      text.toLowerCase().includes(name.toLowerCase()))));
  if (cardOnly) {
    const name = cardOnly.mentionedCards.find(value =>
      ![cardOnly.title, cardOnly.preview, cardOnly.category, cardOnly.transcript].some(text =>
        text.toLowerCase().includes(value.toLowerCase())));
    assert.ok(name);
    assert.equal(rulingMatchLocation(cardOnly, name), "cards");
  }
  assert.equal(rulingMatchLocation(get(3), "nonmatching_9876"), null);
});

test("corrected developer responses remain intact and distinguishable in the source modal", () => {
  for (const number of [1, 3]) {
    const ruling = get(number);
    const blocks = rulingTranscriptBlocks(ruling);
    assert.ok(blocks.some(block => block.kind === "response"), "Missing initial response Q" + number);
    assert.ok(blocks.some(block => block.kind === "correction"), "Missing correction Q" + number);
    assert.equal(blocks.map(block => block.text).join("\n\n"),
      ruling.transcript.split(/\n\s*\n/).filter(Boolean).map(part => part.trim()).join("\n\n"));
  }
  assert.match(get(1).preview, /named Dan Kouzo, Wynton Styles and Lia Venegas/);
  assert.match(get(3).preview, /only the next Baku-Gear/);
  assert.ok(rulingTranscriptBlocks(get(3)).some(block =>
    block.kind === "correction" && block.text.includes("My response here was inaccurate")));
});

test("Rulings UI is a frameless summary-first reference with accessible source modal", () => {
  const view = read("components/routes/RulingsReference.tsx");
  const css = read("components/routes/RulingsReference.module.css");
  const chrome = read("components/routes/ReferenceChrome.module.css");
  const parent = read("components/routes/CompendiumScreen.tsx");
  assert.match(view, /<ContentsNavigation onNavigate=\{sidebarOpen \? onSidebarClose : undefined\}/);
  assert.match(view, /id=\{sectionId\(name\)\}/);
  assert.match(view, /id=\{"ruling-" \+ ruling.slug\}/);
  assert.match(view, /<h3>\{highlightText\(ruling.title, normalized\)\}<\/h3>/);
  assert.match(view, /<p>\{highlightText\(ruling.preview, normalized\)\}<\/p>/);
  assert.match(view, /Q\{ruling.number\}/);
  assert.match(view, /onCopy\("\/compendium\/rulings#ruling-" \+ ruling.slug/);
  assert.match(view, /View source Q&amp;A/);
  assert.match(view, /Match in source Q&amp;A/);
  assert.match(view, /role="dialog" aria-modal="true"/);
  assert.match(view, /event.key === "Tab"/);
  assert.match(view, /event.key === "Escape"/);
  assert.match(view, /if \(returnTo\?\.isConnected\) returnTo.focus\(\)/);
  assert.match(view, /data-source-match/);
  assert.match(view, /Related cards/);
  assert.match(parent, /notify\("Unable to copy link\."\)/);
  assert.doesNotMatch(view, /Details<\/button>|Copy link<\/button>|<details/);
  assert.doesNotMatch(css, /clip-path|linear-gradient|\.article:target\s*\{[^}]*outline/);
  assert.doesNotMatch(chrome, /searchPanel|clip-path|linear-gradient/);
  assert.match(css, /\.article:target\s*\{[^}]*background: var\(--bb-panel-inset\)/);
  assert.match(css, /grid-template-columns: 2.4rem minmax\(0, 1fr\)/);
  assert.match(css, /height: 100dvh/);
});
