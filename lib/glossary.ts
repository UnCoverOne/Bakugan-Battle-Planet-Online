import { OFFICIAL_RULEBOOK } from "./official-rulebook";
import { GLOSSARY_ENTRIES, SYMBOL_ENTRIES } from "./reference";
import { EXTENDED_TAG_WORDS } from "./extended-glossary";

type SourceTerm = { title: string; key: string; category: string; definition: string; rule: string };
export type GlossaryTerm = Omit<SourceTerm, "definition"> & { description: string };

// The 2019 source only enumerates five Tag-Word Abilities. Later-set terms
// reference the general Tag-Word section, not nonexistent numbered paragraphs.
export const glossaryKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Player-facing entries excluded from this reference, not from the official source.
const excludedTitles = new Set(["Completing Effects","Copying Cards and Abilities","Deck Construction","Ending the Game","Energy Abilities","Evo ID","Free","Gameplay Terms","Handling Mis-rolls","Hero ID","Keyword Abilities","Making Selections","Modifications","Priority and Timing","Setup","Starting the Game","Tag-Word Abilities","The Ultimate Rules","Type Line","Winning","BakuCores","BPower","Character Cards","Evo Cards","Factions","Flip Cards","Hero Cards","Reroll effects","Selection","Evo Rating","Illegal Actions"]);
const definitionBreaks: Record<string,string> = {
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
const keepFullDefinition = new Set(["B-Power","Bakugan","Legal Text"]);
// Short player-facing definitions; complete rules remain in the Rules section.
const definitionOverrides: Record<string, string> = {
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
const definitionFor = (entry: SourceTerm) => {
  const override = definitionOverrides[entry.title];
  if (override !== undefined) return override;
  if (keepFullDefinition.has(entry.title)) return entry.definition;
  let description = entry.definition.replace(/\s*\(see rules?\s+[^)]*\)/gi, "").replace(/\s*\(see\s+\d+(?:\.\d+)+[^)]*\)/gi, "");
  const marker = definitionBreaks[entry.title];
  if (marker && description.includes(marker)) description = description.slice(0, description.indexOf(marker));
  if (entry.title === "Play Step" || entry.title === "Power Step") description = description.replace(/\s*\(see rules?\s+[^)]*\)/gi, "");
  return description.trim();
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

const sourceTerms: SourceTerm[] = [];
OFFICIAL_RULEBOOK.forEach((chapter, i) => chapter.children.forEach((section, j) => {
  if (section.text === "General" || !section.children.length) return;
  const id = `${i + 1}.${j + 1}`;
  // The section's first numbered paragraph supplies the wording, without inventing a new definition.
  sourceTerms.push({ title: section.text, key: glossaryKey(section.text), category: chapter.text, definition: section.children[0].text, rule: id });
}));
const aliases = new Map<string,string>([
  ["b-power", "2.9"], ["bakucore", "1.12"], ["character-card", "3.2"],
  ["evo", "3.3"], ["hero", "3.4"], ["flip", "3.6"], ["faction", "1.6"],
  ["priority", "1.14"], ["reroll", "1.18"], ["selection", "1.13"],
  ["starting-player", "7.5"], ["free", "1.15"], ["team-attack", "5.12"],
  ["energy-cost", "2.3"], ["batch", "4.4"], ["damage", "1.16"],
  ["damage-rating", "2.10"], ["energy", "1.7"],
]);
export const GLOSSARY_TERMS: GlossaryTerm[] = (() => {
  const indexed = new Map<string,SourceTerm>();
  sourceTerms.forEach((entry) => indexed.set(entry.key, entry));
  GLOSSARY_ENTRIES.forEach((entry) => {
    const key = glossaryKey(entry.title);
    const rule = aliases.get(key) || (/^\d+(?:\.\d+)+/.exec(entry.sourceSection)?.[0] ?? "");
    const original = sourceTerms.find((candidate) => candidate.rule === rule);
    const existing = indexed.get(key);
    indexed.set(key, {
      title: entry.title, key, category: entry.category,
      definition: original?.definition || existing?.definition || entry.body,
      rule, 
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
      const key = glossaryKey(disambiguated);
      const definition = rule.children[0]?.text || rule.text;
      indexed.set(key, {title: disambiguated, key, category, definition,
        rule: `7.${sectionIndex + 1}.${i + 1}`});
    });
  }
  EXTENDED_TAG_WORDS.forEach((entry) => {
    const key = glossaryKey(entry.title);
    indexed.set(key, {title: entry.title, key, category: entry.category,
      definition: entry.definition, rule: "7.4"});
  });
  return [...indexed.values()].filter((entry) => !excludedTitles.has(entry.title)).map((entry) => {
    const title = entry.title === "Costs" ? "Cost" : entry.title;
    return { title, key: title === "Cost" ? "cost" : entry.key,
      category: categoryByTitle.get(title) ?? "Other Terms",
      description: definitionFor(entry), rule: entry.rule };
  }).sort((a,b) => a.title.localeCompare(b.title));
})();

export const GLOSSARY_SECTIONS = [
  ...glossaryCategories.map(({ name }) => name),
  ...(GLOSSARY_TERMS.some(term => term.category === "Other Terms") ? ["Other Terms"] : []),
];

// Later-set artwork with no dedicated 2019 rule uses the general Symbols section.
export const PRINTED_ICON_RULES: Record<string, string> = {
  "[B]": "2.9", "[Damage Rating]": "2.10", "[Energy]": "1.7",
  "[DoubleStrike]": "7.3.1", "[FrostStrike]": "7.3.3", "[ShadowStrike]": "7.3.2",
  "[BakuGear]": "1.9", "[Fusion]": "1.9", "[Victor]": "7.2.10",
  "[Roll]": "5.7", "[DoubleCore]": "1.12", "[AddCore]": "1.12",
  "[Stop]": "7.2.9", "[DrawCard]": "1.17", "[DoubleGear]": "1.9",
  "[RemoveCore]": "1.12", "[Scan]": "1.9", "[StealCore]": "1.12",
  "[Reroll]": "1.18", "[TeamAttack]": "5.12",
  "[Aquos]": "1.6", "[Aurelus]": "1.6", "[Darkus]": "1.6",
  "[Haos]": "1.6", "[Pyrus]": "1.6", "[Ventus]": "1.6",
};

export function glossaryRuleHref(id: string): string {
  return `/compendium/rules#${id.split(".").length > 2 ? "rule" : "section"}-${id}`;
}

export function filterGlossary(query: string) {
  const search = query.trim().toLowerCase();
  const icons = SYMBOL_ENTRIES.filter(symbol => !search
    || [symbol.name, symbol.token, symbol.description].some(part => part.toLowerCase().includes(search)));
  const terms = GLOSSARY_TERMS.filter(term => !search
    || [term.title, term.description, term.category, term.rule].some(part => part.toLowerCase().includes(search)));
  const groups = GLOSSARY_SECTIONS.map(name => ({
    name,
    items: terms.filter(term => term.category === name),
  })).filter(group => group.items.length > 0);
  return { icons, groups };
}
