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
  for (const feature of ["rulebook-introduction", "rulebook-glossary", "rulebook-icons", "rule-", "section-", "chapter-", "Card errata", "onTerm"]) {
    assert.ok(screen.includes(feature), `Missing ${feature}`);
  }
});

test("Printed Icons remain visible first and the reader inherits the Compendium theme", () => {
  const reader = readFileSync("components/routes/OfficialRulebook.tsx", "utf8");
  const css = readFileSync("components/routes/OfficialRulebook.module.css", "utf8");
  assert.ok(reader.indexOf('id="rulebook-icons"') < reader.indexOf('id="rulebook-introduction"'));
  assert.ok(reader.includes('SYMBOL_ENTRIES.map((symbol)'));
  assert.ok(!reader.includes("showIcons"));
  for (const token of ["--brand-blue-bright", "--text-primary", "--text-secondary", "--chamfer-panel", "--content-wide"]) {
    assert.ok(css.includes(token), `Expected shared theme token: ${token}`);
  }
});
