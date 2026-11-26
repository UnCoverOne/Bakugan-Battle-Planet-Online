import { BAKUGAN, CARD_BY_ID, canonicalDeckRecord, validateDeck, type DeckRecord } from "./data";
import { deckAllowedInMeta } from "./meta-formats";
import { deckConstructionIdentity } from "./deck-validation";
import type { LobbyConfiguration, LobbyMode } from "./lobby-session";
import type { RankedRuleset } from "./ranked";

export type PreparedMember = { decks: DeckRecord[]; ready: boolean };
export type LobbyPreparation = { members: Record<string, PreparedMember>; aiDeck: DeckRecord | null; ruleset: RankedRuleset | null };
export const emptyPreparation = (): LobbyPreparation => ({ members: {}, aiDeck: null, ruleset: null });
export const requiredDeckCount = (mode: LobbyMode) => mode === "ranked" ? 3 : 1;
export const emptyPreparedMember = (): PreparedMember => ({ decks: [], ready: false });

export function canonicalLobbyDeck(value: unknown, memberId: string): DeckRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid deck");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !input.id.trim() || typeof input.name !== "string" || !input.name.trim()) throw new Error("Invalid deck");
  const list = (name: string, maximum: number) => {
    const values = input[name];
    if (!Array.isArray(values) || values.length > maximum || !values.every(v => typeof v === "string" && v.length > 0 && v.length <= 120)) throw new Error("Invalid deck");
    return values as string[];
  };
  if (input.format != null && !["standard","singleton","competitive"].includes(String(input.format))) throw new Error("Wrong format");
  const deck = canonicalDeckRecord({ playerId:memberId,name:"Brawler",deck:{
    id:input.id,name:input.name,format: input.format as DeckRecord["format"],
    bakuganIds:list("bakuganIds",3),coreIds:list("coreIds",6),cardIds:list("cardIds",200),
    leadCardId:typeof input.leadCardId==="string" ? input.leadCardId.slice(0,120) : undefined,
  } });
  // Derive faction metadata from canonical character identities, never client claims.
  deck.factions = [...new Set(deck.bakuganIds.flatMap(id => BAKUGAN.filter(b => b.id===id).map(b=>b.faction)))];
  if (!deck.leadCardId || !deck.cardIds.includes(deck.leadCardId)) deck.leadCardId=deck.cardIds[0];
  if (input.printingPreferences && typeof input.printingPreferences === "object" && !Array.isArray(input.printingPreferences)) {
    const entries = Object.entries(input.printingPreferences).filter(([k,v])=>k.length<=120 && typeof v==="string" && v.length<=120).slice(0,220) as [string,string][];
    deck.printingPreferences=Object.fromEntries(entries);
  }
  return deck;
}

export function deckProblem(deck: DeckRecord, configuration: LobbyConfiguration, ruleset: RankedRuleset | null): string | null {
  if ((deck.format ?? "standard") !== configuration.format) return "Wrong format";
  const size=configuration.format==="competitive" ? ruleset?.deckSize ?? 50 : 40;
  if (deck.bakuganIds.length!==3 || deck.coreIds.length!==6 || deck.cardIds.length!==size) return "Incomplete deck";
  if (!deckAllowedInMeta(configuration.meta,deck)) return "Outside meta";
  const validation=validateDeck(deck,ruleset?.restrictions ?? [],size);
  if (!validation.isLegal) return validation.issues.some(issue=>issue.code==="main_deck.ranked_restriction") ? "Restricted cards" : "Invalid deck";
  return null;
}
function fingerprint(deck: DeckRecord) {
  const identities=deck.cardIds.map(id=>{const card=CARD_BY_ID.get(id);return card ? deckConstructionIdentity(card) : id;});
  return JSON.stringify([ [...deck.bakuganIds].sort(), [...deck.coreIds].sort(), identities.sort() ]);
}
export function rosterProblem(decks: readonly DeckRecord[], mode: LobbyMode, configuration: LobbyConfiguration, ruleset: RankedRuleset | null, requireComplete=true): string | null {
  if (decks.length>requiredDeckCount(mode) || (requireComplete && decks.length!==requiredDeckCount(mode))) return "Incomplete selection";
  if (new Set(decks.map(d=>d.id)).size!==decks.length || new Set(decks.map(fingerprint)).size!==decks.length) return "Already selected";
  for (const deck of decks) { const problem=deckProblem(deck,configuration,ruleset);if(problem)return problem; }
  return null;
}

export function clearPreparationReadiness(preparation: LobbyPreparation): LobbyPreparation {
  return {...preparation,members:Object.fromEntries(Object.entries(preparation.members).map(([id,value])=>[id,{...value,ready:false}]))};
}
export function deckPreview(deck: DeckRecord) {
  return {id:deck.id,name:deck.name,bakuganIds:deck.bakuganIds,factions:deck.factions,leadCardId:deck.leadCardId,format:deck.format};
}
