import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OFFICIAL_RULEBOOK } from "../lib/official-rulebook";

test("official Battle Planet rulebook retains all nine numbered chapters and their sections", () => {
  assert.equal(OFFICIAL_RULEBOOK.length, 9);
  assert.deepEqual(OFFICIAL_RULEBOOK.map((chapter) => chapter.text), [
    "Game Concepts", "Parts of a Card", "Card Types", "Zones", "Turn Structure",
    "Playing Cards, Abilities, and Effects", "Additional Rules", "Multiplayer Rules", "Cardless Rules (basic game)",
  ]);
  assert.equal(OFFICIAL_RULEBOOK[0].children[1].text, "Deck Construction");
  assert.equal(OFFICIAL_RULEBOOK[0].children[1].children[0].children[0].text,
    "Cards that have the same name and same ability text but differ in some other way are still considered to be the same card for deck construction.");
  assert.equal(OFFICIAL_RULEBOOK[4].children[11].text, "Team Attack");
});

test("rulebook integration exposes keyword explanations, anchors, searchable rules and errata", () => {
  const screen = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  const parent = readFileSync("components/routes/CompendiumScreen.tsx", "utf8");
  assert.match(parent, /<OfficialRulebook query=/);
  for (const feature of ["rule-", "section-", "chapter-", "Card errata", "onTerm"]) {
    assert.ok(screen.includes(feature), `Missing ${feature}`);
  }
});

test("Printed Icons remain in Glossary and keep Compendium styling", () => {
  const reader = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  const glossary = readFileSync("components/routes/GlossaryScreen.tsx", "utf8");
  const css = readFileSync("components/routes/GlossaryScreen.module.css", "utf8");
  assert.ok(!reader.includes("SYMBOL_ENTRIES"));
  assert.ok(!reader.includes('href="#rulebook-icons"'));
  assert.ok(!glossary.includes('id="glossary-introduction"'));
  assert.ok(glossary.indexOf('id="glossary-icons"') < glossary.indexOf('{byLetter.length'));
  assert.ok(glossary.includes('SYMBOL_ENTRIES.map((symbol)'));
  for (const token of ["--brand-blue-bright", "--text-primary", "--chamfer-panel", ".iconGrid"]) {
    assert.ok(css.includes(token), `Expected matching styling: ${token}`);
  }
});

test("rulebook stays inside centred Compendium reference layout", () => {
  const screen = readFileSync("components/routes/CompendiumScreen.tsx", "utf8");
  const reader = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  const layout = readFileSync("components/routes/CompendiumScreen.module.css", "utf8");
  assert.match(screen, /className=\{styles\.rulebookFrame\}><OfficialRulebook/);
  assert.match(reader, /data-rulebook-reader/);
  assert.match(layout, /\.rulebookFrame\s*\{/);
  assert.match(layout, /grid-template-columns:\s*minmax\(12rem,\s*13\.75rem\) minmax\(0,\s*1fr\)/);
});

test("glossary has its own Compendium tab and deep-linkable thematic reference", () => {
  const route = readFileSync("lib/compendium-navigation.ts", "utf8");
  const compendium = readFileSync("components/routes/CompendiumScreen.tsx", "utf8");
  const glossary = readFileSync("components/routes/GlossaryScreen.tsx", "utf8");
  const css = readFileSync("components/routes/GlossaryScreen.module.css", "utf8");
  const rules = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  assert.match(route, /glossary: "\/compendium\/glossary"/);
  assert.match(compendium, /<GlossaryScreen query=/);
  assert.match(compendium, />GLOSSARY<\/button>/);
  assert.ok(!rules.includes('id="rulebook-glossary"'));
  for (const feature of ["OFFICIAL_RULEBOOK", "GLOSSARY_ENTRIES", "glossary-letter-", "glossary-", "/compendium/rules#section-", 'role="dialog"']) assert.ok(glossary.includes(feature), feature);
  for (const token of ["--content-wide", "--brand-blue-bright", "--chamfer-panel"]) {
    const frame = readFileSync("components/routes/CompendiumScreen.module.css", "utf8");
    assert.ok((css + frame).includes(token), token);
  }
});

test("Rules navigation has no glossary link or introduction, and errata follows all chapters", () => {
  const screen = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  assert.ok(!screen.includes('id="rulebook-introduction"'));
  assert.ok(!screen.includes('<a href="/compendium/glossary"'));
  assert.ok(screen.indexOf('id="rulebook-errata"') > screen.indexOf('id={`chapter-${i + 1}`}'));
  assert.ok(screen.includes('href="#rulebook-errata"'));
});

test("one global archive search powers every Compendium tab", () => {
  const parent = readFileSync("components/routes/CompendiumScreen.tsx","utf8");
  const rules = readFileSync("components/routes/OfficialRulebook.tsx","utf8");
  const glossary = readFileSync("components/routes/GlossaryScreen.tsx","utf8");
  const rulings = readFileSync("components/routes/RulingsReference.tsx","utf8");
  assert.equal(parent.split('label="Search the archive"').length - 1, 1);
  for (const component of [rules,glossary,rulings]) {
    assert.ok(!component.includes('type="search"'));
  }
  for (const tag of ["OfficialRulebook","GlossaryScreen","RulingsReference"]) {
    assert.match(parent, new RegExp("<" + tag + " query=\\{deferredSearchQuery\\}"));
  }
});

test("glossary hides Copy Link and keeps lone entries in uniform grid columns", () => {
  const view = readFileSync("components/routes/GlossaryScreen.tsx", "utf8");
  const css = readFileSync("components/routes/GlossaryScreen.module.css", "utf8");
  assert.ok(!view.includes("Copy link"));
  assert.match(css, /\.entries\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,280px\),1fr\)\)/);
});

test("glossary curates previews without shortening Details and excludes retired terms", () => {
  const view = readFileSync("components/routes/GlossaryScreen.tsx", "utf8");
  assert.ok(view.includes('entry.title === "Costs" ? "Cost"'));
  assert.ok(view.includes("excludedTitles.has(entry.title)"));
  assert.ok(view.includes("keepComplete.has(entry.title)"));
  assert.ok(view.includes("item.preview"));
  assert.ok(view.includes("selected.definition"));
  assert.ok(view.includes('"B-Power","Bakugan","Legal Text"'));
});
