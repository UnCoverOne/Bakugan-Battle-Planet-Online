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

// Printed-icon definitions are concise player-facing explanations.
// Later-set mechanics (Scan, Dual Baku-Gear) are documented at bakugan.wiki/wiki/Scan
// and bakugan.wiki/wiki/Dual_Baku-Gear; the 2019 Rules may only offer general context.
export const SYMBOL_ENTRIES = [
  { token: "[B]", name: "B-Power", asset: "/assets/symbols/b-power.svg", description: "Bakugan power." },
  { token: "[Damage Rating]", name: "Damage Rating", asset: "/assets/symbols/damage.svg", description: "Damage dealt by an attack." },
  { token: "[Energy]", name: "Energy", asset: "/assets/symbols/energy.svg", description: "Resource used to pay costs." },
  { token: "[DoubleStrike]", name: "DoubleStrike", asset: "/assets/symbols/double-strike.svg", description: "Adds the attacking Bakugan's Damage Rating again." },
  { token: "[FrostStrike]", name: "FrostStrike", asset: "/assets/symbols/frost-strike.svg", description: "Increases Flip-card costs during damage." },
  { token: "[ShadowStrike]", name: "ShadowStrike", asset: "/assets/symbols/shadow-strike.svg", description: "Prevents the attack's Damage Rating from being reduced." },
  { token: "[BakuGear]", name: "Baku-Gear", asset: "/assets/symbols/baku-gear.svg", description: "Identifies a Baku-Gear effect or the use of a Baku-Gear card." },
  { token: "[Fusion]", name: "Fusion", asset: "/assets/symbols/fusion.png", description: "Identifies a Fusion Bakugan or a Fusion-related effect." },
  { token: "[Victor]", name: "Victor", asset: "/assets/symbols/victor.svg", description: "Marks an effect related to winning a Brawl." },
  { token: "[Roll]", name: "Roll", asset: "/assets/symbols/roll.svg", description: "Indicates rolling a Bakugan." },
  { token: "[DoubleCore]", name: "Double Core", asset: "/assets/symbols/double-core.svg", description: "Represents two BakuCores in a printed effect." },
  { token: "[AddCore]", name: "Add Core", asset: "/assets/symbols/add-core.svg", description: "Adds a BakuCore to the specified Bakugan or area." },
  { token: "[Stop]", name: "Stop", asset: "/assets/symbols/stop.svg", description: "Ends the remaining damage from the current damage source." },
  { token: "[DrawCard]", name: "Draw a Card", asset: "/assets/symbols/draw-card.svg", description: "Draws the indicated number of cards from the deck." },
  { token: "[DoubleGear]", name: "Double Gear", asset: "/assets/symbols/double-gear.svg", description: "Allows a Baku-Gear card to be equipped as a second Baku-Gear." },
  { token: "[RemoveCore]", name: "Remove Core", asset: "/assets/symbols/remove-core.svg", description: "Removes a BakuCore from the specified Bakugan." },
  { token: "[Scan]", name: "Scan", asset: "/assets/symbols/scan.svg", description: "Look at the top card of your deck, then leave it there or put it on the bottom." },
  { token: "[StealCore]", name: "Steal Core", asset: "/assets/symbols/steal-core.svg", description: "Takes a BakuCore from an opponent's Bakugan." },
  { token: "[Reroll]", name: "Reroll", asset: "/assets/symbols/reroll.svg", description: "Indicates rolling a Bakugan again." },
  { token: "[TeamAttack]", name: "Team Attack", asset: "/assets/symbols/team-attack.svg", description: "Identifies an effect associated with a Team Attack." },
  { token: "[Aquos]", name: "Aquos", asset: "/assets/symbols/factions/aquos.png", description: "Identifies the Aquos faction on a card." },
  { token: "[Aurelus]", name: "Aurelus", asset: "/assets/symbols/factions/aurelus.png", description: "Identifies the Aurelus faction on a card." },
  { token: "[Darkus]", name: "Darkus", asset: "/assets/symbols/factions/darkus.png", description: "Identifies the Darkus faction on a card." },
  { token: "[Haos]", name: "Haos", asset: "/assets/symbols/factions/haos.png", description: "Identifies the Haos faction on a card." },
  { token: "[Pyrus]", name: "Pyrus", asset: "/assets/symbols/factions/pyrus.png", description: "Identifies the Pyrus faction on a card." },
  { token: "[Ventus]", name: "Ventus", asset: "/assets/symbols/factions/ventus.png", description: "Identifies the Ventus faction on a card." },
];
