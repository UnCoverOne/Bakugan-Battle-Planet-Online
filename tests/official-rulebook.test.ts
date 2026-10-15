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
