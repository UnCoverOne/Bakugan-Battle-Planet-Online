import { CONTROLLED_CATALOGUE } from "./content/catalogue";
import type { Bakugan, Core, CoreType, Faction, GameCard, PlayerState } from "./game";
import { deckValidationMessages, validateDeckConstruction, type DeckRestriction } from "./deck-validation";
import { MATCH_RECONNECT_GRACE_SECONDS } from "./match-constants";
import { normalizeProfileAvatar } from "./profile-customization";

const records = CONTROLLED_CATALOGUE;
export const CARDS: GameCard[] = records.map((record) => ({ ...record, id: record.id, catalogId: record.id }));
export const CARD_BY_ID = new Map(CARDS.map((card) => [card.catalogId, card]));
const BASE_CARD_BY_ID = new Map(CARDS.map((card) => [card.catalogId, {
  ...card,
  factions: [...card.factions],
  mechanics: [...card.mechanics],
  coreTypes: [...card.coreTypes],
}]));

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
const armoredAllianceSeeds: CoreSeed[] = [
  [1,"Fist",0,1,{bakuGearCostReduction:2}],
  [2,"Fist",0,2,{bakuGearCostReduction:2}],
  [3,"Fist",0,3,{bakuGearCostReduction:1}],
  [4,"Fist",50,1,{bakuGearCostReduction:2}],
  [5,"Fist",100,1,{bakuGearCostReduction:1}],
  [6,"Flaming Fist",200,3,{bakuGearCostReduction:2}],
  [7,"Flaming Fist",0,5,{bakuGearCostReduction:1}],
  [8,"Shield",100,0,{bakuGearCostReduction:2}],
  [9,"Shield",150,0,{bakuGearCostReduction:2}],
  [10,"Shield",200,0,{bakuGearCostReduction:2}],
  [11,"Shield",250,0,{bakuGearCostReduction:1}],
  [12,"Shield",300,0,{bakuGearCostReduction:1}],
  [13,"Magic Shield",400,0,{bakuGearCostReduction:2}],
  [14,"Magic Shield",500,0,{bakuGearCostReduction:1}],
  [15,"Helix",400,-1,{bakuGearCostReduction:1}],
  [16,"Helix",-100,3,{bakuGearCostReduction:2}],
  [17,"Helix",0,0,{shadowStrike:true,bakuGearCostReduction:2}],
  [69,"Helix",0,0,{frostStrike:1}],
  [70,"Fist",0,0,{fusionDamageBonus:5}],
  [71,"Fist",0,2,{fusionDamageBonus:2}],
  [72,"Flaming Fist",0,0,{fusionDamageBonus:8}],
  [73,"Flaming Fist",0,3,{fusionDamageBonus:4}],
  [74,"Shield",0,0,{fusionBonus:500}],
  [75,"Shield",200,0,{fusionBonus:200}],
  [76,"Magic Shield",0,0,{fusionBonus:800}],
  [77,"Magic Shield",300,0,{fusionBonus:400}],
  [78,"Helix",0,0,{fusionBonus:300,fusionFrostStrike:2}],
  [79,"Helix",500,2,{fusionBonus:500}],
];
const sign = (value: number, suffix: string) => value ? `${value > 0 ? "+" : ""}${value}${suffix}` : "";
const coreName = (type: CoreType, bonus: number, damageBonus: number, extra: Partial<Core>) => `${type} ${[
  sign(bonus, "B"),
  sign(damageBonus, "D"),
  extra.frostStrike ? `+${extra.frostStrike} FrostStrike` : "",
  extra.shadowStrike ? "ShadowStrike" : "",
  extra.bakuGearCostReduction ? `Baku-Gear -${extra.bakuGearCostReduction} Energy` : "",
  extra.fusionBonus ? `Fusion ${sign(extra.fusionBonus, "B")}` : "",
  extra.fusionDamageBonus ? `Fusion ${sign(extra.fusionDamageBonus, "D")}` : "",
  extra.fusionFrostStrike ? `Fusion +${extra.fusionFrostStrike} FrostStrike` : "",
].filter(Boolean).join(" / ") || "conditional"}`;
const baseCores = seeds.map(([number, type, bonus, damageBonus, extra = {}]) => ({
  id: `core-${number}`, catalogId: `core-${number}`, set: "Battle Brawlers" as const, number, type, bonus, damageBonus, ...extra,
  name: coreName(type, bonus, damageBonus, extra),
  art: `/assets/cores/full/${number}.webp`,
}));
/**
 * The supplied Armored Alliance fronts are keyed by BakuCore collector number.
 * The old threshold here incorrectly assumed every number above 52 was missing,
 * which hid the supplied fronts for 73, 75, 76, 78, and 79 behind placeholders.
 */
export const ARMORED_ALLIANCE_CORE_SCAN_NUMBERS = new Set([2, 7, 15, 16, 17, 73, 75, 76, 78, 79]);
const armoredAllianceArt = (number: number) => number <= 17 || ARMORED_ALLIANCE_CORE_SCAN_NUMBERS.has(number)
  ? `/assets/cores/armored-alliance/aa-${String(number).padStart(2, "0")}.png`
  : `/assets/cores/armored-alliance/aa-${number}-placeholder.png`;
const armoredAllianceCores = armoredAllianceSeeds.map(([number, type, bonus, damageBonus, extra = {}]) => ({
  id: `aa-core-${number}`, catalogId: `aa-core-${number}`, set: "Armored Alliance" as const, number, type, bonus, damageBonus, ...extra,
  name: `AA ${number} ${coreName(type, bonus, damageBonus, extra)}`,
  art: armoredAllianceArt(number),
}));
export const CORES: Core[] = [...baseCores, ...armoredAllianceCores];

const characterCards = CARDS.filter((card) => card.type === "Character" && card.fusionFace !== "b" && card.bPower != null && card.damage != null);
export const BAKUGAN: Bakugan[] = characterCards.map((character) => ({
  id: character.catalogId,
  name: character.displayName,
  faction: character.faction,
  bPower: character.bPower!,
  damage: character.damage!,
  rollAccuracy: /\bUltra\b/i.test(character.displayName) ? 85 : 90,
  doubleCoreChance: /\bUltra\b/i.test(character.displayName) ? 10 : 5,
  art: character.art,
  character,
  open: false,
  heldCoreCells: [],
  evoStack: [],
  bakuGear: [],
  fusionCharacter: character.fusionPairId
    ? CARDS.find((candidate) => candidate.fusionPairId === character.fusionPairId && candidate.fusionFace === "b")
    : undefined,
  fused: false,
}));

export type CardOverrideRecord = {
  catalogId: string;
  card: Partial<GameCard> & Record<string, unknown>;
};

export function applyCardOverrides(overrides: CardOverrideRecord[]) {
  for (const card of CARDS) {
    const base = BASE_CARD_BY_ID.get(card.catalogId);
    if (!base) continue;
    for (const key of Object.keys(card)) {
      if (!(key in base)) delete (card as unknown as Record<string, unknown>)[key];
    }
    Object.assign(card, base, {
      factions: [...base.factions],
      mechanics: [...base.mechanics],
      coreTypes: [...base.coreTypes],
    });
  }
  for (const override of overrides) {
    const card = CARD_BY_ID.get(override.catalogId);
    if (!card || !override.card || typeof override.card !== "object") continue;
    const base = BASE_CARD_BY_ID.get(card.catalogId) as (GameCard & { constructionIdentity?: string }) | undefined;
    const immutable = {
      id: card.id,
      catalogId: card.catalogId,
      ...(base?.constructionIdentity ? { constructionIdentity: base.constructionIdentity } : {}),
    };
    Object.assign(card, override.card, immutable);
    const bakugan = BAKUGAN.find((candidate) => candidate.id === card.catalogId);
    if (bakugan) {
      bakugan.name = card.displayName;
      bakugan.faction = card.faction;
      bakugan.bPower = card.bPower ?? bakugan.bPower;
      bakugan.damage = card.damage ?? bakugan.damage;
      bakugan.art = card.art;
      bakugan.character = card;
    }
  }
  for (const bakugan of BAKUGAN) {
    const card = CARD_BY_ID.get(bakugan.id);
    if (!card) continue;
    bakugan.name = card.displayName;
    bakugan.faction = card.faction;
    bakugan.bPower = card.bPower ?? bakugan.bPower;
    bakugan.damage = card.damage ?? bakugan.damage;
    bakugan.art = card.art;
    bakugan.character = card;
  }
  return CARDS;
}

export type DeckFormat = "standard" | "singleton" | "competitive";

export type DeckRecord = {
  id: string;
  name: string;
  factions: string[];
  bakuganIds: string[];
  coreIds: string[];
  cardIds: string[];
  updatedAt: string;
  visibility: "Draft" | "Private" | "Public";
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
    const card = pool[offset % pool.length];
    if (result.filter((id) => id === card.catalogId).length < 3) result.push(card.catalogId);
  }
  return result;
};
const coreLoadout = (bakuganIds: string[]) => {
  const requirements = bakuganIds.flatMap((id) => BAKUGAN.find((bakugan) => bakugan.id === id)?.character.coreTypes ?? []);
  const used = new Set<string>();
  return requirements.map((type) => {
    const core = CORES.find((candidate) => candidate.type === type && !used.has(candidate.id))!;
    used.add(core.id);
    return core.id;
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

export const OFFLINE_PUBLIC_DECK_SLOT_IDS = ["slot-1", "slot-2", "slot-3"] as const;
export type OfflinePublicDeckSlotId = typeof OFFLINE_PUBLIC_DECK_SLOT_IDS[number];

export const BUNDLED_OFFLINE_PUBLIC_DECKS: DeckRecord[] = [
  { ...STARTER_DECKS[1], id: "offline-slot-1", name: "Aurelus Tide Control", visibility: "Public", creator: "Mira Nova", description: "A patient Aquos control list that converts efficient Heroes and late-game Aurelus threats into a decisive Brawl.", publishedAt: "2026-07-25T18:00:00.000Z", updatedAt: "2026-07-25T18:00:00.000Z" },
  { ...STARTER_DECKS[0], id: "offline-slot-2", name: "Pyrus Fury", visibility: "Public", creator: "DanBrawler", description: "Fast pressure, flexible combat tricks, and a Pyrus-led plan built to finish Brawls before the opponent stabilizes.", publishedAt: "2026-07-23T15:30:00.000Z", updatedAt: "2026-07-23T15:30:00.000Z" },
  { ...STARTER_DECKS[2], id: "offline-slot-3", name: "Darkus Strike", visibility: "Public", creator: "Magnus", description: "Darkus disruption backed by Ventus tempo and Haos protection for a resilient midrange strategy.", publishedAt: "2026-07-21T20:00:00.000Z", updatedAt: "2026-07-21T20:00:00.000Z" },
];

/** @deprecated Bundled offline bootstrap data only. Do not merge this into the online public catalogue. */
export const PUBLIC_DECKS = BUNDLED_OFFLINE_PUBLIC_DECKS;

export const deckLeadCard = (deck: Pick<DeckRecord, "leadCardId" | "cardIds">) => {
  const selected = deck.leadCardId && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId : deck.cardIds[0];
  return selected ? CARD_BY_ID.get(selected) : undefined;
};

const deckValidationCatalogue = {
  cards: CARD_BY_ID,
  characters: new Map(BAKUGAN.map((bakugan) => [bakugan.id, bakugan])),
  cores: new Map(CORES.map((core) => [core.id, core])),
};

export const validateDeck = (deck: DeckRecord, restrictions: readonly DeckRestriction[] = []) =>
  validateDeckConstruction(deck, deckValidationCatalogue, { restrictions });
export const deckErrors = (deck: DeckRecord) => deckValidationMessages(validateDeck(deck));
export const deckIsLegal = (deck: DeckRecord) => validateDeck(deck).isLegal;

const secureIndex = (maximum: number) => {
  if (maximum <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) return Math.floor(Math.random() * maximum);
  const limit = Math.floor(0x1_0000_0000 / maximum) * maximum;
  const value = new Uint32Array(1);
  do cryptoApi.getRandomValues(value); while (value[0] >= limit);
  return value[0] % maximum;
};

const opaqueCardInstanceId = (playerId: string, index: number) => (
  globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${playerId}-${index}-${secureIndex(0x1_0000_0000).toString(36)}`
);

const instance = (card: GameCard, playerId: string, index: number): GameCard => ({
  ...card,
  id: `card-${opaqueCardInstanceId(playerId, index)}`,
});
const coreInstance = (core: Core, playerId: string, index: number): Core => ({
  ...core,
  catalogId: core.catalogId ?? core.id,
  id: `${core.catalogId ?? core.id}-${playerId}-core-${index}-${globalThis.crypto?.randomUUID?.() ?? secureIndex(0x1_0000_0000).toString(36)}`,
});
export type CanonicalPlayerSelection = {
  playerId: string;
  name: string;
  deck: Pick<DeckRecord, "name" | "bakuganIds" | "coreIds" | "cardIds" | "format"> &
    Partial<Pick<DeckRecord, "id" | "factions" | "leadCardId">>;
  cosmetics?: { avatar?: string; playmat?: string; cardBack?: string };
};

export function canonicalDeckRecord(selection: CanonicalPlayerSelection): DeckRecord {
  const playerId = String(selection.playerId ?? "").trim().slice(0, 80);
  return {
    id: String(selection.deck?.id ?? `server-${playerId}`).trim().slice(0, 100),
    name: String(selection.deck?.name ?? "Online Deck").trim().slice(0, 60),
    bakuganIds: Array.isArray(selection.deck?.bakuganIds) ? selection.deck.bakuganIds.map(String) : [],
    coreIds: Array.isArray(selection.deck?.coreIds) ? selection.deck.coreIds.map(String) : [],
    cardIds: Array.isArray(selection.deck?.cardIds) ? selection.deck.cardIds.map(String) : [],
    format: selection.deck?.format === "singleton" || selection.deck?.format === "competitive" ? selection.deck.format : "standard",
    factions: Array.isArray(selection.deck?.factions) ? selection.deck.factions.map(String).slice(0, 6) : [],
    leadCardId: selection.deck?.leadCardId ? String(selection.deck.leadCardId) : undefined,
    updatedAt: new Date().toISOString(),
    visibility: "Private",
  };
}

function applyCanonicalCosmetics(player: PlayerState, selection: CanonicalPlayerSelection): PlayerState {
  const avatar = normalizeProfileAvatar(selection.cosmetics?.avatar);
  if (avatar) (player as PlayerState & { avatar?: string }).avatar = avatar;
  return player;
}

export function makeCanonicalPlayerWithRestrictions(
  selection: CanonicalPlayerSelection,
  restrictions: readonly DeckRestriction[],
): PlayerState {
  const playerId = String(selection.playerId ?? "").trim().slice(0, 80);
  const name = String(selection.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!playerId || !name) throw new Error("A valid player ID and display name are required.");
  const deck = canonicalDeckRecord(selection);
  const validation = validateDeck(deck, restrictions);
  if (!validation.isLegal) throw new Error(deckValidationMessages(validation).join(" "));
  return applyCanonicalCosmetics(makePlayerUnchecked(playerId, name, deck), selection);
}

const shuffleCanonical = <T,>(values: T[]) => {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = secureIndex(index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
};

function makePlayerUnchecked(id: string, name: string, deck: DeckRecord): PlayerState {
  const deckCards = deck.cardIds.map((key, index) => instance(CARD_BY_ID.get(key)!, id, index));
  shuffleCanonical(deckCards);
  const hand = deckCards.splice(0, 5);
  const bakugan = deck.bakuganIds.map((key, index) => {
    const base = BAKUGAN.find((item) => item.id === key)!;
    const character = instance(base.character, id, 100 + index);
    return { ...base, id: `${base.id}-${id}`, character, open:false, heldCoreCells:[], evoStack:[] };
  });
  return {
    id,
    name,
    bakugan,
    cores: deck.coreIds.map((key, index) => coreInstance(CORES.find((core) => core.id === key)!, id, index)),
    deck: deckCards.length,
    deckCards,
    hand,
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    ready: false,
    connected: true,
    lastSeen: Date.now(),
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
    factionsPlayedThisTurn: [],
  };
}

export const makePlayer = (id: string, name: string, deck: DeckRecord): PlayerState => {
  if (!deckIsLegal(deck)) throw new Error(deckErrors(deck).join(" "));
  return makePlayerUnchecked(id, name, deck);
};

export function makeCanonicalPlayer(selection: CanonicalPlayerSelection): PlayerState {
  const playerId = String(selection.playerId ?? "").trim().slice(0, 80);
  const name = String(selection.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!playerId || !name) throw new Error("A valid player ID and display name are required.");
  const deck = canonicalDeckRecord(selection);
  return applyCanonicalCosmetics(makePlayer(playerId, name, deck), selection);
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
  { title:"Disconnect",category:"Platform",body:`A disconnected player has ${MATCH_RECONNECT_GRACE_SECONDS / 60} minutes to reconnect before the remaining player wins.` },
];
