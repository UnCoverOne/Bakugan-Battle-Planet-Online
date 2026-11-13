"use client";

import { useEffect, useMemo, useState } from "react";
import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "../../lib/official-rulebook";
import { GLOSSARY_ENTRIES, SYMBOL_ENTRIES } from "../../lib/reference";
import { EXTENDED_TAG_WORDS } from "../../lib/extended-glossary";
import { OriginalImage } from "../media/OriginalImage";
import styles from "./GlossaryScreen.module.css";
import { ReferenceContentsDrawer } from "./ReferenceContentsDrawer";

type Term = {
  title: string;
  key: string;
  category: string;
  definition: string;
  rule: string;
  editorial: boolean;
  preview: string;
};
const makeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Only the initial card is abbreviated. Details always renders the unmodified rule text.
const excludedTitles = new Set(["Completing Effects","Copying Cards and Abilities","Deck Construction","Ending the Game","Energy Abilities","Evo ID","Free","Gameplay Terms","Handling Mis-rolls","Hero ID","Keyword Abilities","Making Selections","Modifications","Priority and Timing","Setup","Starting the Game","Tag-Word Abilities","The Ultimate Rules","Type Line","Winning","BakuCores","BPower","Character Cards","Evo Cards","Factions","Flip Cards","Hero Cards","Reroll effects","Selection","Evo Rating","Illegal Actions"]);
const previewBreaks: Record<string,string> = {
  "Acting Player": " Once that player passes priority",
  "Art Credit": " It has no game function.",
  "BakuCore": " On the top side",
  "BakuCore Field": " This is the zone",
  "BakuCore Indicator": " It is indicated",
  "Cards": " Only Bakugan Character",
  "Character Card": " Character cards begin",
  "Collection Number": " It has no game function.",
  "Continuous Effects": " They read as",
  "Costs": " Most costs are",
  "Damage": " When damage is",
  "Damage Rating": " It is indicated",
  "Damage Step": " Cards flipped",
  "Deck": " There can be",
  "Discard Pile": " In addition,",
  "Drawing a Card": " Once per turn,",
  "Evo Rating": " It is shown",
  "Flip": " If a player is dealt",
  "Hand": " There are additional",
  "Legal Text": " It is listed",
  "Play Area": " These cards consist",
  "Play Step": " This is the last",
  "Roll Phase": " During this phase",
  "Set Indicator": " It is located",
  "Start Phase": " During this phase",
  "Static Abilities": " They appear",
  "Triggered Abilities": " They typically"
};
const keepComplete = new Set(["B-Power","Bakugan","Legal Text"]);
// Card preview copy only; Details and Rules continue to use the original definitions.
const previewOverrides: Record<string, string> = {
  "Action Cards": "An Action card may be played when a player has priority. After its text is followed, it is put into the discard pile.",
  "Art Credit": "Art credit may be listed on the bottom left of a card. It has no game function.",
  "BakuCore": "BakuCores are hexagon-shaped discs with an icon identifier on top and modifying abilities on the bottom that affect Bakugan that pick them up.",
  "BakuCore Field": "The BakuCore Field is the area in the center of the play area where players place BakuCores before the game begins.",
  "BakuCore Indicator": "The BakuCore indicator consists of two hexagonal symbols on a Character card. Players must use BakuCores matching these symbols.",
  "Brawl Phase": "The Brawl Phase consists of four steps: the Power Step, Victor Step, Damage Step, and Retracting Step.",
  "Collection Number": "The collection number is shown at the bottom right of a card. It has no game function.",
  "Damage": "When taking damage, a player flips that many cards from the top of their deck, one at a time, and places them into their discard pile.",
  "Damage Rating": "Damage Rating is the number on Character and Evo cards that determines how much damage the Bakugan deals when attacking.",
  "Draw Step": "During the Draw Step, each player simultaneously draws a card from their deck and puts it into their hand.",
  "Energy Cards": "Energy cards have the card type Energy card while in play, but have their printed card type while in any other zone.",
  "Energy Cost": "A card’s Energy Cost is the amount a player must spend from their Energy pool to play it, listed in the top right corner.",
  "Evo": "Evo cards are played on matching Character cards, replacing that Bakugan’s stats and abilities with those of the topmost Evo card.",
  "Faction": "A card’s Faction is indicated by the Faction icons on its type line. The six Factions are Aquos, Aurelus, Darkus, Haos, Pyrus, and Ventus.",
  "Flip (game action)": "Flipping a card means turning the top card of a player’s deck face up. Cards are flipped one at a time.",
  "FrostStrike": "A Bakugan with FrostStrike increases the Energy an opponent must pay to play a Flip card by its FrostStrike amount.",
  "Hero": "A Hero card may be played when a player has priority and remains in the play area until otherwise directed by a card or destroy effect.",
  "Name": "A card’s name is printed in the upper-left corner and identifies the card in rules and effects.",
  "Negate Effects": "Negate effects remove effects from the batch, preventing those effects from happening.",
  "Numbers": "Additive (+) numbers add to a total, negative (-) numbers subtract from it, and the letter X represents a variable value.",
  "Play Step": "During the Play Step, players may play cards and use abilities. This is the last opportunity to do so during the turn.",
  "Power Step": "During the Power Step, players may play cards and use abilities. If B-Power is tied when both players pass, a B-Power tiebreak takes place.",
  "Priority": "When a player has priority, they may choose to play cards and use abilities. After playing a card or using an ability, that player retains priority.",
  "Reroll": "Reroll effects allow a player to roll their selected Bakugan again after the first roll of the turn and before the Victor Step begins.",
  "Retracting Step": "During the Retracting Step, the non-Victor player retracts their participating Bakugan. After a Team Attack, the Victor player retracts all their Bakugan.",
  "Team Attack": "A Team Attack occurs when all Bakugan on a player's team are open and that player wins the Power Step. Their Damage Ratings are combined for the attack.",
  "Text": "A card’s text is printed on its lower half and may include italicized flavor text, which has no game function.",
  "Trigger": "A trigger occurs when a specified event, such as a card being played or a phase beginning, causes an ability to enter the batch."
};
const previewFor = (entry: Term) => {
  const override = previewOverrides[entry.title];
  if (override !== undefined) return override;
  if (keepComplete.has(entry.title)) return entry.definition;
  let preview = entry.definition.replace(/\s*\(see rules?\s+[^)]*\)/gi, "").replace(/\s*\(see\s+\d+(?:\.\d+)+[^)]*\)/gi, "");
  const marker = previewBreaks[entry.title];
  if (marker && preview.includes(marker)) preview = preview.slice(0, preview.indexOf(marker));
  if (entry.title === "Play Step" || entry.title === "Power Step") preview = preview.replace(/\s*\(see rules?\s+[^)]*\)/gi, "");
  return preview.trim();
};
// Player-facing groups; source rulebook and full definitions remain unchanged.
const glossaryCategories = [
  {
    "name": "Fundamentals",
    "entries": [
      "Bakugan",
      "BakuCore",
      "Cards",
      "Deck",
      "Drawing a Card",
      "Faction",
      "Numbers",
      "Symbols"
    ]
  },
  {
    "name": "Card Types",
    "entries": [
      "Action Cards",
      "Character Card",
      "Energy Cards",
      "Evo",
      "Flip",
      "Hero"
    ]
  },
  {
    "name": "Parts of a Card",
    "entries": [
      "Art",
      "Art Credit",
      "BakuCore Indicator",
      "Collection Number",
      "Legal Text",
      "Name",
      "Set Indicator",
      "Text"
    ]
  },
  {
    "name": "Energy",
    "entries": [
      "Charge",
      "Cost",
      "Energize",
      "Energy",
      "Energy Cost",
      "Spend",
      "Uncharge"
    ]
  },
  {
    "name": "Zones",
    "entries": [
      "BakuCore Field",
      "Discard Pile",
      "Hand",
      "Play Area"
    ]
  },
  {
    "name": "Turns & Phases",
    "entries": [
      "Brawl Phase",
      "Charge Step",
      "Damage Step",
      "Draw Step",
      "End Phase",
      "Energize Step",
      "Play Step",
      "Power Step",
      "Reset Step",
      "Retracting Step",
      "Roll Phase",
      "Rolling Step",
      "Selection Step",
      "Start Phase",
      "Starting Player",
      "Victor Step"
    ]
  },
  {
    "name": "Battle & Rolling",
    "entries": [
      "B-Power",
      "Damage",
      "Damage Rating",
      "Flip (game action)",
      "Open",
      "Reroll",
      "Retract",
      "Stop",
      "Team Attack",
      "Victor (game action)"
    ]
  },
  {
    "name": "Timing & Effects",
    "entries": [
      "Acting Player",
      "Activated Abilities",
      "Batch",
      "Continuous Effects",
      "Effects",
      "Negate Effects",
      "Playing Cards",
      "Priority",
      "Static Abilities",
      "Taking Control of a Card",
      "Trigger",
      "Triggered Abilities"
    ]
  },
  {
    "name": "Keywords & Tag-Words",
    "entries": [
      "Aurelus Power",
      "Battle Mastery",
      "Boost",
      "Domination",
      "DoubleStrike",
      "Empower",
      "Flex",
      "Flow",
      "FrostStrike",
      "Fury",
      "Inspire",
      "InstaBrawl",
      "Rally",
      "Rapid Fire",
      "Sacrifice",
      "Scrounge",
      "ShadowStrike",
      "Stoke",
      "Sync",
      "Trifecta",
      "Turbo",
      "Underdog",
      "Victor"
    ]
  }
] as const;
const categoryByTitle = new Map<string, string>(
  glossaryCategories.flatMap(({ name, entries }) => entries.map((title) => [title, name] as const)),
);

const sourceTerms: Term[] = [];
OFFICIAL_RULEBOOK.forEach((chapter, i) => chapter.children.forEach((section, j) => {
  if (section.text === "General" || !section.children.length) return;
  const id = `${i + 1}.${j + 1}`;
  // The section's first numbered paragraph supplies the wording, without inventing a new definition.
  sourceTerms.push({ title: section.text, key: makeKey(section.text), category: chapter.text, definition: section.children[0].text, rule: id, editorial: false, preview: "" });
}));
const aliases = new Map<string,string>([
  ["b-power", "2.9"], ["bakucore", "1.12"], ["character-card", "3.2"],
  ["evo", "3.3"], ["hero", "3.4"], ["flip", "3.6"], ["faction", "1.6"],
  ["priority", "1.14"], ["reroll", "1.18"], ["selection", "1.13"],
  ["starting-player", "1.14"], ["free", "1.15"], ["team-attack", "5.12"],
  ["energy-cost", "2.3"], ["batch", "4.4"], ["damage", "1.16"],
  ["damage-rating", "2.10"], ["energy", "1.7"],
]);
const fullTerms: Term[] = (() => {
  const indexed = new Map<string,Term>();
  sourceTerms.forEach((entry) => indexed.set(entry.key, entry));
  GLOSSARY_ENTRIES.forEach((entry) => {
    const key = makeKey(entry.title);
    const rule = aliases.get(key) || (/^\d+(?:\.\d+)+/.exec(entry.sourceSection)?.[0] ?? "");
    const original = sourceTerms.find((candidate) => candidate.rule === rule);
    const existing = indexed.get(key);
    indexed.set(key, {
      title: entry.title, key, category: entry.category,
      definition: original?.definition || existing?.definition || entry.body,
      rule, editorial: !(original || existing), preview: "",
    });
  });
  // Read individual nested definitions from the original rulebook, rather than
  // indexing only chapter section headings.
  const additional = OFFICIAL_RULEBOOK[6];
  for (const [sectionIndex, category] of [[1, "Gameplay Terms"], [2, "Keyword Abilities"], [3, "Tag-Word Abilities"]] as const) {
    const subsection = additional.children[sectionIndex];
    subsection?.children.forEach((rule, i) => {
      const title = category === "Keyword Abilities"
        ? rule.text.slice(rule.text.indexOf(")") + 1).trim()
        : rule.text;
      const disambiguated = category === "Gameplay Terms" && (title === "Flip" || title === "Victor")
        ? title + " (game action)" : title;
      const key = makeKey(disambiguated);
      const definition = rule.children[0]?.text || rule.text;
      indexed.set(key, {title: disambiguated, key, category, definition,
        rule: `7.${sectionIndex + 1}.${i + 1}`, editorial: false, preview: ""});
    });
  }
  EXTENDED_TAG_WORDS.forEach((entry) => {
    const key = makeKey(entry.title);
    indexed.set(key, {title: entry.title, key, category: entry.category,
      definition: entry.definition, rule: "", editorial: true, preview: ""});
  });
  return [...indexed.values()].filter((entry) => !excludedTitles.has(entry.title)).map((entry) => {
    const title = entry.title === "Costs" ? "Cost" : entry.title;
    return {...entry, title, key: title === "Cost" ? "cost" : entry.key,
      category: categoryByTitle.get(title) ?? "Other Terms", preview: previewFor(entry)};
  }).sort((a,b) => a.title.localeCompare(b.title));
})();
const getRule = (id: string): OfficialRuleNode | undefined => {
  const indexes = id.split(".").map((value) => Number(value)-1);
  return indexes.reduce<OfficialRuleNode | undefined>((node, i, position) => position === 0 ? OFFICIAL_RULEBOOK[i] : node?.children[i], undefined);
};
const sections = [...glossaryCategories.map(({ name }) => name),
  ...(fullTerms.some((term) => term.category === "Other Terms") ? ["Other Terms"] : [])];
export function GlossaryScreen({ query = "" }: { query?: string }) {
  const [category, setCategory] = useState("Printed Icons");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved=sessionStorage.getItem("compendium:glossary-category");
    if (saved) setCategory(saved);
    setRestored(true);
  }, []);
  useEffect(() => {if(restored) sessionStorage.setItem("compendium:glossary-category",category);},[category,restored]);
  const normalized = query.trim().toLowerCase();
  // Searching spans every category but does not overwrite the reading category.
  const filtered = useMemo(() => fullTerms.filter((term) =>
    (!normalized ? category === "All Terms" || term.category === category
      : [term.title, term.definition, term.category, term.rule].some((part) => part.toLowerCase().includes(normalized)))
  ), [category, normalized]);
  const filteredIcons = useMemo(() => SYMBOL_ENTRIES.filter((symbol) =>
    !normalized || [symbol.name, symbol.token, symbol.description].some((part) => part.toLowerCase().includes(normalized))
  ), [normalized]);
  const showIcons = Boolean(normalized) || category === "Printed Icons";
  const groups = sections.map((name) => ({
    name, items: filtered.filter((term) => term.category === name),
  })).filter((group) => group.items.length);
  const chooseCategory = (name: string) => {
    setCategory(name);
    requestAnimationFrame(() => document.getElementById("glossary-reading")?.scrollIntoView({ block: "start" }));
  };
  useEffect(() => {
    const match = window.location.hash.match(/^#glossary-(?!category-)([a-z0-9-]+)$/);
    if (!match) return;
    const item = fullTerms.find((term) => term.key === match[1]);
    if (!item) return;
    setCategory(item.category);
    requestAnimationFrame(() => document.getElementById("glossary-" + item.key)?.scrollIntoView({ block: "start" }));
  }, []);
  return <div className={styles.layout}>
    <ReferenceContentsDrawer className={styles.rail} label="Glossary navigation">
      <h2>Categories</h2>
      <button type="button" aria-pressed={category === "Printed Icons"} onClick={() => chooseCategory("Printed Icons")}>Printed Icons</button>
      <button type="button" aria-pressed={category === "All Terms"} onClick={() => chooseCategory("All Terms")}>All Terms</button>
      {sections.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => chooseCategory(name)}>{name}</button>)}
    </ReferenceContentsDrawer>
    <main className={styles.main} id="glossary-reading">
      {showIcons && filteredIcons.length > 0 && <section className={styles.printedIcons} id="glossary-icons" aria-labelledby="glossary-icons-heading">
        <div className={styles.iconHeading}><h2 id="glossary-icons-heading">Printed Icons</h2><span className={styles.iconCount}>{filteredIcons.length}</span></div>
        <div className={styles.iconGrid}>{filteredIcons.map((symbol) => <article className={styles.iconCard} key={symbol.token}>
          <OriginalImage className={styles.iconArtwork} src={symbol.asset} alt="" />
          <strong>{symbol.name}</strong><p>{symbol.description}</p>
        </article>)}</div>
      </section>}
      {groups.map(({name,items}) => <section key={name} className={styles.group} id={`glossary-category-${makeKey(name)}`}>
        {(!normalized && category === name) || category === "All Terms" || Boolean(normalized) ? <h2>{name}</h2> : null}
        <div className={styles.entries}>{items.map((item) => <article key={item.key} className={styles.entry} id={`glossary-${item.key}`}>
          <div className={styles.entryHeading}><h3>{item.title}</h3></div>
          <p>{item.definition}</p>
          <footer>{item.editorial && <span>Site reference</span>}{item.rule && <a href={`/compendium/rules#section-${item.rule}`}>Rule {item.rule} →</a>}<a href={`#glossary-${item.key}`} aria-label={`Link to ${item.title}`}>Copyable link</a></footer>
        </article>)}</div>
      </section>)}
      {!groups.length && (!showIcons || !filteredIcons.length) && <section className={styles.empty} role="status"><h2>No matching glossary entries</h2><p>Try another search or category.</p><button type="button" onClick={() => chooseCategory("All Terms")}>All Terms</button></section>}
    </main>
  </div>;
}
