import type { Bakugan, GameCard } from "../game";
import type { RuleDefinition, RulesCardId } from "./model";

export type CardDefinitionIdentity = RulesCardId;
export type CardPrintingIdentity = `${RulesCardId}:printing:${string}`;
export type CardInstanceIdentity = string;
export type CharacterIdentity = RulesCardId;

export function cardDefinitionId(card: Pick<GameCard, "catalogId" | "number">): CardDefinitionIdentity {
  return (card.catalogId || `bb-${card.number}`) as CardDefinitionIdentity;
}

export function cardPrintingId(card: Pick<GameCard, "catalogId" | "number" | "source">): CardPrintingIdentity {
  const source = String(card.source ?? "catalogue").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalogue";
  return `${cardDefinitionId(card)}:printing:${source}`;
}

export function characterIdentity(bakugan: Pick<Bakugan, "character">): CharacterIdentity {
  return cardDefinitionId(bakugan.character);
}

export function canonicalEvoTargetAllowed(definition: RuleDefinition, bakugan: Bakugan | null | undefined) {
  if (!bakugan || definition.cardType !== "Evo") return false;
  // A Fusion Evo identifies the fused Character face (b), not the unfused
  // Character printed on the other side. Never allow that target before Fusion.
  const activeFace = bakugan.fused ? bakugan.fusionCharacter : bakugan.character;
  if (!activeFace) return false;
  return definition.play.evolvesFrom.includes(cardDefinitionId(activeFace));
}
