export type ReferenceEntry = {
  slug: string;
  title: string;
  category: string;
  body: string;
  source: string;
  sourceSection: string;
  reviewedAt: string;
};

export const REFERENCE_REVIEWED_AT = "2026-07-24";

export const GLOSSARY_ENTRIES: ReferenceEntry[] = [
  { slug: "batch", title: "Batch", category: "Timing", body: "The ordered area where played cards and abilities wait to complete. The newest object completes first after sequential passes.", source: "Glossary.pdf", sourceSection: "Priority and Timing / Batch", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "priority", title: "Priority", category: "Timing", body: "The permission to play a card, use an ability, or pass. The acting player retains priority after adding an object to the batch.", source: "Glossary.pdf", sourceSection: "1.14 Priority and Timing", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "starting-player", title: "Starting Player", category: "Turn structure", body: "The player who won the most recent Brawl. The final BakuCore placer is the starting player on the first turn.", source: "Glossary.pdf", sourceSection: "1.14.1", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "energy", title: "Energy", category: "Resources", body: "The resource spent to play cards and generate effects. Unspent Energy disappears at the end of the turn.", source: "Glossary.pdf", sourceSection: "1.7 Energy", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "energy-cost", title: "Energy Cost", category: "Cards", body: "The amount shown at the top right of a card that must be spent from the Energy pool to play it.", source: "Glossary.pdf", sourceSection: "2.3 Energy Cost", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "free", title: "Free", category: "Costs", body: "A free cost starts at zero and remains subject to cost increases and decreases. Costs below zero are treated as zero.", source: "Glossary.pdf", sourceSection: "1.15.2 Costs", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "damage", title: "Damage", category: "Combat", body: "Cards are flipped from the top of the damaged player's deck one at a time and placed into the discard pile.", source: "Glossary.pdf", sourceSection: "1.16 Damage", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "damage-rating", title: "Damage Rating", category: "Cards", body: "The number on Character and Evo cards that determines attack damage. Values below zero are treated as zero.", source: "Glossary.pdf", sourceSection: "2.10 Damage Rating", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "b-power", title: "B-Power", category: "Cards", body: "The power value on Character and Evo cards used to determine the Victor of a Brawl unless an effect says otherwise.", source: "Glossary.pdf", sourceSection: "2.9 BPower", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "bakucore", title: "BakuCore", category: "Game pieces", body: "A hexagonal disc with an identifier on top and modifying abilities on the reverse. Character indicators define the six required core types.", source: "Glossary.pdf", sourceSection: "1.12 BakuCores", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "bakucore-indicator", title: "BakuCore Indicator", category: "Cards", body: "The two hexagonal symbols on a Character card. A team must use six BakuCores matching all six indicators.", source: "Glossary.pdf", sourceSection: "2.11 BakuCore Indicator", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "character-card", title: "Character Card", category: "Cards", body: "A card representing a Bakugan toy. It begins in the Character card zone and is not shuffled into the Main Deck.", source: "Glossary.pdf", sourceSection: "1.10 Cards / 1.11 Bakugan", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "evo", title: "Evo", category: "Cards", body: "A card played on the matching Bakugan version to replace or augment its Character statistics and abilities.", source: "Glossary.pdf", sourceSection: "2.4 Card Types", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "hero", title: "Hero", category: "Cards", body: "A persistent card type that remains in play after it completes unless another rule or effect moves it.", source: "Glossary.pdf", sourceSection: "2.4 Card Types", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "flip", title: "Flip", category: "Cards", body: "A horizontally oriented defensive card type that may be played when revealed while taking damage if its requirements can be paid.", source: "Glossary.pdf", sourceSection: "2.4 Card Types", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "faction", title: "Faction", category: "Deck construction", body: "Aquos, Aurelus, Darkus, Haos, Pyrus, or Ventus. Main Deck cards must share a faction with at least one Bakugan on the team.", source: "Glossary.pdf", sourceSection: "1.6 Factions / 2.5 Faction", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "selection", title: "Selection", category: "Rules", body: "A required target or choice. Necessary selections must be legal when a card is played; otherwise that card cannot be played.", source: "Glossary.pdf", sourceSection: "1.13 Making Selections", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "reroll", title: "Reroll", category: "Rolling", body: "An additional roll of the Bakugan selected for that turn. Reroll effects apply only after the first roll and before the Victor Step.", source: "Glossary.pdf", sourceSection: "1.18 Reroll effects", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "team-attack", title: "Team Attack", category: "Combat", body: "An attack made after all three Bakugan on a team are open. Their Damage Ratings combine and the attack is treated as one attack.", source: "Glossary.pdf", sourceSection: "Team Attack", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "collection-number", title: "Collection Number", category: "Card metadata", body: "The printed card number and total set size shown at the bottom right. It has no game function.", source: "Glossary.pdf", sourceSection: "2.14 Collection Number", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "set-indicator", title: "Set Indicator", category: "Card metadata", body: "The mark identifying the printed card set, located at the bottom right of the card.", source: "Glossary.pdf", sourceSection: "2.6 Set Indicator", reviewedAt: REFERENCE_REVIEWED_AT },
];

export const SYMBOL_ENTRIES = [
  { token: "[B]", name: "B-Power", asset: "/assets/symbols/b-power.png", description: "Bakugan power." },
  { token: "[Damage Rating]", name: "Damage Rating", asset: "/assets/symbols/damage.png", description: "Damage dealt by an attack." },
  { token: "[Energy]", name: "Energy", asset: "/assets/symbols/energy.png", description: "Resource used to pay costs." },
  { token: "[DoubleStrike]", name: "DoubleStrike", asset: "/assets/symbols/double-strike.png", description: "Adds the attacking Bakugan's Damage Rating again." },
  { token: "[FrostStrike]", name: "FrostStrike", asset: "/assets/symbols/frost-strike.png", description: "Increases Flip-card costs during damage." },
  { token: "[ShadowStrike]", name: "ShadowStrike", asset: "/assets/symbols/shadow-strike.png", description: "Prevents the attack's Damage Rating from being reduced." },
  { token: "[Victor]", name: "Victor", asset: "/assets/symbols/victor.png", description: "Marks an effect related to winning a Brawl." },
  { token: "[Aquos]", name: "Aquos", asset: "/assets/symbols/factions/aquos.png", description: "Aquos faction." },
  { token: "[Aurelus]", name: "Aurelus", asset: "/assets/symbols/factions/aurelus.png", description: "Aurelus faction." },
  { token: "[Darkus]", name: "Darkus", asset: "/assets/symbols/factions/darkus.png", description: "Darkus faction." },
  { token: "[Haos]", name: "Haos", asset: "/assets/symbols/factions/haos.png", description: "Haos faction." },
  { token: "[Pyrus]", name: "Pyrus", asset: "/assets/symbols/factions/pyrus.png", description: "Pyrus faction." },
  { token: "[Ventus]", name: "Ventus", asset: "/assets/symbols/factions/ventus.png", description: "Ventus faction." },
];

export const PUBLISHED_RULINGS: ReferenceEntry[] = [
  { slug: "printed-cost-after-reduction", title: "Printed cost after reduction", category: "Costs", body: "A card whose cost is reduced still counts as the cost printed in its Energy Cost when another effect checks that printed value.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 2", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "gear-core-next-gear", title: "BakuCore Gear reduction applies to the next Gear", category: "Baku-Gear", body: "Cost-reduction BakuCores combine when picked up together and apply only to the next Baku-Gear played on that Bakugan.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 3, updated developer response", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "second-gear-choice", title: "Choosing which Baku-Gear to keep", category: "Baku-Gear", body: "When a second Gear is attached, its controller chooses one Gear to keep. A played trigger can occur even if the new Gear is then discarded.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 4", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "swap-requires-core", title: "A swap requires an attached BakuCore", category: "BakuCores", body: "A Bakugan must be holding a BakuCore to be selected for a swap.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 32", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "may-chosen-on-resolution", title: "May choices are made on resolution", category: "Timing", body: "The controller decides whether to perform an optional “may” effect when that effect resolves.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 35", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "team-attack-reduction", title: "Damage reduction during a Team Attack", category: "Team Attack", body: "Reduction applies to the selected Bakugan's contribution. The total Team Attack is then added and dealt at once.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 37", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "dual-faction-discard", title: "Chosen factions include dual-faction cards", category: "Factions", body: "An effect naming a faction includes dual-faction cards that have the selected faction.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 34", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "trigger-remains-after-core-moves", title: "An opening trigger remains after its Core moves", category: "Timing", body: "Once the opening effect is on the batch, it resolves even if the Bakugan is no longer holding the required Core.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 41", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "gear-reduction-reset", title: "Gear reduction resets only when the Core is picked up again", category: "Baku-Gear", body: "A spent Gear reduction does not reset each turn. It becomes available again if that Core is returned and picked up again.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 44", reviewedAt: REFERENCE_REVIEWED_AT },
  { slug: "team-attack-effect-once", title: "Team Attack effects apply once", category: "Team Attack", body: "A Team Attack counts as one attack, so an effect granting a bonus to an attack applies once rather than once per Bakugan.", source: "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.docx", sourceSection: "Question 46", reviewedAt: REFERENCE_REVIEWED_AT },
];
