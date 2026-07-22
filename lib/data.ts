import catalogJson from "./catalog.generated.json";
import type { Bakugan, Core, CoreType, Faction, GameCard, PlayerState } from "./game";

type CatalogRecord = Omit<GameCard, "id" | "catalogId"> & { id: string; source?: string; hasProvidedScan?: boolean; slug?: string };
const records = catalogJson as unknown as CatalogRecord[];
export const CARDS: GameCard[] = records.map((record) => ({ ...record, id: record.id, catalogId: record.id }));
export const CARD_BY_ID = new Map(CARDS.map((card) => [card.catalogId, card]));

type CoreSeed = [number, CoreType, number, number, Partial<Core>?];
const seeds: CoreSeed[] = [
  [1,"Fist",0,1],[2,"Fist",0,2],[3,"Fist",0,3],[4,"Fist",50,1],[5,"Fist",50,2],[6,"Fist",150,1],[7,"Fist",150,2],[8,"Fist",0,-1],[9,"Fist",0,-2],[10,"Fist",0,-3],
  [11,"Fist",100,0,{conditionalFactions:["Pyrus","Darkus"],conditionalDamage:3}],[12,"Fist",100,0,{conditionalFactions:["Pyrus","Haos"],conditionalDamage:3}],[13,"Fist",100,0,{conditionalFactions:["Darkus","Aquos"],conditionalDamage:3}],[14,"Fist",100,0,{conditionalFactions:["Aquos","Ventus"],conditionalDamage:3}],[15,"Fist",100,0,{conditionalFactions:["Ventus","Haos"],conditionalDamage:3}],
  [16,"Flaming Fist",0,5],[17,"Flaming Fist",0,6],[18,"Flaming Fist",150,4],[19,"Flaming Fist",250,3],[20,"Flaming Fist",0,-4],[21,"Flaming Fist",0,-5],
  [22,"Shield",100,0],[23,"Shield",150,0],[24,"Shield",200,0],[25,"Shield",250,0],[26,"Shield",300,0],[27,"Shield",50,1],[28,"Shield",150,1],[29,"Shield",-100,0],[30,"Shield",-200,0],[31,"Shield",-300,0],
  [32,"Shield",0,0,{conditionalFactions:["Aquos","Ventus"],conditionalBonus:400}],[33,"Shield",0,0,{conditionalFactions:["Haos","Ventus"],conditionalBonus:400}],[34,"Shield",0,0,{conditionalFactions:["Aquos","Darkus"],conditionalBonus:400}],[35,"Shield",0,0,{conditionalFactions:["Pyrus","Darkus"],conditionalBonus:400}],[36,"Shield",0,0,{conditionalFactions:["Haos","Pyrus"],conditionalBonus:400}],
  [37,"Magic Shield",500,0],[38,"Magic Shield",550,0],[39,"Magic Shield",600,0],[40,"Magic Shield",650,0],[41,"Magic Shield",-400,0],[42,"Magic Shield",-500,0],
  [43,"Helix",500,-1],[44,"Helix",-100,4],[45,"Helix",-200,5],[46,"Helix",600,-3],[47,"Helix",300,3],[48,"Helix",-100,-3],[49,"Helix",-200,-2],[50,"Helix",-300,-1],[51,"Helix",0,0,{frostStrike:5}],[52,"Helix",0,0,{shadowStrike:true}],
];
const sign = (value: number, suffix: string) => value ? `${value > 0 ? "+" : ""}${value}${suffix}` : "";
export const CORES: Core[] = seeds.map(([number, type, bonus, damageBonus, extra = {}]) => ({
  id: `core-${number}`, catalogId: `core-${number}`, number, type, bonus, damageBonus, ...extra,
  name: `${type} ${[sign(bonus, "B"), sign(damageBonus, "D"), extra.frostStrike ? `+${extra.frostStrike} FrostStrike` : "", extra.shadowStrike ? "ShadowStrike" : ""].filter(Boolean).join(" / ") || "conditional"}`,
  art: `/assets/cores/full/${number}.webp`,
}));

const characterCards = CARDS.filter((card) => card.type === "Character" && card.bPower != null && card.damage != null);
export const BAKUGAN: Bakugan[] = characterCards.map((character) => ({
  id: character.catalogId,
  name: character.displayName,
  faction: character.faction,
  bPower: character.bPower!,
  damage: character.damage!,
  // The simulator uses the explicitly configured physical-roll profiles.
  rollAccuracy: /\bUltra\b/i.test(character.displayName)
    ? 85
    : 90,
  doubleCoreChance: /\bUltra\b/i.test(character.displayName)
    ? 10
    : 5,
  art: character.art,
  character,
  open: false,
  heldCoreCells: [],
  evoStack: [],
}));

export type DeckFormat = "standard" | "singleton";

export type DeckRecord = {
  id: string;
  name: string;
  factions: string[];
  bakuganIds: string[];
  coreIds: string[];
  cardIds: string[];
  updatedAt: string;
  visibility: "Private" | "Public";
  format?: DeckFormat;
};

const buildDeck = (factions: Faction[]) => {
  const pool = CARDS.filter((card) => card.type !== "Character" && factions.includes(card.faction));
  const result: string[] = [];
  for (let offset = 0; result.length < 40; offset += 1) {
    const card = pool[offset % pool.length]; if (result.filter((id) => id === card.catalogId).length < 3) result.push(card.catalogId);
  }
  return result;
};
const coreLoadout = (bakuganIds: string[]) => {
  const requirements = bakuganIds.flatMap((id) => BAKUGAN.find((bakugan) => bakugan.id === id)?.character.coreTypes ?? []);
  const used = new Set<string>();
  return requirements.map((type) => {
    const core = CORES.find((candidate) => candidate.type === type && !used.has(candidate.id))!; used.add(core.id); return core.id;
  });
};

const pyrusTeam = ["bb-343", "bb-360", "bb-311"];
const aquosTeam = ["bb-283", "bb-331", "bb-302"];
const darkusTeam = ["bb-312", "bb-368", "bb-331"];
export const STARTER_DECKS: DeckRecord[] = [
  { id:"deck-pyrus",name:"Pyrus Fury",factions:["Pyrus","Ventus","Darkus"],bakuganIds:pyrusTeam,coreIds:coreLoadout(pyrusTeam),cardIds:buildDeck(["Pyrus","Ventus","Darkus"]),updatedAt:"Today",visibility:"Private",format:"standard" },
  { id:"deck-aquos",name:"Aquos Control",factions:["Aquos","Haos","Aurelus"],bakuganIds:aquosTeam,coreIds:coreLoadout(aquosTeam),cardIds:buildDeck(["Aquos","Haos","Aurelus"]),updatedAt:"Today",visibility:"Public",format:"standard" },
  { id:"deck-darkus",name:"Darkus Strike",factions:["Darkus","Ventus","Haos"],bakuganIds:darkusTeam,coreIds:coreLoadout(darkusTeam),cardIds:buildDeck(["Darkus","Ventus","Haos"]),updatedAt:"Today",visibility:"Private",format:"standard" },
];

export const deckErrors = (deck: DeckRecord) => {
  const errors: string[] = [];
  const format: DeckFormat = deck.format ?? "standard";
  const cardCopyLimit = format === "singleton" ? 1 : 3;
  const coreCopyLimit = format === "singleton" ? 1 : 6;
  const bakugan = deck.bakuganIds.map((id) => BAKUGAN.find((item) => item.id === id)).filter(Boolean) as Bakugan[];
  const cards = deck.cardIds.map((id) => CARD_BY_ID.get(id)).filter(Boolean) as GameCard[];
  const cores = deck.coreIds.map((id) => CORES.find((core) => core.id === id)).filter(Boolean) as Core[];
  if (deck.cardIds.length !== 40) errors.push("Main Deck must contain exactly 40 cards.");
  if (cards.length !== deck.cardIds.length) errors.push("Every Main Deck catalogue ID must identify exactly one card.");
  if (bakugan.length !== deck.bakuganIds.length) errors.push("Every Bakugan catalogue ID must identify exactly one Character card.");
  if (cores.length !== deck.coreIds.length) errors.push("Every BakuCore catalogue ID must identify exactly one BakuCore.");
  if (bakugan.length !== 3 || new Set(deck.bakuganIds).size !== 3) errors.push("Bakugan Team must contain three distinct Character cards.");
  if (cores.length !== 6) errors.push("Hide Matrix Kit must contain exactly six BakuCores.");
  const factions = new Set(bakugan.map((item) => item.faction));
  if (cards.some((card) => !card.factions.some((faction) => factions.has(faction)))) errors.push("Every Main Deck card must share a faction with the Bakugan Team.");
  const cardCounts = new Map<string, number>();
  for (const card of cards) { const key = `${card.name}|${card.effect}`; cardCounts.set(key, (cardCounts.get(key) ?? 0) + 1); }
  if ([...cardCounts.values()].some((count) => count > cardCopyLimit)) errors.push(`${format === "singleton" ? "Singleton" : "Standard"} allows no more than ${cardCopyLimit} cop${cardCopyLimit === 1 ? "y" : "ies"} of any Main Deck card.`);
  const coreCounts = new Map<string, number>();
  for (const id of deck.coreIds) coreCounts.set(id, (coreCounts.get(id) ?? 0) + 1);
  if ([...coreCounts.values()].some((count) => count > coreCopyLimit)) errors.push(`${format === "singleton" ? "Singleton" : "Standard"} allows no more than ${coreCopyLimit} cop${coreCopyLimit === 1 ? "y" : "ies"} of any BakuCore.`);
  const required = bakugan.flatMap((item) => item.character.coreTypes).sort();
  const selected = cores.map((core) => core.type).sort();
  if (required.join("|") !== selected.join("|")) errors.push("BakuCore types must exactly match the six Character indicators.");
  return errors;
};

export const deckIsLegal = (deck: DeckRecord) => deckErrors(deck).length === 0;

const instance = (card: GameCard, playerId: string, index: number): GameCard => ({
  ...card,
  id: `${card.catalogId}-${playerId}-${index}-${globalThis.crypto?.randomUUID?.() ?? secureIndex(0x1_0000_0000).toString(36)}`,
});
const coreInstance = (core: Core, playerId: string, index: number): Core => ({
  ...core,
  catalogId: core.catalogId ?? core.id,
  id: `${core.catalogId ?? core.id}-${playerId}-core-${index}-${globalThis.crypto?.randomUUID?.() ?? secureIndex(0x1_0000_0000).toString(36)}`,
});
export type CanonicalPlayerSelection = {
  playerId: string;
  name: string;
  deck: Pick<DeckRecord, "name" | "bakuganIds" | "coreIds" | "cardIds" | "format">;
  cosmetics?: { avatar?: string; playmat?: string; cardBack?: string };
};

const secureIndex = (maximum: number) => {
  if (maximum <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) return Math.floor(Math.random() * maximum);
  const limit = Math.floor(0x1_0000_0000 / maximum) * maximum;
  const value = new Uint32Array(1);
  do cryptoApi.getRandomValues(value); while (value[0] >= limit);
  return value[0] % maximum;
};

const shuffleCanonical = <T,>(values: T[]) => {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = secureIndex(index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
};

export const makePlayer = (id: string, name: string, deck: DeckRecord): PlayerState => {
  if (!deckIsLegal(deck)) throw new Error(deckErrors(deck).join(" "));
  const deckCards = deck.cardIds.map((key, index) => instance(CARD_BY_ID.get(key)!, id, index));
  shuffleCanonical(deckCards);
  const hand = deckCards.splice(0, 5);
  const bakugan = deck.bakuganIds.map((key, index) => {
    const base = BAKUGAN.find((item) => item.id === key)!; const character = instance(base.character, id, 100 + index);
    return { ...base, id: `${base.id}-${id}`, character, open:false, heldCoreCells:[], evoStack:[] };
  });
  return {
    id,name,bakugan,cores:deck.coreIds.map((key, index) => coreInstance(CORES.find((core) => core.id === key)!, id, index)),deck:deckCards.length,deckCards,hand,discard:[],energyZone:[],heroes:[],
    energy:0,maxEnergy:0,ready:false,connected:true,lastSeen:Date.now(),energizedThisTurn:false,cardsPlayedThisTurn:0,
  };
};

export function makeCanonicalPlayer(selection: CanonicalPlayerSelection): PlayerState {
  const playerId = String(selection.playerId ?? "").trim().slice(0, 80);
  const name = String(selection.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!playerId || !name) throw new Error("A valid player ID and display name are required.");
  const deck: DeckRecord = {
    id: `server-${playerId}`,
    name: String(selection.deck?.name ?? "Online Deck").trim().slice(0, 60),
    bakuganIds: Array.isArray(selection.deck?.bakuganIds) ? selection.deck.bakuganIds.map(String) : [],
    coreIds: Array.isArray(selection.deck?.coreIds) ? selection.deck.coreIds.map(String) : [],
    cardIds: Array.isArray(selection.deck?.cardIds) ? selection.deck.cardIds.map(String) : [],
    format: selection.deck?.format === "singleton" ? "singleton" : "standard",
    factions: [],
    updatedAt: new Date().toISOString(),
    visibility: "Private",
  };
  // makePlayer resolves every submitted ID against the immutable server
  // catalogue, performs complete deck validation, creates card instances and
  // cryptographically shuffles the canonical deck.
  return makePlayer(playerId, name, deck);
}

export const RULE_ENTRIES = [
  { title:"Start Phase",category:"Turn structure",body:"Both players draw, then the starting player and opponent each choose whether to Energize one card. Cards and abilities cannot be played during this phase." },
  { title:"Roll Phase",category:"Turn structure",body:"Choose a closed Bakugan, use the pre-roll priority window, secretly target an available Core, then resolve the server roll. Double misses repeat immediately." },
  { title:"Batch & Priority",category:"Timing",body:"Cards and abilities enter a LIFO batch. The acting player retains priority. After sequential passes, the newest object resolves; priority returns to the starting player." },
  { title:"Power & Victor",category:"Brawl",body:"After all Power Step plays resolve, compare B-Power (or Damage Rating when an effect says so). Ties are broken by repeatedly flipping and comparing Energy costs." },
  { title:"Damage & Flip",category:"Brawl",body:"Damage is flipped one card at a time. A revealed Flip pauses damage for its owner to play or decline it. FrostStrike increases its cost; Stop ends remaining damage." },
  { title:"Team Attack",category:"Brawl",body:"If all three Bakugan are open and their controller wins, combine their Damage Ratings. Only the attacking Bakugan contributes DoubleStrike and FrostStrike; all three retract afterward." },
  { title:"End Phase",category:"Turn structure",body:"Players receive a final priority window, Energy charges, turn modifiers reset, and hands above seven discard to seven before the next Start Phase." },
  { title:"Roll Accuracy",category:"Digital adaptation",body:"The toy-profile percentage used by the server to resolve a selected Bakugan's simplified physical roll." },
  { title:"Double Core Chance",category:"Digital adaptation",body:"The chance a successful open picks up a second Core. Weighting checks behind the first Core, then in front, then either side." },
  { title:"Physical rotation",category:"Digital adaptation",body:"A Bakugan completes a rotation every four Core distances. A Core three spaces ahead replaces the selected Core as the calculated landing point." },
  { title:"Undo",category:"Platform",body:"Undo restores the immediately previous state only before priority passes or new hidden/random information is revealed." },
  { title:"Disconnect",category:"Platform",body:"A disconnected player has 30 seconds to reconnect before the remaining player wins." },
];

