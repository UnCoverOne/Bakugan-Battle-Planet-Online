import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { OFFICIAL_RULEBOOK } from "../lib/official-rulebook";
import { SYMBOL_ENTRIES } from "../lib/reference";
import {
  filterGlossary, GLOSSARY_TERMS, GLOSSARY_SECTIONS, glossaryRuleHref, PRINTED_ICON_RULES,
} from "../lib/glossary";

const read = (path: string) => readFileSync(path, "utf8");

function ruleExists(id: string): boolean {
  let node = OFFICIAL_RULEBOOK[Number(id.split(".")[0]) - 1];
  if (!node) return false;
  for (const part of id.split(".").slice(1)) {
    node = node.children[Number(part) - 1];
    if (!node) return false;
  }
  return true;
}

test("official Battle Planet rulebook retains all nine numbered chapters", () => {
  assert.equal(OFFICIAL_RULEBOOK.length, 9);
  assert.deepEqual(OFFICIAL_RULEBOOK.map(chapter => chapter.text), [
    "Game Concepts", "Parts of a Card", "Card Types", "Zones", "Turn Structure",
    "Playing Cards, Abilities, and Effects", "Additional Rules", "Multiplayer Rules", "Cardless Rules (basic game)",
  ]);
  assert.equal(OFFICIAL_RULEBOOK[4].children[11].text, "Team Attack");
});

test("all 94 Glossary entries have definitions and working Rules anchors", () => {
  assert.equal(GLOSSARY_TERMS.length, 94);
  assert.equal(GLOSSARY_SECTIONS.length, 9);
  const keys = new Set<string>();
  for (const term of GLOSSARY_TERMS) {
    assert.ok(term.description.trim(), "Missing definition: " + term.title);
    assert.ok(ruleExists(term.rule), "Broken Rules link: " + term.title + " (" + term.rule + ")");
    assert.ok(!keys.has(term.key), "Duplicate Glossary anchor: " + term.key);
    keys.add(term.key);
    assert.match(glossaryRuleHref(term.rule), /^\/compendium\/rules#(?:section|rule)-\d+(?:\.\d+)+$/);
  }
  assert.ok(GLOSSARY_SECTIONS.includes("Fundamentals"));
  assert.ok(GLOSSARY_SECTIONS.includes("Keywords & Tag-Words"));
});

test("all 26 Printed Icons retain original artwork and Rules destinations", () => {
  assert.equal(SYMBOL_ENTRIES.length, 26);
  assert.equal(Object.keys(PRINTED_ICON_RULES).length, SYMBOL_ENTRIES.length);
  for (const symbol of SYMBOL_ENTRIES) {
    assert.ok(symbol.description.trim(), "Missing icon definition: " + symbol.name);
    assert.ok(symbol.asset.startsWith("/assets/symbols/"));
    assert.ok(existsSync("public" + symbol.asset), "Missing artwork: " + symbol.asset);
    assert.ok(ruleExists(PRINTED_ICON_RULES[symbol.token]), "Broken symbol Rules link: " + symbol.token);
  }
  assert.equal(glossaryRuleHref("7.3.1"), "/compendium/rules#rule-7.3.1");
  assert.equal(glossaryRuleHref("2.9"), "/compendium/rules#section-2.9");
});

test("global Glossary search filters symbols and terms while retaining categories", () => {
  const all = filterGlossary("");
  assert.equal(all.icons.length, SYMBOL_ENTRIES.length);
  assert.equal(all.groups.reduce((sum, group) => sum + group.items.length, 0), GLOSSARY_TERMS.length);
  const filtered = filterGlossary(" froststrike ");
  assert.ok(filtered.icons.some(icon => icon.name === "FrostStrike"));
  assert.ok(filtered.groups.flatMap(group => group.items).some(term => term.title === "FrostStrike"));
  assert.ok(filtered.groups.every(group => group.items.length > 0));
  const none = filterGlossary("glossary_nonexistent_token_987");
  assert.equal(none.icons.length, 0);
  assert.equal(none.groups.length, 0);
});

test("Glossary uses the shared Contents panel, frameless entries, and direct Rules links", () => {
  const view = read("components/routes/GlossaryScreen.tsx");
  const css = read("components/routes/GlossaryScreen.module.css");
  const parentCss = read("components/routes/CompendiumScreen.module.css");
  const parent = read("components/routes/CompendiumScreen.tsx");
  const toolbar = read("components/routes/CompendiumToolbar.tsx");
  assert.match(view, /<ContentsNavigation items=/);
  assert.match(view, /id: "glossary-icons", label: "Printed Icons"/);
  assert.match(view, /groups\.map\(\(\{ name, items \}\)/);
  assert.match(view, /<RuleLink title=\{symbol\.name\}/);
  assert.match(view, /<RuleLink rule=\{item\.rule\}/);
  assert.match(view, /<OriginalImage className=\{styles\.iconArtwork\}/);
  assert.match(parent, /<GlossaryScreen query=\{deferredSearchQuery\}/);
  assert.match(toolbar, /glossary: "Search terms…"/);
  assert.doesNotMatch(view, /role="dialog"|Details|Copy link|type="search"/);
  assert.doesNotMatch(css, /\.modal\b|\.backdrop\b|\.iconCard\b|clip-path|linear-gradient/);
  assert.doesNotMatch(parentCss, /data-rulebook-icons/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,165px\),1fr\)\)/);
  assert.match(css, /@media\\(max-width:700px\\)/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,104px\),1fr\)\)/);
  assert.match(css, /\.iconHeading h3 \{ font-size:\.79rem/);
  assert.match(css, /\.iconArtwork \{ width:28px; height:28px; \}/);
  assert.match(css, /border-bottom:1px solid var\(--bb-border-row\)/);
});

test("Rules view retains the anchors that Glossary links target", () => {
  const reader = read("components/routes/OfficialRulebook.tsx");
  assert.ok(reader.includes("section-"));
  assert.ok(reader.includes("rule-"));
  assert.ok(reader.includes("<ContentsNavigation items="));
  assert.ok(!reader.includes("SYMBOL_ENTRIES"));
});


test("Rules retain explanations, searchable nested anchors and errata", () => {
  const rules = read("components/routes/OfficialRulebook.tsx");
  const parent = read("components/routes/CompendiumScreen.tsx");
  assert.match(parent, /<OfficialRulebook query=/);
  for (const feature of ["rule-", "section-", "chapter-", "Card errata", "onTerm"]) {
    assert.ok(rules.includes(feature), "Missing rulebook feature: " + feature);
  }
  assert.ok(rules.indexOf('id="rulebook-errata"') > rules.indexOf('id={\`chapter-\${i + 1}\`}'));
  assert.ok(!rules.includes('id="rulebook-introduction"'));
});

test("existing Compendium toolbar remains the sole search input for reference tabs", () => {
  const parent = read("components/routes/CompendiumScreen.tsx");
  const toolbar = read("components/routes/CompendiumToolbar.tsx");
  const pages = [
    read("components/routes/GlossaryScreen.tsx"),
    read("components/routes/OfficialRulebook.tsx"),
    read("components/routes/RulingsReference.tsx"),
  ];
  assert.match(toolbar, /type="search"/);
  assert.match(parent, /<CompendiumToolbar section=/);
  for (const page of pages) assert.ok(!page.includes('type="search"'));
  for (const name of ["OfficialRulebook", "GlossaryScreen", "RulingsReference"]) {
    assert.ok(parent.includes("<" + name + " query={deferredSearchQuery}"), "Missing shared search: " + name);
  }
});

test("player-facing glossary retains gameplay keywords and all extended tag words", () => {
  const names = new Set(GLOSSARY_TERMS.map(term => term.title));
  for (const title of [
    "DoubleStrike", "ShadowStrike", "FrostStrike", "Flip (game action)",
    "Victor (game action)", "Aurelus Power", "Battle Mastery", "Boost",
    "Domination", "Empower", "Flex", "Flow", "Fury", "Inspire", "InstaBrawl",
    "Rally", "Rapid Fire", "Sacrifice", "Scrounge", "Stoke", "Sync",
    "Trifecta", "Turbo", "Underdog", "Victor",
  ]) {
    assert.ok(names.has(title), "Missing glossary term: " + title);
  }
});

test("Glossary's fixed categories and shared sidebar do not create secondary navigation", () => {
  const view = read("components/routes/GlossaryScreen.tsx");
  const sidebar = read("components/routes/ContentsNavigation.tsx");
  const frame = read("components/routes/CompendiumScreen.module.css");
  assert.ok(sidebar.includes("scrollIntoView"));
  assert.ok(sidebar.includes("history.pushState"));
  assert.ok(sidebar.includes("aria-current"));
  assert.ok(view.includes("groups.map(({ name })"));
  assert.ok(view.includes('id="glossary-icons"'));
  assert.ok(frame.includes('[id^="glossary-"]'));
  assert.ok(!view.includes("setCategory("));
  assert.ok(!view.includes("All terms"));
});
