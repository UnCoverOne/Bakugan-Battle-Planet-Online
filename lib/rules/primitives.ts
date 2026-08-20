import type { CardChoices, Faction, MatchState } from "../game";
import {
  evaluateNumberValue,
  type NumberExpression,
  type ValueCountSource,
} from "./values";

/** Players affected by an effect, independent of who makes any choices for it. */
export type PlayerScope =
  | "controller"
  | "opponent"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any-player";

/** Player(s) responsible for making a choice. */
export type ChooserOwner = "controller" | "opponent" | "chosen-player" | "each-player";

/** Owner of the zone/object pool from which a choice may select. */
export type ZoneOwner =
  | "controller"
  | "opponent"
  | "chooser"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any";

export type OwnershipContext = {
  controllerId: string;
  chooserId?: string;
  chosenPlayerId?: string;
  choices?: CardChoices;
};

function knownPlayerIds(match: MatchState) {
  return match.players.map((player) => player.id);
}

function uniqueKnownPlayers(match: MatchState, values: Array<string | undefined>) {
  const known = new Set(knownPlayerIds(match));
  return values.filter((value): value is string => Boolean(value && known.has(value)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function playerIdsForScope(
  match: MatchState,
  scope: PlayerScope,
  context: OwnershipContext,
): string[] {
  const chosen = context.chosenPlayerId ?? context.choices?.targetPlayerId;
  if (scope === "controller") return uniqueKnownPlayers(match, [context.controllerId]);
  if (scope === "opponent") return knownPlayerIds(match).filter((id) => id !== context.controllerId);
  if (scope === "chosen-player") return uniqueKnownPlayers(match, [chosen]);
  return knownPlayerIds(match);
}

export function chooserIdsFor(
  match: MatchState,
  chooser: ChooserOwner,
  context: OwnershipContext,
): string[] {
  if (chooser === "controller") return playerIdsForScope(match, "controller", context);
  if (chooser === "opponent") return playerIdsForScope(match, "opponent", context);
  if (chooser === "chosen-player") return playerIdsForScope(match, "chosen-player", context);
  return playerIdsForScope(match, "each-player", context);
}

export function zoneOwnerIdsFor(
  match: MatchState,
  owner: ZoneOwner,
  context: OwnershipContext,
): string[] {
  if (owner === "chooser") return uniqueKnownPlayers(match, [context.chooserId]);
  if (owner === "any" || owner === "all-players") return knownPlayerIds(match);
  if (owner === "each-player") {
    return context.chooserId
      ? uniqueKnownPlayers(match, [context.chooserId])
      : knownPlayerIds(match);
  }
  return playerIdsForScope(match, owner, context);
}

/** @deprecated Use ValueCountSource. Retained for serialized/card-authoring compatibility. */
export type AmountCountSource = ValueCountSource;
/** @deprecated Use NumberExpression. All amount expressions now use the same AST/evaluator. */
export type AmountExpression = NumberExpression;
export type AmountEvaluationContext = OwnershipContext;

/**
 * Compatibility entry point for older callers. AmountExpression is now an alias
 * of NumberExpression, so this delegates to the one generalized evaluator.
 */
export function evaluateAmountExpression(
  match: MatchState,
  expression: AmountExpression,
  context: AmountEvaluationContext,
): number {
  return evaluateNumberValue(match, expression, {
    controllerId: context.controllerId,
    chooserId: context.chooserId,
    chosenPlayerId: context.chosenPlayerId,
    choices: context.choices,
    moment: "resolve",
  });
}

const multiply = (value: number, expression: AmountExpression): AmountExpression => ({
  kind: "product",
  factors: [{ kind: "constant", value }, expression],
});

/** Convert the catalogue's common "for each" grammar into a serializable NumberExpression AST. */
export function amountExpressionForScale(
  text: string,
  baseAmount: number,
  scale?: string,
): AmountExpression | undefined {
  if (!scale) return undefined;
  const grammar = `${scale} ${text}`;
  if (/sacrificed-card|sacrifice/i.test(scale)) {
    return multiply(baseAmount, { kind: "choice-count", choiceId: "discardCardIds" });
  }
  if (/other-card-played/i.test(scale) || /other card.*played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "cards-played", owner: "controller", offset: -1, minimum: 0 });
  }
  const faction = grammar.match(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1] as Faction | undefined;
  if (faction && /Bakugan on your team/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "bakugan", owner: "controller", faction });
  }
  if (/Flip card.*discard/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "discard", owner: "controller", cardType: "Flip" });
  }
  if (/Hero(?: card)?s? (?:you )?(?:have|control)?\s*in play|Hero you have in play/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "hero", owner: "controller" });
  }
  if (/Energy card.*you have|Energy cards? in play/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "energy", owner: "controller" });
  }
  if (/BakuCore.*your Bakugan hold/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "held-bakucore", owner: "controller" });
  }
  if (/open Bakugan/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "open-bakugan", owner: "controller" });
  }
  if (/cards? (?:you have )?played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "cards-played", owner: "controller" });
  }
  if (/different factions?.*played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "factions-played", owner: "controller" });
  }
  return undefined;
}

export function playerScopeForText(text: string): PlayerScope {
  if (/\beach player\b/i.test(text)) return "each-player";
  if (/\ball players\b|\bboth players\b/i.test(text)) return "all-players";
  if (/\b(?:your )?opponent\b|\bopposing player\b/i.test(text)) return "opponent";
  return "controller";
}
