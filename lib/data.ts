import { CONTROLLED_CATALOGUE } from "./content/catalogue";
import type { Bakugan, Core, CoreType, Faction, GameCard, PlayerState } from "./game";
import { deckValidationMessages, validateDeckConstruction } from "./deck-validation";

const records = CONTROLLED_CATALOGUE;
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
  revision?: number;
  favourite?: boolean;
  tags?: string[];
  notes?: string;
  conflictOf?: string;
  leadCardId?: string;
  creator?: string;
  description?: string;
  publishedAt?: string;
  sourceDeckId?: string;
  sourceCreator?: string;
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
const pyrusCards = buildDeck(["Pyrus","Ventus","Darkus"]);
const aquosCards = buildDeck(["Aquos","Haos","Aurelus"]);
const darkusCards = buildDeck(["Darkus","Ventus","Haos"]);
export const STARTER_DECKS: DeckRecord[] = [
  { id:"deck-pyrus",name:"Pyrus Fury",factions:["Pyrus","Ventus","Darkus"],bakuganIds:pyrusTeam,coreIds:coreLoadout(pyrusTeam),cardIds:pyrusCards,leadCardId:pyrusCards[0],updatedAt:"2026-07-24T00:00:00.000Z",visibility:"Private",format:"standard",revision:1 },
  { id:"deck-aquos",name:"Aquos Control",factions:["Aquos","Haos","Aurelus"],bakuganIds:aquosTeam,coreIds:coreLoadout(aquosTeam),cardIds:aquosCards,leadCardId:aquosCards[0],updatedAt:"2026-07-24T00:00:00.000Z",visibility:"Public",format:"standard",revision:1 },
  { id:"deck-darkus",name:"Darkus Strike",factions:["Darkus","Ventus","Haos"],bakuganIds:darkusTeam,coreIds:coreLoadout(darkusTeam),cardIds:darkusCards,leadCardId:darkusCards[0],updatedAt:"2026-07-24T00:00:00.000Z",visibility:"Private",format:"standard",revision:1 },
];

export const PUBLIC_DECKS: DeckRecord[] = [
  { ...STARTER_DECKS[1], id: "public-aquos-control", name: "Aurelus Tide Control", visibility: "Public", creator: "Mira Nova", description: "A patient Aquos control list that converts efficient Heroes and late-game Aurelus threats into a decisive Brawl.", publishedAt: "2026-07-25T18:00:00.000Z", updatedAt: "2026-07-25T18:00:00.000Z" },
  { ...STARTER_DECKS[0], id: "public-pyrus-fury", name: "Pyrus Fury", visibility: "Public", creator: "DanBrawler", description: "Fast pressure, flexible combat tricks, and a Pyrus-led plan built to finish Brawls before the opponent stabilizes.", publishedAt: "2026-07-23T15:30:00.000Z", updatedAt: "2026-07-23T15:30:00.000Z" },
  { ...STARTER_DECKS[2], id: "public-darkus-strike", name: "Darkus Strike", visibility: "Public", creator: "Magnus", description: "Darkus disruption backed by Ventus tempo and Haos protection for a resilient midrange strategy.", publishedAt: "2026-07-21T20:00:00.000Z", updatedAt: "2026-07-21T20:00:00.000Z" },
];

export const deckLeadCard = (deck: Pick<DeckRecord, "leadCardId" | "cardIds">) => {
  const selected = deck.leadCardId && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId : deck.cardIds[0];
  return selected ? CARD_BY_ID.get(selected) : undefined;
};

const deckValidationCatalogue = {
  cards: CARD_BY_ID,
  characters: new Map(BAKUGAN.map((bakugan) => [bakugan.id, bakugan])),
  cores: new Map(CORES.map((core) => [core.id, core])),
};

export const validateDeck = (deck: DeckRecord) => validateDeckConstruction(deck, deckValidationCatalogue);
export const deckErrors = (deck: DeckRecord) => deckValidationMessages(validateDeck(deck));
export const deckIsLegal = (deck: DeckRecord) => validateDeck(deck).isLegal;

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

