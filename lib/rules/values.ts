import type {
  Bakugan,
  CardChoices,
  CardType,
  Faction,
  GameCard,
  MatchState,
  PlayerState,
} from "../game";
import type { ZoneOwner } from "./primitives";

/** The engine moment at which a dynamic value is being interpreted. */
export type EvaluationMoment = "announce" | "pay" | "resolve" | "continuous" | "event";

export type NumericComparison = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type ValueCountSource =
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

export type PlayerNumericProperty =
  | "hand-size"
  | "deck-size"
  | "discard-size"
  | "hero-count"
  | "bakugan-count"
  | "open-bakugan-count"
  | "held-bakucore-count"
  | "cards-played"
  | "factions-played"
  | "energy"
  | "payable-energy"
  | "maximum-played-card-cost";

export type BakuganNumericProperty = "power" | "damage" | "frost" | "held-bakucore-count";
export type CardNumericProperty = "printed-cost";
export type NumericProperty = PlayerNumericProperty | BakuganNumericProperty | CardNumericProperty;

export type EntityExpression =
  | { kind: "player"; owner: ZoneOwner }
  | {
      kind: "bakugan";
      selector: "chosen" | "source" | "active" | "opponent-active";
      owner?: ZoneOwner;
      choiceId?: keyof CardChoices;
    }
  | {
      kind: "card";
      selector: "chosen" | "source";
      choiceId?: keyof CardChoices;
    };

export type NumberExpression =
  | { kind: "constant"; value: number }
  | { kind: "choice-value"; choiceId: keyof CardChoices; fallback?: number }
  | { kind: "choice-count"; choiceId: keyof CardChoices }
  | {
      kind: "count";
      source: ValueCountSource;
      owner?: ZoneOwner;
      cardType?: CardType;
      faction?: Faction;
      offset?: number;
      minimum?: number;
    }
  | { kind: "property"; subject: EntityExpression; property: NumericProperty }
  | { kind: "event-value"; property: "amount"; fallback?: number }
  | { kind: "previous-result"; property: "amount" | "card-cost"; scope?: "total" | "chooser" }
  | { kind: "sum"; terms: NumberValue[] }
  | { kind: "subtract"; left: NumberValue; right: NumberValue }
  | { kind: "product"; factors: NumberValue[] }
  | { kind: "divide"; numerator: NumberValue; denominator: NumberValue }
  | { kind: "minimum"; values: NumberValue[] }
  | { kind: "maximum"; values: NumberValue[] }
  | { kind: "floor"; value: NumberValue }
  | { kind: "ceil"; value: NumberValue }
  | { kind: "absolute"; value: NumberValue }
  | { kind: "negate"; value: NumberValue }
  | { kind: "clamp"; value: NumberValue; minimum?: NumberValue; maximum?: NumberValue }
  | { kind: "conditional"; condition: BooleanValue; whenTrue: NumberValue; whenFalse: NumberValue }
  | {
      /**
       * Preserve a value from a specific rules moment. `captureNumberValue` stores
       * it on the pending play/rule object; later evaluations reuse that number.
       */
      kind: "captured";
      key: string;
      at: Exclude<EvaluationMoment, "continuous">;
      value: NumberValue;
    };

export type NumberValue = number | NumberExpression;

export type BooleanExpression =
  | { kind: "constant"; value: boolean }
  | { kind: "compare-number"; left: NumberValue; operator: NumericComparison; right: NumberValue }
  | { kind: "and"; conditions: BooleanValue[] }
  | { kind: "or"; conditions: BooleanValue[] }
  | { kind: "not"; condition: BooleanValue }
  | { kind: "selection-made"; choiceId: keyof CardChoices }
  | { kind: "mode-selected"; mode: string }
  | { kind: "entity-exists"; subject: EntityExpression }
  | { kind: "has-faction"; subject: EntityExpression; faction: Faction };

export type BooleanValue = boolean | BooleanExpression;

export type EventValueContext = {
  amount?: number;
  playerId?: string;
  sourceId?: string;
  targetId?: string;
};

export type ValueEvaluationContext = {
  controllerId: string;
  chooserId?: string;
  chosenPlayerId?: string;
  choices?: CardChoices;
  sourceBakuganId?: string;
  sourceCardId?: string;
  moment?: EvaluationMoment;
  event?: EventValueContext;
  /** Most recent earlier result-bearing action in the same resolving rules object. */
  previousResult?: { amount: number; amountByPlayer?: Record<string, number>; cardCost?: number };
  capturedValues?: Record<string, number>;
  /** Optional final-characteristic resolver supplied by the modifier engine. */
  characteristics?: (bakugan: Bakugan, owner: PlayerState) => { power: number; damage: number; frostStrike?: number };
};

type ResolvedEntity =
  | { kind: "player"; player: PlayerState }
  | { kind: "bakugan"; bakugan: Bakugan; owner: PlayerState }
  | { kind: "card"; card: GameCard; owner?: PlayerState };

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function playerIdsForOwner(state: MatchState, owner: ZoneOwner, context: ValueEvaluationContext) {
  const known = state.players.map((player) => player.id);
  const chosen = context.chosenPlayerId ?? context.choices?.targetPlayerId;
  const unique = (values: Array<string | undefined>) => values
    .filter((value): value is string => Boolean(value && known.includes(value)))
    .filter((value, index, values) => values.indexOf(value) === index);

  if (owner === "controller") return unique([context.controllerId]);
  if (owner === "opponent") return known.filter((id) => id !== context.controllerId);
  if (owner === "chooser") return unique([context.chooserId]);
  if (owner === "chosen-player") return unique([chosen]);
  if (owner === "each-player") return context.chooserId ? unique([context.chooserId]) : known;
  return known;
}

function findCard(state: MatchState, id: string | undefined) {
  if (!id) return undefined;
  for (const owner of state.players) {
    const zones = [owner.hand, owner.deckCards, owner.discard, owner.energyZone, owner.heroes];
    for (const zone of zones) {
      const card = zone.find((candidate) => candidate.id === id);
      if (card) return { card, owner };
    }
    for (const bakugan of owner.bakugan) {
      const cards = [bakugan.character, ...bakugan.evoStack];
      const card = cards.find((candidate) => candidate.id === id);
      if (card) return { card, owner };
    }
  }
  const batch = state.batch.find((candidate) => candidate.card.id === id || candidate.id === id);
  return batch ? { card: batch.card, owner: state.players.find((candidate) => candidate.id === batch.controllerId) } : undefined;
}

function resolveEntity(state: MatchState, subject: EntityExpression, context: ValueEvaluationContext): ResolvedEntity | undefined {
  if (subject.kind === "player") {
    const id = playerIdsForOwner(state, subject.owner, context)[0];
    const player = state.players.find((candidate) => candidate.id === id);
    return player ? { kind: "player", player } : undefined;
  }

  if (subject.kind === "card") {
    const id = subject.selector === "source"
      ? context.sourceCardId
      : String(context.choices?.[subject.choiceId ?? "targetCardId"] ?? "");
    const found = findCard(state, id);
    return found ? { kind: "card", ...found } : undefined;
  }

  let id: string | undefined;
  if (subject.selector === "source") id = context.sourceBakuganId ?? context.choices?.sourceBakuganId;
  else if (subject.selector === "chosen") {
    const selected = context.choices?.[subject.choiceId ?? "targetBakuganId"];
    id = typeof selected === "string" ? selected : undefined;
  } else {
    const owner = subject.selector === "opponent-active" ? "opponent" : subject.owner ?? "controller";
    const ownerId = playerIdsForOwner(state, owner, context)[0];
    if (ownerId) {
      const player = state.players.find((candidate) => candidate.id === ownerId);
      id = player ? state.selected[player.id] ?? player.bakugan.find((candidate) => candidate.open)?.id : undefined;
    }
  }

  for (const owner of state.players) {
    const bakugan = owner.bakugan.find((candidate) => candidate.id === id);
    if (bakugan) return { kind: "bakugan", bakugan, owner };
  }
  return undefined;
}

function cardMatches(card: GameCard, expression: Extract<NumberExpression, { kind: "count" }>) {
  return (!expression.cardType || card.type === expression.cardType)
    && (!expression.faction || card.factions.includes(expression.faction));
}

function countForPlayer(state: MatchState, player: PlayerState, expression: Extract<NumberExpression, { kind: "count" }>) {
  const bakuganHasFaction = (bakugan: Bakugan) => {
    if (!expression.faction) return true;
    const top = bakugan.evoStack.at(-1) ?? bakugan.character;
    return (top.factions?.length ? top.factions : [bakugan.faction]).includes(expression.faction);
  };
  switch (expression.source) {
    case "hand": return player.hand.filter((card) => cardMatches(card, expression)).length;
    case "deck": return player.deckCards.filter((card) => cardMatches(card, expression)).length;
    case "discard": return player.discard.filter((card) => cardMatches(card, expression)).length;
    case "energy": return player.energyZone.filter((card) => cardMatches(card, expression)).length;
    case "hero": return player.heroes.filter((card) => cardMatches(card, expression)).length;
    case "bakugan": return player.bakugan.filter(bakuganHasFaction).length;
    case "open-bakugan": return player.bakugan.filter((bakugan) => bakugan.open && bakuganHasFaction(bakugan)).length;
    case "held-bakucore": return player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    case "cards-played": return player.cardsPlayedThisTurn;
    case "factions-played": return new Set(player.factionsPlayedThisTurn ?? []).size;
  }
}

function playerProperty(player: PlayerState, property: PlayerNumericProperty) {
  switch (property) {
    case "hand-size": return player.hand.length;
    case "deck-size": return player.deckCards.length;
    case "discard-size": return player.discard.length;
    case "hero-count": return player.heroes.length;
    case "bakugan-count": return player.bakugan.length;
    case "open-bakugan-count": return player.bakugan.filter((bakugan) => bakugan.open).length;
    case "held-bakucore-count": return player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    case "cards-played": return player.cardsPlayedThisTurn;
    case "factions-played": return new Set(player.factionsPlayedThisTurn ?? []).size;
    case "energy": return player.energy;
    case "payable-energy": return player.energyZone.length + Math.max(0, player.energy);
    case "maximum-played-card-cost": return Math.max(0, ...(player.playedCardCostsThisTurn ?? []));
  }
}

function evaluateProperty(state: MatchState, expression: Extract<NumberExpression, { kind: "property" }>, context: ValueEvaluationContext) {
  const entity = resolveEntity(state, expression.subject, context);
  if (!entity) return 0;
  if (entity.kind === "player") return playerProperty(entity.player, expression.property as PlayerNumericProperty);
  if (entity.kind === "card") {
    if (expression.property !== "printed-cost") return 0;
    return entity.card.cost === "X" ? Math.max(0, Number(context.choices?.xValue ?? 0)) : entity.card.cost;
  }
  if (expression.property === "held-bakucore-count") return entity.bakugan.heldCoreCells.length;
  const characteristics = context.characteristics?.(entity.bakugan, entity.owner);
  if (expression.property === "power") {
    return characteristics?.power
      ?? (entity.bakugan.evoStack.at(-1)?.bPower ?? entity.bakugan.character.bPower ?? entity.bakugan.bPower)
        + (state.powerBoost[entity.bakugan.id] ?? 0);
  }
  if (expression.property === "damage") {
    return characteristics?.damage
      ?? (entity.bakugan.evoStack.at(-1)?.damage ?? entity.bakugan.character.damage ?? entity.bakugan.damage)
        + (state.damageBoost[entity.bakugan.id] ?? 0);
  }
  if (expression.property === "frost") return characteristics?.frostStrike ?? state.frostStrike[entity.bakugan.id] ?? 0;
  return 0;
}

function choiceCount(value: CardChoices[keyof CardChoices]) {
  if (Array.isArray(value)) return value.length;
  return value == null || value === false || value === "" ? 0 : 1;
}

export function evaluateNumberValue(state: MatchState, value: NumberValue, context: ValueEvaluationContext): number {
  if (typeof value === "number") return finite(value);
  switch (value.kind) {
    case "constant": return finite(value.value);
    case "choice-value": {
      const selected = context.choices?.[value.choiceId];
      if (typeof selected === "number") return finite(selected);
      if (typeof selected === "string" && Number.isFinite(Number(selected))) return Number(selected);
      return finite(value.fallback ?? 0);
    }
    case "choice-count": return choiceCount(context.choices?.[value.choiceId]);
    case "count": {
      const ownerIds = playerIdsForOwner(state, value.owner ?? "controller", context);
      const counted = ownerIds.reduce((sum, id) => {
        const player = state.players.find((candidate) => candidate.id === id);
        return sum + (player ? countForPlayer(state, player, value) : 0);
      }, 0);
      return Math.max(value.minimum ?? 0, counted + (value.offset ?? 0));
    }
    case "property": return finite(evaluateProperty(state, value, context));
    case "event-value": return finite(context.event?.[value.property] ?? value.fallback ?? 0);
    case "previous-result": {
      if (value.property === "card-cost") return finite(context.previousResult?.cardCost ?? 0);
      if (value.scope === "chooser" && context.chooserId) {
        return finite(context.previousResult?.amountByPlayer?.[context.chooserId] ?? 0);
      }
      return finite(context.previousResult?.amount ?? 0);
    }
    case "sum": return finite(value.terms.reduce((sum, term) => sum + evaluateNumberValue(state, term, context), 0));
    case "subtract": return finite(evaluateNumberValue(state, value.left, context) - evaluateNumberValue(state, value.right, context));
    case "product": return finite(value.factors.reduce((product, factor) => product * evaluateNumberValue(state, factor, context), 1));
    case "divide": {
      const denominator = evaluateNumberValue(state, value.denominator, context);
      return denominator === 0 ? 0 : finite(evaluateNumberValue(state, value.numerator, context) / denominator);
    }
    case "minimum": return value.values.length ? Math.min(...value.values.map((candidate) => evaluateNumberValue(state, candidate, context))) : 0;
    case "maximum": return value.values.length ? Math.max(...value.values.map((candidate) => evaluateNumberValue(state, candidate, context))) : 0;
    case "floor": return Math.floor(evaluateNumberValue(state, value.value, context));
    case "ceil": return Math.ceil(evaluateNumberValue(state, value.value, context));
    case "absolute": return Math.abs(evaluateNumberValue(state, value.value, context));
    case "negate": return -evaluateNumberValue(state, value.value, context);
    case "clamp": {
      let resolved = evaluateNumberValue(state, value.value, context);
      if (value.minimum != null) resolved = Math.max(resolved, evaluateNumberValue(state, value.minimum, context));
      if (value.maximum != null) resolved = Math.min(resolved, evaluateNumberValue(state, value.maximum, context));
      return finite(resolved);
    }
    case "conditional": return evaluateBooleanValue(state, value.condition, context)
      ? evaluateNumberValue(state, value.whenTrue, context)
      : evaluateNumberValue(state, value.whenFalse, context);
    case "captured": return context.capturedValues?.[value.key]
      ?? evaluateNumberValue(state, value.value, context);
  }
}

function compare(left: number, operator: NumericComparison, right: number) {
  switch (operator) {
    case "==": return left === right;
    case "!=": return left !== right;
    case "<": return left < right;
    case "<=": return left <= right;
    case ">": return left > right;
    case ">=": return left >= right;
  }
}

export function evaluateBooleanValue(state: MatchState, value: BooleanValue, context: ValueEvaluationContext): boolean {
  if (typeof value === "boolean") return value;
  switch (value.kind) {
    case "constant": return value.value;
    case "compare-number": return compare(
      evaluateNumberValue(state, value.left, context),
      value.operator,
      evaluateNumberValue(state, value.right, context),
    );
    case "and": return value.conditions.every((condition) => evaluateBooleanValue(state, condition, context));
    case "or": return value.conditions.some((condition) => evaluateBooleanValue(state, condition, context));
    case "not": return !evaluateBooleanValue(state, value.condition, context);
    case "selection-made": return choiceCount(context.choices?.[value.choiceId]) > 0;
    case "mode-selected": return context.choices?.mode === value.mode || context.choices?.paymentMode === value.mode;
    case "entity-exists": return Boolean(resolveEntity(state, value.subject, context));
    case "has-faction": {
      const entity = resolveEntity(state, value.subject, context);
      if (!entity) return false;
      if (entity.kind === "card") return entity.card.factions.includes(value.faction);
      if (entity.kind === "bakugan") return entity.bakugan.faction === value.faction;
      return entity.player.bakugan.some((bakugan) => bakugan.faction === value.faction)
        || entity.player.heroes.some((card) => card.factions.includes(value.faction));
    }
  }
}

function walkNumberValue(
  state: MatchState,
  value: NumberValue,
  context: ValueEvaluationContext,
  store: Record<string, number>,
) {
  if (typeof value === "number") return;
  if (value.kind === "captured") {
    if (value.at === context.moment && store[value.key] == null) {
      store[value.key] = evaluateNumberValue(state, value.value, { ...context, capturedValues: store });
    }
    walkNumberValue(state, value.value, context, store);
    return;
  }
  if (value.kind === "sum") value.terms.forEach((item) => walkNumberValue(state, item, context, store));
  else if (value.kind === "subtract") {
    walkNumberValue(state, value.left, context, store);
    walkNumberValue(state, value.right, context, store);
  } else if (value.kind === "product") value.factors.forEach((item) => walkNumberValue(state, item, context, store));
  else if (value.kind === "divide") {
    walkNumberValue(state, value.numerator, context, store);
    walkNumberValue(state, value.denominator, context, store);
  } else if (value.kind === "minimum" || value.kind === "maximum") value.values.forEach((item) => walkNumberValue(state, item, context, store));
  else if (["floor", "ceil", "absolute", "negate"].includes(value.kind)) {
    walkNumberValue(state, (value as Extract<NumberExpression, { kind: "floor" | "ceil" | "absolute" | "negate" }>).value, context, store);
  } else if (value.kind === "clamp") {
    walkNumberValue(state, value.value, context, store);
    if (value.minimum != null) walkNumberValue(state, value.minimum, context, store);
    if (value.maximum != null) walkNumberValue(state, value.maximum, context, store);
  } else if (value.kind === "conditional") {
    walkNumberValue(state, value.whenTrue, context, store);
    walkNumberValue(state, value.whenFalse, context, store);
  }
}

/** Capture every `captured` node whose requested moment matches the context. */
export function captureNumberValue(
  state: MatchState,
  value: NumberValue,
  context: ValueEvaluationContext,
  store: Record<string, number> = context.capturedValues ?? {},
) {
  walkNumberValue(state, value, context, store);
  return store;
}

export const constantNumber = (value: number): NumberExpression => ({ kind: "constant", value });
