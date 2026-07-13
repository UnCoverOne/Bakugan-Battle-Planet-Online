import fs from "node:fs";

const rows = JSON.parse(fs.readFileSync("/tmp/bbp_sheet_analysis/cards.json", "utf8")).slice(1);
const scannedStats = JSON.parse(fs.readFileSync("/tmp/bbp_sheet_analysis/vision-stats.json", "utf8"));
const iconStats = JSON.parse(fs.readFileSync("/tmp/bbp_sheet_analysis/stats.json", "utf8"));
const imageRoot = "/tmp/bbp_cards/Card Images";
const imageFiles = fs.readdirSync(imageRoot).filter((name) => /\.(png|jpg|jpeg)$/i.test(name));
const imageByNumber = new Map();
for (const image of imageFiles) {
  const number = Number(image.match(/_ENG_(\d+)_/)?.[1]);
  if (number && !imageByNumber.has(number)) imageByNumber.set(number, image);
}

const missingStats = {
  228: { bPower: 900, damage: 6, coreTypes: [] },
  302: { bPower: 500, damage: 5, coreTypes: ["Magic Shield", "Shield"] },
  346: { bPower: 300, damage: 4, coreTypes: ["Shield", "Fist"] },
  366: { bPower: 600, damage: 1, coreTypes: ["Fist", "Helix"] },
  368: { bPower: 400, damage: 4, coreTypes: ["Shield", "Fist"] },
  374: { bPower: 300, damage: 7, coreTypes: ["Shield", "Fist"] },
};

const cleanFaction = (value) => String(value).replace(/\u00a0/g, "").trim();
const typeMap = { "Action Card": "Action", "Flip Card": "Flip", "Hero Card": "Hero", "Evo Card": "Evo", "Character Card": "Character" };
const slug = (value) => value.toLowerCase().replace(/\(battle brawlers\)/gi, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const characterName = (name) => name.replace(/ \(Battle Brawlers\)$/i, "").replace(/^(Aquos|Aurelus|Darkus|Haos|Pyrus|Ventus) /, "");
const evolvesFrom = (name) => characterName(name).replace(/^(Diamond|Hyper|Titan|Maximus) /, "");
const mechanics = (effect = "") => {
  const text = effect.toLowerCase();
  const tags = [];
  const add = (tag, condition) => { if (condition && !tags.includes(tag)) tags.push(tag); };
  add("B-Power", /\[b\]|b-power/.test(text));
  add("Damage", /damage/.test(text));
  add("Draw", /draw/.test(text));
  add("Discard", /discard/.test(text));
  add("Energize", /energ|\[energy\]/.test(text));
  add("Destroy", /destroy/.test(text));
  add("Negate", /negate/.test(text));
  add("Reroll", /reroll/.test(text));
  add("Retract", /retract/.test(text));
  add("BakuCore", /bakucore|\[(ms|ff|ft|sd|he)\]/.test(text));
  add("Search", /search your deck|look at the top/.test(text));
  add("Copy", /copy/.test(text));
  add("Control", /take control/.test(text));
  add("Free play", /play a card from your hand for free/.test(text));
  add("Return", /put this into your hand|return this/.test(text));
  add("Stop", /\[stop\]|stop an attack|remaining damage/.test(text));
  add("FrostStrike", /froststrike/.test(text));
  add("DoubleStrike", /doublestrike|double strike/.test(text));
  add("ShadowStrike", /shadowstrike/.test(text));
  for (const tag of ["Flow", "Fury", "Turbo", "Domination", "Sacrifice", "Victor"]) add(tag, text.includes(tag.toLowerCase()));
  add("Triggered", /when |at the |if this is discarded/.test(text));
  add("Static", /your bakugan|opposing bakugan|your attacks|cost you/.test(text));
  return tags;
};

const cards = rows.map((row) => {
  const [number, , name, sourceType, factionValue, energyValue, rarity, effectValue] = row;
  const type = typeMap[sourceType];
  const stats = { ...(scannedStats[number] ?? {}), ...(missingStats[number] ?? {}) };
  const coreTypes = missingStats[number]?.coreTypes ?? iconStats[number]?.coreTypes ?? [];
  const effect = effectValue == null ? "" : String(effectValue).trim();
  const faction = cleanFaction(factionValue);
  return {
    id: `bb-${number}`,
    number,
    name: String(name).replace(/ \(Battle Brawlers\)$/i, ""),
    displayName: type === "Character" ? characterName(String(name)) : String(name).replace(/ \(Battle Brawlers\)$/i, ""),
    faction,
    factions: [faction],
    type,
    cost: String(energyValue).trim() === "X" ? "X" : Number.isFinite(Number(energyValue)) ? Number(energyValue) : 0,
    rarity: String(rarity),
    effect,
    mechanics: mechanics(effect),
    bPower: stats.bPower ?? null,
    damage: stats.damage ?? null,
    coreTypes,
    evolvesFrom: type === "Evo" ? evolvesFrom(String(name)) : null,
    art: imageByNumber.has(number) ? `/assets/cards/full/${number}.webp` : "/assets/cards/card-missing.svg",
    hasProvidedScan: imageByNumber.has(number),
    source: imageByNumber.has(number) ? "Provided card scan" : missingStats[number] ? "Catalogue row; printed stats verified from card reference" : "Catalogue row",
    slug: slug(String(name)),
  };
});

fs.writeFileSync("lib/catalog.generated.json", `${JSON.stringify(cards, null, 2)}\n`);
console.log(`Generated ${cards.length} cards (${cards.filter((card) => card.hasProvidedScan).length} scans).`);
