import type { CardChoices, CardType, Faction, MatchState } from "../game";

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

export type AmountCountSource =
  | "hand"
  | "deck"
  | "discard"
  | "energy"
  | "hero"
  | "bakugan"
  | "open-bakugan"
  | "held-bakucore"
  | "cards-played"
  | "factions-played";

export type AmountExpression =
  | { kind: "constant"; value: number }
  | { kind: "choice-value"; choiceId: keyof CardChoices; fallback?: number }
  | { kind: "choice-count"; choiceId: keyof CardChoices }
  | {
      kind: "count";
      source: AmountCountSource;
      owner?: ZoneOwner;
      cardType?: CardType;
      faction?: Faction;
      offset?: number;
      minimum?: number;
    }
  | { kind: "sum"; terms: AmountExpression[] }
  | { kind: "product"; factors: AmountExpression[] }
  | { kind: "minimum"; values: AmountExpression[] }
  | { kind: "maximum"; values: AmountExpression[] };

export type AmountEvaluationContext = OwnershipContext;

function countForPlayer(
  match: MatchState,
  playerId: string,
  expression: Extract<AmountExpression, { kind: "count" }>,
) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return 0;
  const cardMatches = (card: { type: CardType; factions: Faction[] }) => (
    (!expression.cardType || card.type === expression.cardType)
    && (!expression.faction || card.factions.includes(expression.faction))
  );
  switch (expression.source) {
    case "hand": return player.hand.filter(cardMatches).length;
    case "deck": return player.deckCards.filter(cardMatches).length;
    case "discard": return player.discard.filter(cardMatches).length;
    case "energy": return player.energyZone.filter(cardMatches).length;
    case "hero": return player.heroes.filter(cardMatches).length;
    case "bakugan": return player.bakugan.filter((bakugan) => !expression.faction || bakugan.faction === expression.faction).length;
    case "open-bakugan": return player.bakugan.filter((bakugan) => bakugan.open && (!expression.faction || bakugan.faction === expression.faction)).length;
    case "held-bakucore": return player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    case "cards-played": return player.cardsPlayedThisTurn;
    case "factions-played": return player.factionsPlayedThisTurn?.length ?? 0;
  }
}

export function evaluateAmountExpression(
  match: MatchState,
  expression: AmountExpression,
  context: AmountEvaluationContext,
): number {
  let value = 0;
  switch (expression.kind) {
    case "constant": value = expression.value; break;
    case "choice-value": {
      const selected = context.choices?.[expression.choiceId];
      value = typeof selected === "number"
        ? selected
        : typeof selected === "string" && Number.isFinite(Number(selected))
          ? Number(selected)
          : expression.fallback ?? 0;
      break;
    }
    case "choice-count": {
      const selected = context.choices?.[expression.choiceId];
      value = Array.isArray(selected) ? selected.length : selected == null || selected === false ? 0 : 1;
      break;
    }
    case "count": {
      const ownerIds = zoneOwnerIdsFor(match, expression.owner ?? "controller", context);
      value = ownerIds.reduce((sum, playerId) => sum + countForPlayer(match, playerId, expression), 0);
      value += expression.offset ?? 0;
      value = Math.max(expression.minimum ?? 0, value);
      break;
    }
    case "sum": value = expression.terms.reduce((sum, term) => sum + evaluateAmountExpression(match, term, context), 0); break;
    case "product": value = expression.factors.reduce((product, factor) => product * evaluateAmountExpression(match, factor, context), 1); break;
    case "minimum": value = expression.values.length ? Math.min(...expression.values.map((item) => evaluateAmountExpression(match, item, context))) : 0; break;
    case "maximum": value = expression.values.length ? Math.max(...expression.values.map((item) => evaluateAmountExpression(match, item, context))) : 0; break;
  }
  return Number.isFinite(value) ? value : 0;
}

const multiply = (value: number, expression: AmountExpression): AmountExpression => ({
  kind: "product",
  factors: [{ kind: "constant", value }, expression],
});

/** Convert the catalogue's common "for each" grammar into a serializable amount AST. */
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
