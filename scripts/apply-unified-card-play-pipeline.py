from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str, flags=re.S) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


# ---------------------------------------------------------------------------
# Rule model: first-class play transactions, payment modes, ownership, and
# temporary cost modifiers.
# ---------------------------------------------------------------------------
model = read("lib/rules/model.ts")
model = replace_once(
    model,
    'import type { CardChoices, CardType, CoreType, Faction, GameCard } from "../game";',
    'import type { CardChoices, CardType, CoreType, Faction, GameCard, Phase } from "../game";',
    "model game imports",
)
model = replace_once(
    model,
    '  | { kind: "energy-count"; comparison: "at-least"; amount: number }\n',
    '  | { kind: "energy-count"; comparison: "at-least"; amount: number }\n'
    '  | { kind: "discard-count"; comparison: "at-least"; amount: number }\n'
    '  | { kind: "played-card-cost"; comparison: "at-least"; amount: number }\n',
    "model conditions",
)
model = replace_once(
    model,
    '  excludeSourceBakugan?: boolean;\n};',
    '  excludeSourceBakugan?: boolean;\n'
    '  /** This selector is choosing a card that an effect will play with base Energy cost 0. */\n'
    '  playForFree?: boolean;\n};',
    "choice free-play marker",
)
model = replace_once(
    model,
    'export type CostEffect =\n'
    '  | { kind: "cost-reduce"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition; appliesTo?: "self" | "controller"; scale?: CostScale }\n'
    '  | { kind: "cost-increase"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition }\n'
    '  | { kind: "cost-free"; duration: RulesDuration; condition?: RuleCondition }\n'
    '  | { kind: "cost-discard"; amount: number; choiceId: keyof CardChoices }\n'
    '  | { kind: "cost-alternative"; label: string; components: CostEffect[] };',
    'export type CostEffect =\n'
    '  | { kind: "cost-reduce"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition; appliesTo?: "self" | "controller"; scale?: CostScale }\n'
    '  | { kind: "cost-increase"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition }\n'
    '  | { kind: "cost-free"; duration: RulesDuration; condition?: RuleCondition; cardType?: CardType; appliesTo?: "self" | "controller" }\n'
    '  | { kind: "cost-discard"; amount: number; choiceId: keyof CardChoices }\n'
    '  | { kind: "cost-alternative"; id: string; label: string; setsBaseFree: boolean; components: CostEffect[]; condition?: RuleCondition };',
    "cost effect model",
)
model = replace_once(
    model,
    '  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean }',
    '  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean; cardType?: CardType; maximumCost?: number; sourceOwner?: ZoneOwner; destinationOwner?: ZoneOwner }',
    "play action model",
)
model = replace_once(
    model,
    '  | { kind: "cost"; amount: number; operation: "reduce" | "increase" | "free"; duration: RulesDuration }',
    '  | { kind: "cost"; amount: number; operation: "reduce" | "increase" | "free"; duration: RulesDuration; cardType?: CardType; playerScope?: PlayerScope }',
    "cost action scope",
)
model = replace_once(
    model,
    'export type RuleObject = {\n'
    '  rulesObjectVersion: 3;\n'
    '  id: string;\n'
    '  controllerId: string;\n',
    'export type RuleObject = {\n'
    '  rulesObjectVersion: 3;\n'
    '  id: string;\n'
    '  controllerId: string;\n'
    '  /** Physical owner of the card. This can differ from controller for effects such as Mind Control. */\n'
    '  cardOwnerId?: string;\n',
    "rule object owner",
)
insert_before_payments = '''export type CardPlaySourceZone = "hand" | "damage-reveal" | "deck" | "discard";

export type PendingCardPlay = {
  controllerId: string;
  cardId: string;
  sourceZone: CardPlaySourceZone;
  sourceOwnerId: string;
  /** Physical owner/destination owner after an Action or Flip resolves. */
  cardOwnerId: string;
  /** External effects that say “play ... for free” set only the base Energy cost to 0. */
  forcedFreeBase?: boolean;
  origin: "priority" | "effect" | "damage";
  parentEffectId?: string;
  parentNextInstructionIndex?: number;
  resumePriority?: string;
  resumeDeadline?: number;
  resumeStepLabel?: string;
  resumePhase?: Phase;
  optional?: boolean;
  choices: CardChoices;
  beforeState?: string;
  irreversibleInformation?: boolean;
};

export type StoredCostModifier = {
  id: string;
  sourceId: string;
  controllerId: string;
  kind: "free" | "reduce" | "increase";
  amount: number;
  duration: "turn" | "next-card";
  cardType?: CardType;
  playerScope: PlayerScope;
  createdTurn: number;
};

'''
model = replace_once(model, 'export type RulesPayment = {\n', insert_before_payments + 'export type RulesPayment = {\n', "play transaction types")
model = replace_once(
    model,
    '  additionalCosts: Array<{ kind: "discard"; cardIds: string[] }>;\n',
    '  additionalCosts: Array<{ kind: "discard"; amount: number; cardIds: string[] }>;\n',
    "payment additional amount",
)
model = replace_once(
    model,
    '  triggerUsage: Record<string, number>;\n  pendingPayment?: RulesPayment;\n};',
    '  triggerUsage: Record<string, number>;\n'
    '  costModifiers: StoredCostModifier[];\n'
    '  pendingPayment?: RulesPayment;\n};',
    "rules state modifiers",
)
write("lib/rules/model.ts", model)


# ---------------------------------------------------------------------------
# Rule state migration and rule-object physical ownership.
# ---------------------------------------------------------------------------
state = read("lib/rules/state.ts")
state = replace_once(
    state,
    '    state.rules = { version: 3, modifiers: [], replacements: [], triggerUsage: {} };',
    '    state.rules = { version: 3, modifiers: [], replacements: [], triggerUsage: {}, costModifiers: [] };',
    "rules state init",
)
state = replace_once(
    state,
    '  state.rules.triggerUsage = state.rules.triggerUsage && typeof state.rules.triggerUsage === "object" ? state.rules.triggerUsage : {};\n',
    '  state.rules.triggerUsage = state.rules.triggerUsage && typeof state.rules.triggerUsage === "object" ? state.rules.triggerUsage : {};\n'
    '  state.rules.costModifiers = Array.isArray(state.rules.costModifiers) ? state.rules.costModifiers : [];\n',
    "rules state normalize",
)
write("lib/rules/state.ts", state)

objects = read("lib/rules/objects.ts")
objects = replace_once(
    objects,
    '  controllerId: string;\n  card: GameCard;\n',
    '  controllerId: string;\n  cardOwnerId?: string;\n  card: GameCard;\n',
    "create object input owner",
)
objects = replace_once(
    objects,
    '    controllerId: input.controllerId,\n    card: input.card,\n',
    '    controllerId: input.controllerId,\n    cardOwnerId: input.cardOwnerId ?? input.controllerId,\n    card: input.card,\n',
    "create object owner output",
)
write("lib/rules/objects.ts", objects)


# ---------------------------------------------------------------------------
# Choice system: payment-mode choice IDs, disabled/unavailable choices, and
# free-play candidate filtering.
# ---------------------------------------------------------------------------
choices = read("lib/rules/choices.ts")
choices = replace_once(
    choices,
    'import { activeTappedEnergyIds } from "./costs";',
    'import { activeTappedEnergyIds, cardPaymentModes } from "./costs";',
    "choices cost import",
)
choices = replace_once(
    choices,
    '  card?: ChoiceCardPreview;\n};',
    '  card?: ChoiceCardPreview;\n  /** Visible but not selectable; description explains why it is unavailable. */\n  disabled?: boolean;\n};',
    "choice disabled type",
)
choices = replace_once(
    choices,
    '  playRequestId?: string;\n',
    '  playRequestId?: string;\n',
    "noop pending marker",
) if '  playRequestId?: string;\n' in choices else choices
choices = replace_once(
    choices,
    '  irreversibleInformation?: boolean;\n};',
    '  irreversibleInformation?: boolean;\n'
    '  playRequest?: import("./model").PendingCardPlay;\n'
    '  playStage?: "declare" | "additional-cost";\n'
    '  cancellable?: boolean;\n};',
    "pending choice play metadata",
)
old_hand_filter = '''        return owner.hand
          .filter((candidate) => candidate.id !== card.id && cardMatchesSpec(candidate, spec))
          .filter((candidate) => candidate.type !== "Evo" || !spec.cardType || Boolean(active && canonicalEvoTargetAllowed(ruleDefinitionForCard(candidate), active)))
          .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));'''
new_hand_filter = '''        return owner.hand
          .filter((candidate) => candidate.id !== card.id && cardMatchesSpec(candidate, spec))
          .filter((candidate) => candidate.type !== "Evo" || !spec.cardType || Boolean(active && canonicalEvoTargetAllowed(ruleDefinitionForCard(candidate), active)))
          .filter((candidate) => !spec.playForFree || cardPaymentModes(match, controllerId, candidate, {}, { forcedFreeBase: true }).some((mode) => mode.legal))
          .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));'''
choices = replace_once(choices, old_hand_filter, new_hand_filter, "free-play hand filter")
choices = replace_once(
    choices,
    '    const legal = new Set(item.options.map((candidate) => candidate.id));\n',
    '    const legal = new Set(item.options.filter((candidate) => !candidate.disabled).map((candidate) => candidate.id));\n',
    "disabled choice validation",
)
choices = replace_once(
    choices,
    '  return schema.fields.every((item) => item.options.length >= item.minimum);',
    '  return schema.fields.every((item) => item.options.filter((candidate) => !candidate.disabled).length >= item.minimum);',
    "disabled legal completion",
)
write("lib/rules/choices.ts", choices)


# ---------------------------------------------------------------------------
# Cost engine: one calculation for ordinary, automatic-free, forced-free and
# alternative-cost plays. No card-ID special cases.
# ---------------------------------------------------------------------------
costs = r'''import type { CardChoices, GameCard, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { activeFrostStrike, ruleConditionActive } from "./modifiers";
import type { CostEffect, RulesPayment } from "./model";
import { playerIdsForScope } from "./primitives";
import { ensureRulesState } from "./state";

export type CardCostBreakdown = {
  printed: number;
  xValue: number;
  reductions: number;
  increases: number;
  frostStrike: number;
  freeBase: boolean;
  additionalCosts: Array<{ kind: "discard"; amount: number; choiceId: keyof CardChoices }>;
  total: number;
};

export type CardCostContext = {
  /** External “play ... for free” effects set the base to zero before all modifiers. */
  forcedFreeBase?: boolean;
  selectedAlternativeId?: string;
};

export type CardPaymentMode = {
  id: string;
  label: string;
  freeBase: boolean;
  energyCost: number;
  additionalCosts: CardCostBreakdown["additionalCosts"];
  legal: boolean;
  reason?: string;
};

type EnergyTrackedPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };

function playerById(state: MatchState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  return player;
}

function modifierActive(state: MatchState, player: PlayerState, modifier: CostEffect) {
  return !("condition" in modifier) || ruleConditionActive(state, player, modifier.condition);
}

function choiceHasValue(choices: CardChoices, id: keyof CardChoices) {
  const selected = choices[id];
  return Array.isArray(selected) ? selected.length > 0 : selected !== undefined && selected !== false && selected !== "";
}

export function cardCostBreakdown(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: CardCostContext = {},
): CardCostBreakdown {
  const player = playerById(state, playerId);
  const definition = ruleDefinitionForCard(card);
  const capacity = player.energyZone.length + Math.max(0, player.energy);
  const xValue = card.cost === "X" ? Math.max(0, Math.min(capacity, choices.xValue ?? 0)) : 0;
  const printed = card.cost === "X" ? xValue : card.cost;
  let reductions = 0;
  let increases = 0;
  let freeBase = Boolean(context.forcedFreeBase);
  const additionalCosts: CardCostBreakdown["additionalCosts"] = [];

  const selfModifiers = definition.play.costModifiers.filter((modifier) => (
    !("appliesTo" in modifier) || modifier.appliesTo !== "controller"
  ));
  const controlledModifiers = player.heroes.flatMap((hero) => (
    ruleDefinitionForCard(hero).play.costModifiers.filter((modifier) => (
      modifier.kind === "cost-reduce"
      && modifier.appliesTo === "controller"
      && (!modifier.cardType || modifier.cardType === card.type)
    ))
  ));

  reductions += Math.max(0, state.nextCardCostReduction?.[playerId] ?? 0);

  for (const modifier of [...selfModifiers, ...controlledModifiers]) {
    if (!modifierActive(state, player, modifier)) continue;
    if (modifier.kind === "cost-reduce") {
      const variableMultiplier = modifier.scale === "cards-played-this-turn"
        ? Math.max(0, player.cardsPlayedThisTurn)
        : modifier.scale === "held-bakucore"
          ? player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0)
          : 1;
      reductions += modifier.amount * variableMultiplier;
    } else if (modifier.kind === "cost-increase") increases += modifier.amount;
    else if (modifier.kind === "cost-free") {
      if (!modifier.cardType || modifier.cardType === card.type) freeBase = true;
    } else if (modifier.kind === "cost-discard") {
      additionalCosts.push({ kind: "discard", amount: modifier.amount, choiceId: modifier.choiceId });
    } else if (modifier.kind === "cost-alternative") {
      const legacySelected = modifier.components.some((component) => (
        component.kind === "cost-discard" && choiceHasValue(choices, component.choiceId)
      ));
      const selected = context.selectedAlternativeId === modifier.id
        || choices.paymentMode === modifier.id
        || (!choices.paymentMode && legacySelected);
      if (!selected) continue;
      if (modifier.setsBaseFree) freeBase = true;
      for (const component of modifier.components) if (component.kind === "cost-discard") {
        additionalCosts.push({ kind: "discard", amount: component.amount, choiceId: component.choiceId });
      }
    }
  }

  const rules = ensureRulesState(state);
  for (const modifier of rules.costModifiers) {
    if (modifier.duration === "turn" && modifier.createdTurn !== state.turn) continue;
    if (modifier.cardType && modifier.cardType !== card.type) continue;
    const recipients = playerIdsForScope(state, modifier.playerScope, { controllerId: modifier.controllerId });
    if (!recipients.includes(playerId)) continue;
    if (modifier.kind === "free") freeBase = true;
    else if (modifier.kind === "reduce") reductions += modifier.amount;
    else increases += modifier.amount;
  }

  const frostStrike = card.type === "Flip" && state.damageOrigin ? activeFrostStrike(state, state.damageOrigin) : 0;
  const base = freeBase ? 0 : printed;
  return {
    printed,
    xValue,
    reductions,
    increases,
    frostStrike,
    freeBase,
    additionalCosts,
    total: Math.max(0, base - reductions + increases + frostStrike),
  };
}

function selectedIds(choices: CardChoices, choiceId: keyof CardChoices) {
  const value = choices[choiceId];
  return Array.isArray(value) ? value.map(String) : [];
}

function paymentLegality(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
  breakdown: CardCostBreakdown,
) {
  const player = playerById(state, playerId);
  const reasons: string[] = [];
  for (const additional of breakdown.additionalCosts) {
    const ids = selectedIds(choices, additional.choiceId);
    const available = player.hand.filter((candidate) => candidate.id !== card.id).length;
    if (ids.length) {
      const unique = new Set(ids);
      const present = player.hand.filter((candidate) => unique.has(candidate.id) && candidate.id !== card.id).length;
      if (unique.size !== additional.amount || present !== additional.amount) {
        reasons.push(`Choose exactly ${additional.amount} legal card${additional.amount === 1 ? "" : "s"} to discard.`);
      }
    } else if (available < additional.amount) {
      reasons.push(`${additional.amount} discardable card${additional.amount === 1 ? " is" : "s are"} required, but only ${available} available.`);
    }
  }
  const payable = maximumPayableEnergy(state, playerId);
  if (payable < breakdown.total) {
    reasons.push(`${breakdown.total} Energy is still required after modifiers, but only ${payable} is available.`);
  }
  return { legal: reasons.length === 0, reason: reasons.join(" ") || undefined };
}

export function cardPaymentModes(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: Pick<CardCostContext, "forcedFreeBase"> = {},
): CardPaymentMode[] {
  const player = playerById(state, playerId);
  const definition = ruleDefinitionForCard(card);
  if (context.forcedFreeBase) {
    const breakdown = cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true });
    const legality = paymentLegality(state, playerId, card, choices, breakdown);
    return [{
      id: "forced-free",
      label: "Play for free",
      freeBase: true,
      energyCost: breakdown.total,
      additionalCosts: breakdown.additionalCosts,
      ...legality,
    }];
  }

  const modes: CardPaymentMode[] = [];
  const normal = cardCostBreakdown(state, playerId, card, { ...choices, paymentMode: "normal" });
  modes.push({
    id: "normal",
    label: "Pay normal Energy cost",
    freeBase: normal.freeBase,
    energyCost: normal.total,
    additionalCosts: normal.additionalCosts,
    ...paymentLegality(state, playerId, card, choices, normal),
  });

  for (const alternative of definition.play.costModifiers.filter((modifier): modifier is Extract<CostEffect, { kind: "cost-alternative" }> => (
    modifier.kind === "cost-alternative" && modifierActive(state, player, modifier)
  ))) {
    const alternativeChoices = { ...choices, paymentMode: alternative.id };
    const breakdown = cardCostBreakdown(state, playerId, card, alternativeChoices, { selectedAlternativeId: alternative.id });
    const legality = paymentLegality(state, playerId, card, choices, breakdown);
    modes.push({
      id: alternative.id,
      label: alternative.label,
      freeBase: breakdown.freeBase,
      energyCost: breakdown.total,
      additionalCosts: breakdown.additionalCosts,
      ...legality,
    });
  }
  return modes;
}

export function activeTappedEnergyIds(player: EnergyTrackedPlayer, turn: number) {
  if (player.energyTapTurn !== turn || !Array.isArray(player.tappedEnergyIds)) return [];
  const legal = new Set(player.energyZone.map((card) => card.id));
  return player.tappedEnergyIds.filter((id) => legal.has(id));
}

export function availableEnergy(player: EnergyTrackedPlayer, turn: number) {
  return player.energyTapTurn === turn ? Math.max(0, Math.floor(player.energy)) : 0;
}

/** Maximum Energy that can be paid now, including currently untapped Energy cards. */
export function maximumPayableEnergy(state: MatchState, playerId: string) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const tapped = new Set(activeTappedEnergyIds(player, state.turn));
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id)).length;
  return availableEnergy(player, state.turn) + untapped;
}

/**
 * Recalculate the payable Energy after an effect sets a card's Energy cost to
 * free. Rule 1.15.2 starts free at 0, then normal reductions/increases (including
 * FrostStrike for a Flip) still apply.
 */
export function cardCostAfterFreeBase(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  return cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true }).total;
}

/** Charge selected uncharged Energy cards, or every uncharged Energy card when no selection is supplied. */
export function rechargeEnergyCards(
  state: MatchState,
  playerId: string,
  selectedIds?: readonly string[],
) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const tapped = activeTappedEnergyIds(player, state.turn);
  const requested = selectedIds ? new Set(selectedIds) : undefined;
  const recharged = tapped.filter((id) => !requested || requested.has(id));
  if (!recharged.length) return 0;
  const rechargedSet = new Set(recharged);
  player.energyTapTurn = state.turn;
  player.tappedEnergyIds = tapped.filter((id) => !rechargedSet.has(id));
  return recharged.length;
}

export function beginCardPayment(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: CardCostContext = {},
): RulesPayment {
  const breakdown = cardCostBreakdown(state, playerId, card, choices, context);
  const payment: RulesPayment = {
    id: `${state.id}:${state.version}:${card.id}:payment`,
    playerId,
    cardId: card.id,
    calculatedCost: breakdown.total,
    selectedEnergyIds: [],
    additionalCosts: breakdown.additionalCosts.map((cost) => ({
      kind: "discard",
      amount: cost.amount,
      cardIds: selectedIds(choices, cost.choiceId).slice(0, cost.amount),
    })),
    status: "declared",
  };
  ensureRulesState(state).pendingPayment = payment;
  return payment;
}

export function prepareDeclaredEnergyPayment(state: MatchState, playerId: string, amount: number) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") throw new Error("Energy can only be uncharged for a declared card payment.");
  if (payment.calculatedCost !== amount) throw new Error("The declared payment amount changed before payment completed.");
  if (player.energyTapTurn !== state.turn) {
    player.energyTapTurn = state.turn;
    player.tappedEnergyIds = [];
    player.energy = 0;
  } else player.tappedEnergyIds = activeTappedEnergyIds(player, state.turn);
  const current = availableEnergy(player, state.turn);
  const required = Math.max(0, amount - current);
  const tapped = new Set(player.tappedEnergyIds);
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id));
  if (untapped.length < required) throw new Error(`Not enough Energy. ${amount} required, ${current + untapped.length} available.`);
  const selected = untapped.slice(0, required);
  player.tappedEnergyIds.push(...selected.map((card) => card.id));
  player.energy = current + selected.length;
  payment.selectedEnergyIds = selected.map((card) => card.id);
  return state;
}

export function commitCardPayment(state: MatchState, playerId: string) {
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") throw new Error("There is no declared card payment to commit.");
  const player = playerById(state, playerId);
  if (player.energy < payment.calculatedCost) throw new Error("The declared Energy cost has not been generated.");

  const planned = payment.additionalCosts.map((additional) => {
    if (additional.cardIds.length !== additional.amount || new Set(additional.cardIds).size !== additional.amount) {
      throw new Error(`This payment requires exactly ${additional.amount} discard${additional.amount === 1 ? "" : "s"}.`);
    }
    const ids = new Set(additional.cardIds);
    const cards = player.hand.filter((card) => ids.has(card.id));
    if (cards.length !== additional.amount) throw new Error("An additional-cost card is no longer in hand.");
    return { ids, cards };
  });

  for (const additional of planned) {
    player.hand = player.hand.filter((card) => !additional.ids.has(card.id));
    player.discard.push(...additional.cards);
  }
  player.energy -= payment.calculatedCost;
  payment.status = "paid";
  rules.pendingPayment = undefined;
  return state;
}

export function cancelCardPayment(state: MatchState, playerId: string) {
  const rules = ensureRulesState(state);
  if (rules.pendingPayment?.playerId === playerId) {
    rules.pendingPayment.status = "cancelled";
    rules.pendingPayment = undefined;
  }
  return state;
}
'''
write("lib/rules/costs.ts", costs)


# ---------------------------------------------------------------------------
# Compiler: generic alternative-cost Sacrifice, free-play source ownership,
# conditional free cards, persistent both-player free plays, and source zones.
# ---------------------------------------------------------------------------
primitive = read("lib/rules/catalogue-primitives.ts")
primitive = replace_once(
    primitive,
    '  const energyCount = text.match(/if you have (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) or more Energy cards in play/i);\n'
    '  if (energyCount) return { kind: "energy-count", comparison: "at-least", amount: numberValue(energyCount[1], 1) };\n',
    '  const energyCount = text.match(/if you have (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) or more Energy cards in play/i);\n'
    '  if (energyCount) return { kind: "energy-count", comparison: "at-least", amount: numberValue(energyCount[1], 1) };\n'
    '  const discardCount = text.match(/if (?:there are|you have) (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) or more cards? in your discard pile/i);\n'
    '  if (discardCount) return { kind: "discard-count", comparison: "at-least", amount: numberValue(discardCount[1], 1) };\n'
    '  const playedCost = text.match(/if you(?: have|\\'ve)? played a card that costs? (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) \\[Energy\\] or more this turn/i);\n'
    '  if (playedCost) return { kind: "played-card-cost", comparison: "at-least", amount: numberValue(playedCost[1], 1) };\n',
    "conditional free conditions",
)
old_play_parse = '''  if (/play (?:it|this card) for free/i.test(text)) actions.push({ kind: "play", source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck", free: true });
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play a card from your hand for free|play that Bakugan(?:'s|’s) Evo card for free/i.test(text)) actions.push({ kind: "play", source: "hand", free: true });'''
new_play_parse = '''  if (/play (?:it|this card) for free/i.test(text)) actions.push({
    kind: "play",
    source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck",
    free: true,
  });
  const freeHandPlay = text.match(/play\s+(?:an?|the)?\s*(Action|Hero|Evo|card)(?:\s+card)?(?:\s+that costs?\s+(\d+)\s+\[Energy\]\s+or less)?(?:\s+from\s+(?:your\s+)?hand|\s+from\s+it)?\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay) actions.push({
    kind: "play",
    source: "hand",
    free: true,
    cardType: /that Bakugan(?:'s|’s) Evo/i.test(text) ? "Evo" : (freeHandPlay[1] && freeHandPlay[1].toLowerCase() !== "card" ? freeHandPlay[1] as CardType : undefined),
    maximumCost: freeHandPlay[2] ? Number(freeHandPlay[2]) : undefined,
    sourceOwner: /from it|opponent(?:'s|’s) hand/i.test(text) ? "opponent" : "controller",
    destinationOwner: /opponent(?:'s|’s) discard pile/i.test(text) ? "opponent" : undefined,
  });
  if (/for the rest of the turn,\s*both players may play Evo cards from their hand for free/i.test(text)) actions.push({
    kind: "cost", amount: 0, operation: "free", duration: "turn", cardType: "Evo", playerScope: "all-players",
  });'''
primitive = replace_once(primitive, old_play_parse, new_play_parse, "free play parser")
write("lib/rules/catalogue-primitives.ts", primitive)

structure = read("lib/rules/catalogue-structure.ts")
old_free_choice = '''  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play that Bakugan(?:'s|’s) Evo card for free/i.test(text)) {
    const selected = choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private");
    if (/that Bakugan(?:'s|’s) Evo/i.test(text)) selected.cardType = "Evo";
    result.push(selected);
  }'''
new_free_choice = '''  const freeHandPlay = text.match(/play\s+(?:an?|the)?\s*(Action|Hero|Evo|card)(?:\s+card)?(?:\s+that costs?\s+(\d+)\s+\[Energy\]\s+or less)?(?:\s+from\s+(?:your\s+)?hand|\s+from\s+it)?\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay) {
    const selected = choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private");
    if (/that Bakugan(?:'s|’s) Evo/i.test(text)) selected.cardType = "Evo";
    else if (freeHandPlay[1] && freeHandPlay[1].toLowerCase() !== "card") selected.cardType = freeHandPlay[1] as GameCard["type"];
    if (freeHandPlay[2]) selected.maximumCost = Number(freeHandPlay[2]);
    selected.owner = /from it|opponent(?:'s|’s) hand|opponent(?:'s|’s) discard pile/i.test(text) ? "opponent" : "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }'''
structure = replace_once(structure, old_free_choice, new_free_choice, "free hand choice")
# Generic discard-to-free alternative, then exclude that wording from unconditional cost-free.
needle = 'function costModifiersFor(card: GameCard): CostEffect[] {\n  const result: CostEffect[] = [];\n  const text = card.effect;\n'
replacement = '''function costModifiersFor(card: GameCard): CostEffect[] {
  const result: CostEffect[] = [];
  const text = card.effect;
  const discardForFree = text.match(/(?:Sacrifice\s*[-:]\s*)?You may discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? to play this for free/i);
  if (discardForFree) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[discardForFree[1].toLowerCase()] ?? Math.max(1, Number(discardForFree[1]) || 1);
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(card)}:discard-for-free`,
      label: `Sacrifice — discard ${amount} card${amount === 1 ? "" : "s"}`,
      setsBaseFree: true,
      components: [{ kind: "cost-discard", amount, choiceId: "discardCardIds" }],
    });
  }
'''
structure = replace_once(structure, needle, replacement, "alternative cost insert")
structure = replace_once(
    structure,
    '  // Pact of Darkness resolves its optional Sacrifice payment through the\n'
    '  // paused Damage sequence. It must retain its printed cost until that\n'
    '  // sequence has actually discarded a card.\n'
    '  if (ruleCardId(card) !== "bb-152" && /play this for free|this is free/i.test(text)) {\n'
    '    result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });\n'
    '  }\n'
    '  if (ruleCardId(card) === "aa-112") {\n'
    '    result.push({ kind: "cost-alternative", label: "Discard two cards instead of paying the printed Energy cost", components: [{ kind: "cost-discard", amount: 2, choiceId: "discardCardIds" }] });\n'
    '  }',
    '  if (!discardForFree && /play this for free|this is free/i.test(text)) {\n'
    '    result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });\n'
    '  }\n'
    '  if (ruleCardId(card) === "aa-112") {\n'
    '    result.push({ kind: "cost-alternative", id: "aa-112:discard-two", label: "Discard two cards instead of paying the printed Energy cost", setsBaseFree: true, components: [{ kind: "cost-discard", amount: 2, choiceId: "discardCardIds" }] });\n'
    '  }',
    "generic free cost and aa112",
)
# Remove Pact-only choice surgery; transaction staging handles alternative-cost fields generically.
structure = sub_once(
    structure,
    r'\n  // Pact of Darkness owns a dedicated two-stage Damage-step payment\n  // prompt, so it must not enter the generic card-choice editor\.\n  if \(ruleCardId\(card\) === "bb-152"\) \{.*?\n  \}\n',
    '\n',
    "remove Pact play choice special case",
)
# Permit cards explicitly playable from discard as though in hand.
structure = replace_once(
    structure,
    '    sourceZones: card.type === "Flip" ? ["damage-reveal"] : ["hand"],',
    '    sourceZones: card.type === "Flip"\n'
    '      ? ["damage-reveal"]\n'
    '      : /play this from your discard pile as though it were in your hand/i.test(card.effect)\n'
    '        ? ["hand", "discard"]\n'
    '        : ["hand"],',
    "source zones",
)
write("lib/rules/catalogue-structure.ts", structure)


# ---------------------------------------------------------------------------
# Condition evaluator for conditional self-free cards.
# ---------------------------------------------------------------------------
mods = read("lib/rules/modifiers.ts")
mods = replace_once(
    mods,
    '    case "energy-count": return player.maxEnergy >= condition.amount;\n',
    '    case "energy-count": return player.maxEnergy >= condition.amount;\n'
    '    case "discard-count": return player.discard.length >= condition.amount;\n'
    '    case "played-card-cost": return Math.max(0, ...(player.playedCardCostsThisTurn ?? [])) >= condition.amount;\n',
    "condition evaluator additions",
)
write("lib/rules/modifiers.ts", mods)


# ---------------------------------------------------------------------------
# Game kernel: universal card play transaction. All paths use the same source
# lookup, declaration, payment, commit, typed object, trigger, copy and resume
# behavior.
# ---------------------------------------------------------------------------
game = read("lib/game.ts")
game = replace_once(
    game,
    'import { activeTappedEnergyIds, cardCostBreakdown, rechargeEnergyCards } from "./rules/costs";',
    'import { activeTappedEnergyIds, beginCardPayment, cardPaymentModes, commitCardPayment, prepareDeclaredEnergyPayment, rechargeEnergyCards } from "./rules/costs";',
    "game cost imports",
)
game = replace_once(
    game,
    'import { evaluateAmountExpression, playerIdsForScope } from "./rules/primitives";',
    'import { evaluateAmountExpression, playerIdsForScope, zoneOwnerIdsFor } from "./rules/primitives";',
    "game primitive imports",
)
game = replace_once(
    game,
    'import type { ContinuousModifier, RulesCardId } from "./rules/model";',
    'import type { ContinuousModifier, PendingCardPlay, RulesCardId } from "./rules/model";',
    "game model import",
)
game = replace_once(
    game,
    '  cardsPlayedThisTurn: number;\n',
    '  cardsPlayedThisTurn: number;\n  /** Printed Energy costs of cards this player has played during the current turn. */\n  playedCardCostsThisTurn?: number[];\n',
    "player played costs",
)
game = replace_once(
    game,
    '  mode?: string;\n',
    '  mode?: string;\n  /** Selected normal/alternative payment route for the current card play. */\n  paymentMode?: string;\n',
    "card choices payment mode",
)
game = replace_once(
    game,
    '  controllerId: string;\n  card: GameCard;\n',
    '  controllerId: string;\n  /** Physical owner of this card, which can differ from its resolving controller. */\n  cardOwnerId?: string;\n  card: GameCard;\n',
    "pending effect owner",
)
game = replace_once(
    game,
    '    mode: "mode",\n',
    '    mode: "mode",\n    paymentMode: "mode",\n',
    "card choice mapping payment mode",
)
# Track printed costs and rebuild them in normalized snapshots.
game = replace_once(
    game,
    '    player.factionsPlayedThisTurn = [...new Set([\n      ...(Array.isArray(player.factionsPlayedThisTurn) ? player.factionsPlayedThisTurn : []),\n      ...playedCards.flatMap((card) => card.factions?.length ? card.factions : [card.faction]),\n    ])];\n',
    '    player.factionsPlayedThisTurn = [...new Set([\n      ...(Array.isArray(player.factionsPlayedThisTurn) ? player.factionsPlayedThisTurn : []),\n      ...playedCards.flatMap((card) => card.factions?.length ? card.factions : [card.faction]),\n    ])];\n'
    '    player.playedCardCostsThisTurn = playedCards.map((card) => card.cost === "X" ? 0 : card.cost);\n',
    "normalize played costs",
)
game = replace_once(
    game,
    '  player.cardsPlayedThisTurn += 1;\n',
    '  player.cardsPlayedThisTurn += 1;\n  player.playedCardCostsThisTurn = [...(player.playedCardCostsThisTurn ?? []), card.cost === "X" ? 0 : card.cost];\n',
    "record played cost",
)
# Reset any existing turn counters alongside cardsPlayedThisTurn.
game = game.replace('player.cardsPlayedThisTurn = 0;', 'player.cardsPlayedThisTurn = 0;\n    player.playedCardCostsThisTurn = [];')

# New suspension class.
game = replace_once(
    game,
    'class CoinFlipResolutionSuspended extends Error {\n  constructor() {\n    super("Card resolution suspended for a coin flip presentation.");\n    this.name = "CoinFlipResolutionSuspended";\n  }\n}\n',
    'class CoinFlipResolutionSuspended extends Error {\n  constructor() {\n    super("Card resolution suspended for a coin flip presentation.");\n    this.name = "CoinFlipResolutionSuspended";\n  }\n}\n\n'
    'class CardPlayResolutionSuspended extends Error {\n'
    '  constructor() {\n'
    '    super("Card resolution suspended while a nested card play is declared and paid.");\n'
    '    this.name = "CardPlayResolutionSuspended";\n'
    '  }\n'
    '}\n',
    "card play suspension class",
)

# Replace legacy effectiveCost/payEnergy/Pact helper with universal pipeline helpers.
helper_block = r'''type MutableCardPlayResult = "staged" | "committed";

function choiceValuePresent(choices: CardChoices, id: keyof CardChoices) {
  const value = choices[id];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

function playSourceCard(state: MatchState, request: PendingCardPlay) {
  const owner = playerById(state, request.sourceOwnerId);
  if (!owner) throw new Error("The card's source-zone owner is no longer in the match.");
  if (request.sourceZone === "hand") {
    const card = owner.hand.find((candidate) => candidate.id === request.cardId);
    if (!card) throw new Error("The card is no longer in the requested hand.");
    return { owner, card };
  }
  if (request.sourceZone === "deck") {
    const card = owner.deckCards.find((candidate) => candidate.id === request.cardId);
    if (!card) throw new Error("The card is no longer in the requested deck position.");
    return { owner, card };
  }
  if (request.sourceZone === "damage-reveal") {
    const card = owner.discard.find((candidate) => candidate.id === request.cardId);
    if (!card || state.revealedFlip?.id !== card.id) throw new Error("The revealed Flip is no longer available to play.");
    return { owner, card };
  }
  const card = owner.discard.find((candidate) => candidate.id === request.cardId);
  if (!card) throw new Error("The card is no longer in the requested discard pile.");
  return { owner, card };
}

function removePlaySourceCard(state: MatchState, request: PendingCardPlay) {
  const { owner, card } = playSourceCard(state, request);
  if (request.sourceZone === "hand") owner.hand = owner.hand.filter((candidate) => candidate.id !== card.id);
  else if (request.sourceZone === "deck") {
    owner.deckCards = owner.deckCards.filter((candidate) => candidate.id !== card.id);
    syncDeck(owner);
    delete owner.revealedDeckCardId;
  } else {
    owner.discard = owner.discard.filter((candidate) => candidate.id !== card.id);
    if (request.sourceZone === "damage-reveal") state.revealedFlip = undefined;
  }
  return card;
}

function validateCardPlayRequest(state: MatchState, request: PendingCardPlay, choices: CardChoices) {
  if (alternateWinEffectPending(state)) throw new Error("Dragonoid Maximus's alternate win effect cannot be responded to with cards.");
  const { card } = playSourceCard(state, request);
  if (card.type === "Character") throw new Error("Character cards cannot be played from a card zone.");
  if (!cardRerollTimingLegal(state, request.controllerId, card)) {
    throw new Error("This mandatory Reroll card can be played only after the first roll and before the Victor Step.");
  }
  if (request.origin === "priority") {
    if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== request.controllerId) {
      throw new Error("You do not have priority in a card-play window.");
    }
    if (request.sourceZone !== "hand" || request.sourceOwnerId !== request.controllerId) {
      throw new Error("An ordinary priority play must begin in your hand.");
    }
    if (card.type === "Flip") throw new Error("Flip cards are played only when revealed by damage.");
  }
  if (request.origin === "damage") {
    if (state.phase !== "damage" || state.pendingLoser !== request.controllerId || request.sourceZone !== "damage-reveal") {
      throw new Error("A damage-revealed Flip can only be played during its Damage Step decision.");
    }
    if (card.type !== "Flip" || !revealedFlipCanBePlayed(state, request.controllerId, card)) {
      throw new Error("This revealed Flip cannot legally be played against the current attack.");
    }
  }
  if (card.cost === "X" && !request.forcedFreeBase && !Number.isFinite(choices.xValue)) {
    const definition = ruleDefinitionForCard(card);
    if (!definition.play.choices.some((choice) => choice.id === "xValue" && choice.timing === "pay")) {
      throw new Error("Choose X before paying for this card.");
    }
  }
}

function selectedPaymentMode(state: MatchState, request: PendingCardPlay, card: GameCard, choices: CardChoices) {
  const modes = cardPaymentModes(state, request.controllerId, card, choices, { forcedFreeBase: request.forcedFreeBase });
  const inferredAlternative = modes.find((mode) => mode.id !== "normal" && mode.id !== "forced-free"
    && mode.additionalCosts.some((cost) => choiceValuePresent(choices, cost.choiceId)));
  const id = request.forcedFreeBase ? "forced-free" : choices.paymentMode ?? inferredAlternative?.id ?? "normal";
  return { modes, mode: modes.find((candidate) => candidate.id === id) };
}

function paymentModeField(state: MatchState, request: PendingCardPlay, card: GameCard, choices: CardChoices) {
  if (request.forcedFreeBase) return undefined;
  const { modes } = selectedPaymentMode(state, request, card, choices);
  if (modes.length <= 1) return undefined;
  return {
    id: "paymentMode" as const,
    kind: "mode" as const,
    label: "Choose how to pay for this card",
    chooserId: request.controllerId,
    visibility: "public" as const,
    timing: "pay" as const,
    minimum: 1,
    maximum: 1,
    required: true,
    options: modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.legal
        ? `${mode.energyCost} Energy${mode.additionalCosts.length ? " plus the listed additional cost" : ""}.`
        : mode.reason ?? "This payment method is unavailable.",
      disabled: !mode.legal,
    })),
  };
}

function alternativeCostChoiceIds(card: GameCard) {
  return new Set(ruleDefinitionForCard(card).play.costModifiers.flatMap((modifier) => (
    modifier.kind === "cost-alternative"
      ? modifier.components.filter((component): component is Extract<typeof component, { kind: "cost-discard" }> => component.kind === "cost-discard").map((component) => component.choiceId)
      : []
  )));
}

function stageAdditionalCardPlayCosts(state: MatchState, request: PendingCardPlay): MutableCardPlayResult {
  const { card } = playSourceCard(state, request);
  const choices = request.choices;
  const { mode } = selectedPaymentMode(state, request, card, choices);
  if (!mode) throw new Error("The selected card payment method is no longer available.");
  if (!mode.legal) throw new Error(mode.reason ?? "The selected card payment method is unavailable.");
  const missing = mode.additionalCosts.find((cost) => {
    const value = choices[cost.choiceId];
    return !Array.isArray(value) || value.length !== cost.amount;
  });
  if (missing?.kind === "discard") {
    const payer = playerById(state, request.controllerId);
    const options = payer.hand
      .filter((candidate) => candidate.id !== card.id)
      .map((candidate) => ({ id: candidate.id, label: candidate.displayName || candidate.name, ownerId: payer.id }));
    if (options.length < missing.amount) throw new Error(`This payment requires ${missing.amount} discardable card${missing.amount === 1 ? "" : "s"}.`);
    state.pendingChoice = {
      id: uid(),
      kind: "card-play",
      controllerId: request.controllerId,
      cardId: request.cardId,
      schema: {
        id: `${state.id}:${state.version}:${request.cardId}:additional-cost`,
        sourceId: request.cardId,
        sourceName: card.displayName || card.name,
        controllerId: request.controllerId,
        timing: "pay",
        simultaneous: false,
        fields: [{
          id: missing.choiceId,
          kind: "hand-cards",
          label: `Choose ${missing.amount} card${missing.amount === 1 ? "" : "s"} to discard as an additional cost`,
          chooserId: request.controllerId,
          visibility: "private",
          timing: "pay",
          minimum: missing.amount,
          maximum: missing.amount,
          required: true,
          options,
        }],
      },
      answers: {},
      createdVersion: state.version,
      beforeState: request.beforeState,
      playRequest: request,
      playStage: "additional-cost",
      cancellable: request.origin !== "effect" || Boolean(request.optional),
      irreversibleInformation: request.irreversibleInformation,
    };
    state.priority = request.controllerId;
    state.stepLabel = `${card.displayName || card.name} • Additional cost`;
    state.deadline = Date.now() + 35_000;
    return "staged";
  }
  commitCardPlayMutable(state, request);
  return "committed";
}

function emitPaymentDiscardEvents(state: MatchState, controllerId: string, cards: GameCard[]) {
  if (!cards.length) return;
  const player = playerById(state, controllerId);
  emitGameEvent(state, {
    id: `${state.turn}:discard:${cards.map((card) => card.id).join(",")}:${state.version}:payment`,
    type: "discard",
    playerId: controllerId,
    targetBakuganId: activeBakugan(state, controllerId)?.id,
    sourceCards: cards,
  });
  if (player.hand.length === 0) emitGameEvent(state, {
    id: `${state.turn}:hand-empty:${controllerId}:${state.version}:payment`,
    type: "hand-empty",
    playerId: controllerId,
  });
}

function commitCardPlayMutable(state: MatchState, request: PendingCardPlay) {
  const located = playSourceCard(state, request);
  const card = located.card;
  const choices = request.choices;
  validateCardPlayRequest(state, request, choices);
  const { mode } = selectedPaymentMode(state, request, card, choices);
  if (!mode || !mode.legal) throw new Error(mode?.reason ?? "This card has no legal payment method.");

  const discardedBeforePayment = mode.additionalCosts.flatMap((cost) => {
    const value = choices[cost.choiceId];
    const ids = new Set(Array.isArray(value) ? value.map(String) : []);
    return playerById(state, request.controllerId).hand.filter((candidate) => ids.has(candidate.id));
  });
  const context = {
    forcedFreeBase: request.forcedFreeBase,
    selectedAlternativeId: mode.id === "normal" || mode.id === "forced-free" ? undefined : mode.id,
  };
  const payment = beginCardPayment(state, request.controllerId, card, choices, context);
  prepareDeclaredEnergyPayment(state, request.controllerId, payment.calculatedCost);
  commitCardPayment(state, request.controllerId);
  emitPaymentDiscardEvents(state, request.controllerId, discardedBeforePayment);

  const played = removePlaySourceCard(state, request);
  const controller = playerById(state, request.controllerId);
  recordCardPlayedForTurn(controller, played, state.turn);
  state.nextCardCostReduction[request.controllerId] = 0;
  ensureRulesState(state).costModifiers = ensureRulesState(state).costModifiers.filter((modifier) => !(
    modifier.duration === "next-card"
    && playerIdsForScope(state, modifier.playerScope, { controllerId: modifier.controllerId }).includes(request.controllerId)
  ));

  const definition = ruleDefinitionForCard(played);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered") ?? definition.abilities[0];
  if (!ability) throw new Error(`${played.name} does not have a legal card-play ability.`);
  const batchObject = createRuleObject({
    controllerId: request.controllerId,
    cardOwnerId: request.cardOwnerId,
    card: played,
    ability,
    choices,
    kind: "card",
  });
  state.batch.push(batchObject);
  state.passes = [];
  if (played.type === "Action") {
    const toshi = controller.heroes.find((hero) => hero.name === "Toshi");
    if (toshi && controller.cardsPlayedThisTurn === 1) state.batch.push(copyRuleObject(batchObject, request.controllerId));
    if ((state.copyNextAction[request.controllerId] ?? 0) > 0) {
      state.copyNextAction[request.controllerId] -= 1;
      state.batch.push(copyRuleObject(batchObject, request.controllerId));
    }
  }

  emitGameEvent(state, {
    id: `${state.turn}:card-play:${played.id}`,
    type: "card-play",
    playerId: request.controllerId,
    cardType: played.type,
    sourceCards: [played],
    targetBakuganId: played.type === "Evo"
      ? (choices.sourceBakuganId ?? choices.targetBakuganId)
      : activeBakugan(state, request.controllerId)?.id,
    choices,
  });

  if (request.origin === "damage") {
    const rules = ensureRulesState(state) as ReturnType<typeof ensureRulesState> & {
      damageResume?: { playerId: string; previousPhase: "damage"; revealedFlipId: string };
    };
    rules.damageResume = { playerId: request.controllerId, previousPhase: "damage", revealedFlipId: played.id };
    state.phase = "postDamage";
    state.stepLabel = `Damage Step • Respond to ${played.displayName || played.name}`;
    state.priority = request.controllerId;
    state.deadline = Date.now() + 25_000;
  }

  const freeWording = mode.freeBase ? " after its base Energy cost became free" : "";
  entry(state, "game", `${controller.name} added ${played.name} to the batch for ${payment.calculatedCost} Energy${freeWording}.`, played, "played", request.controllerId);

  if (request.origin === "priority") {
    state.undoWindow = {
      actorId: request.controllerId,
      action: "play-card",
      beforeVersion: state.version,
      afterVersion: state.version + 1,
      batchObjectId: batchObject.id,
      informationEpoch: state.informationEpoch,
      priorityEpoch: state.priorityEpoch,
      irreversibleInformation: Boolean(request.irreversibleInformation),
      snapshot: request.beforeState,
    };
  } else state.undoWindow = undefined;
  return batchObject;
}

function stageCardPlayMutable(state: MatchState, request: PendingCardPlay): MutableCardPlayResult {
  const { card } = playSourceCard(state, request);
  validateCardPlayRequest(state, request, request.choices);
  const definition = ruleDefinitionForCard(card);
  const alternativeIds = alternativeCostChoiceIds(card);
  const alreadyChosen = (id: keyof CardChoices) => choiceValuePresent(request.choices, id);
  const announce = buildChoiceSchemaFromSpecs(
    state,
    request.controllerId,
    card,
    definition.play.choices.filter((choice) => !alreadyChosen(choice.id)),
    "announce",
    request.choices,
  );
  const pay = buildChoiceSchemaFromSpecs(
    state,
    request.controllerId,
    card,
    definition.play.choices.filter((choice) => !alternativeIds.has(choice.id) && !alreadyChosen(choice.id)),
    "pay",
    request.choices,
  );
  const mode = paymentModeField(state, request, card, request.choices);
  const fields = [...announce.fields, ...pay.fields, ...(mode && !alreadyChosen("paymentMode") ? [mode] : [])];
  if (fields.length) {
    const schema = { ...announce, timing: "announce" as const, fields, simultaneous: announce.simultaneous || pay.simultaneous };
    const enabledCompletion = schemaHasLegalCompletion(schema);
    // A damage-revealed Flip may expose unavailable payment methods so the
    // player can see why it cannot be paid and choose Skip instead.
    if (!enabledCompletion && request.origin !== "damage") {
      throw new Error(`${card.displayName || card.name} has no legal targets, choices, or payment method.`);
    }
    state.pendingChoice = {
      id: uid(),
      kind: "card-play",
      controllerId: request.controllerId,
      cardId: request.cardId,
      schema,
      answers: {},
      createdVersion: state.version,
      beforeState: request.beforeState,
      playRequest: request,
      playStage: "declare",
      cancellable: request.origin !== "effect" || Boolean(request.optional),
      irreversibleInformation: request.irreversibleInformation,
    };
    state.priority = fields.find((field) => field.options.some((option) => !option.disabled))?.chooserId
      ?? fields[0]?.chooserId
      ?? request.controllerId;
    state.stepLabel = `${card.displayName || card.name} • Declare card play`;
    state.deadline = Date.now() + 35_000;
    return "staged";
  }
  return stageAdditionalCardPlayCosts(state, request);
}

function finishNestedCardPlayContinuation(state: MatchState, request: PendingCardPlay) {
  if (request.origin !== "effect" || !request.parentEffectId) return;
  const parent = state.batch.find((candidate) => candidate.id === request.parentEffectId);
  if (!parent) return;
  parent.instructionIndex = request.parentNextInstructionIndex ?? parent.instructionIndex ?? 0;
  if (isRuleObject(parent)) parent.cursor.instructionIndex = parent.instructionIndex;
  state.priority = request.resumePriority ?? state.startingPlayer;
  state.deadline = request.resumeDeadline ?? deadlineFor(state.phase);
  state.stepLabel = request.resumeStepLabel ?? state.stepLabel;
  const completed = resolvePendingEffect(state, parent);
  if (completed) {
    state.batch = state.batch.filter((candidate) => candidate.id !== parent.id);
    finalizeRerollContinuation(state, parent.id);
    if (!state.pendingChoice && !state.pendingReroll && !hasQueuedEffectDraw(state)) {
      state.priority = state.startingPlayer;
      state.deadline = deadlineFor(state.phase);
    }
  }
}

function cancelNestedCardPlayContinuation(state: MatchState, request: PendingCardPlay) {
  if (request.origin === "effect") {
    finishNestedCardPlayContinuation(state, request);
    return;
  }
  if (request.origin === "damage") {
    state.phase = "damage";
    state.priority = request.controllerId;
    state.stepLabel = `Damage Step • Flip decision • ${state.pendingDamage} remaining`;
    state.deadline = Date.now() + 35_000;
  }
}

export const prepareRevealedFlipPlay = (input: MatchState, playerId: string, cardId: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input);
  if (state.pendingChoice) throw new Error("Complete the current choice before playing the revealed Flip.");
  const flip = state.revealedFlip;
  if (!flip || flip.id !== cardId) throw new Error("Only the currently revealed Flip card may be played.");
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "damage-reveal",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "damage",
    choices: { ...choices },
    beforeState: undefined,
  };
  stageCardPlayMutable(state, request);
  return withVersion(state);
};

'''
game = sub_once(
    game,
    r'const effectiveCost = .*?\n\nexport const prepareCardPlay = ',
    helper_block + 'export const prepareCardPlay = ',
    "replace legacy payment/Pact helpers",
)

# Replace prepareCardPlay with transaction staging.
game = sub_once(
    game,
    r'export const prepareCardPlay = \(input: MatchState, playerId: string, cardId: string\) => \{.*?\n\};\n\nexport const cancelCardChoice',
    '''export const prepareCardPlay = (input: MatchState, playerId: string, cardId: string) => {
  const state = cloneMatch(input);
  if (state.pendingChoice) throw new Error("Complete the current choice before starting another action.");
  const player = playerById(state, playerId);
  const card = player.hand.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("That card is not in your hand.");
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "hand",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "priority",
    choices: {},
    beforeState: JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined }),
  };
  stageCardPlayMutable(state, request);
  return withVersion(state);
};

export const cancelCardChoice''',
    "replace prepare card play",
)

# Replace cancel behavior.
game = sub_once(
    game,
    r'export const cancelCardChoice = \(input: MatchState, playerId: string\) => \{.*?\n\};\n\nexport const submitCardChoice',
    '''export const cancelCardChoice = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  const pending = state.pendingChoice;
  if (!pending || ["resolution", "forced-discard"].includes(pending.kind) || pending.controllerId !== playerId || Object.keys(pending.answers).length) {
    throw new Error("This card choice can no longer be cancelled.");
  }
  if (pending.cancellable === false) throw new Error("This card play is mandatory and cannot be cancelled.");
  const request = pending.playRequest;
  const card = request ? playSourceCard(state, request).card : playerById(state, playerId).hand.find((candidate) => candidate.id === pending.cardId);
  state.pendingChoice = undefined;
  if (request) cancelNestedCardPlayContinuation(state, request);
  if (!request || request.origin === "priority") {
    state.priority = playerId;
    state.stepLabel = `${state.phase} • Priority`;
  }
  entry(state, "game", `${playerById(state, playerId).name} cancelled ${card?.name ?? "the pending card"} before playing it.`);
  return withVersion(state);
};

export const submitCardChoice''',
    "replace cancel card choice",
)

# Insert generic card-play pending handler after merged choices, and delete Pact-only handler.
game = replace_once(
    game,
    '  const merged = mergeChoiceAnswers(pending.schema, pending.answers);\n',
    '  const merged = mergeChoiceAnswers(pending.schema, pending.answers);\n'
    '  if (pending.kind === "card-play" && pending.playRequest) {\n'
    '    const request: PendingCardPlay = structuredClone(pending.playRequest);\n'
    '    request.choices = { ...request.choices, ...merged };\n'
    '    request.irreversibleInformation = Boolean(request.irreversibleInformation || pending.irreversibleInformation);\n'
    '    state.pendingChoice = undefined;\n'
    '    const result = stageAdditionalCardPlayCosts(state, request);\n'
    '    if (result === "committed") finishNestedCardPlayContinuation(state, request);\n'
    '    return withVersion(state);\n'
    '  }\n',
    "submit generic card play handler",
)
game = sub_once(
    game,
    r'  if \(pending\.kind === "payment" && state\.revealedFlip\?\.catalogId === "bb-152".*?\n  if \(pending\.kind === "forced-discard"\)',
    '  if (pending.kind === "forced-discard")',
    "remove Pact submit handler",
)

# Replace legacy playCard implementation with the same commit transaction.
game = sub_once(
    game,
    r'export const playCard = \(input: MatchState, playerId: string, cardId: string, choices: CardChoices = \{\}\) => \{.*?\n\};\n\nconst chooseBakugan',
    '''export const playCard = (input: MatchState, playerId: string, cardId: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input);
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "hand",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "priority",
    choices: { ...choices },
    beforeState: JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined }),
  };
  commitCardPlayMutable(state, request);
  return withVersion(state);
};

const chooseBakugan''',
    "replace playCard",
)

# Cost actions can now persist turn-long free-play permissions such as Sneak Attack.
game = replace_once(
    game,
    '''    case "cost":
      if (action.duration === "next-card") {
        if (action.operation === "reduce") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) + action.amount;
        else if (action.operation === "increase") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) - action.amount;
      }
      return;''',
    '''    case "cost":
      if (action.duration === "next-card") {
        if (action.operation === "reduce") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) + action.amount;
        else if (action.operation === "increase") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) - action.amount;
      } else if (action.operation === "free" && action.duration === "turn") {
        const rules = ensureRulesState(state);
        rules.costModifiers.push({
          id: `${pending.id}:${instructionIndex}:${actionIndex}:cost-free`,
          sourceId: pending.sourceId ?? pending.card.id,
          controllerId,
          kind: "free",
          amount: 0,
          duration: "turn",
          cardType: action.cardType,
          playerScope: action.playerScope ?? "controller",
          createdTurn: state.turn,
        });
      }
      return;''',
    "persistent free cost execution",
)

# Replace direct free-play mutation with a nested normal play request.
game = sub_once(
    game,
    r'    case "play": \{.*?\n    \}\n    case "attack": \{',
    r'''    case "play": {
      if (alternateWinEffectPending(state)) {
        entry(state, "game", `${card.name} could not play another card while Dragonoid Maximus's alternate win effect was on the batch.`);
        return;
      }
      if (choices.confirmed === false) return;
      let sourceZone: PendingCardPlay["sourceZone"];
      let sourceOwnerId = controllerId;
      let selected: GameCard | undefined;
      if (action.source === "hand") {
        const ownerId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", { controllerId, choices })[0] ?? controllerId;
        const owner = playerById(state, ownerId);
        const selectedId = choices.handCardIds?.[0];
        selected = owner.hand.find((candidate) => candidate.id === selectedId);
        sourceZone = "hand";
        sourceOwnerId = ownerId;
      } else if (action.source === "self") {
        sourceZone = "discard";
        sourceOwnerId = pending.cardOwnerId ?? controllerId;
        selected = playerById(state, sourceOwnerId).discard.find((candidate) => candidate.id === card.id);
      } else {
        sourceZone = "deck";
        const revealedId = player.revealedDeckCardId ?? choices.deckCardId;
        selected = player.deckCards.find((candidate) => candidate.id === revealedId);
      }
      if (!selected || (action.cardType && selected.type !== action.cardType)) return;
      const printedCost = selected.cost === "X" ? Number.POSITIVE_INFINITY : selected.cost;
      if (action.maximumCost != null && printedCost > action.maximumCost) return;
      if (action.source === "revealed-deck" && selected.type === "Flip") {
        delete player.revealedDeckCardId;
        return;
      }
      const childChoices: CardChoices = {};
      if (selected.type === "Evo") {
        const definition = ruleDefinitionForCard(selected);
        const printedTarget = choices.sourceBakuganId ?? choices.targetBakuganId;
        const candidate = player.bakugan.find((bakugan) => bakugan.id === printedTarget && canonicalEvoTargetAllowed(definition, bakugan))
          ?? (() => {
            const active = activeBakugan(state, controllerId);
            return active && canonicalEvoTargetAllowed(definition, active)
              ? active
              : player.bakugan.find((bakugan) => canonicalEvoTargetAllowed(definition, bakugan));
          })();
        if (candidate) childChoices.sourceBakuganId = candidate.id;
      }
      const destinationOwnerId = zoneOwnerIdsFor(state, action.destinationOwner ?? action.sourceOwner ?? "controller", { controllerId, choices })[0]
        ?? sourceOwnerId;
      const request: PendingCardPlay = {
        controllerId,
        cardId: selected.id,
        sourceZone,
        sourceOwnerId,
        cardOwnerId: action.destinationOwner ? destinationOwnerId : sourceOwnerId,
        forcedFreeBase: action.free,
        origin: "effect",
        parentEffectId: pending.id,
        parentNextInstructionIndex: instructionIndex + 1,
        resumePriority: state.priority,
        resumeDeadline: state.deadline,
        resumeStepLabel: state.stepLabel,
        resumePhase: state.phase,
        optional: /\bmay\b/i.test(text),
        choices: childChoices,
      };
      try {
        const staged = stageCardPlayMutable(state, request);
        if (staged === "staged") {
          pending.instructionIndex = instructionIndex + 1;
          if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;
          throw new CardPlayResolutionSuspended();
        }
      } catch (error) {
        if (error instanceof CardPlayResolutionSuspended) throw error;
        if (request.optional) {
          entry(state, "game", `${card.name}: the optional free card play was unavailable and did nothing.`);
          return;
        }
        throw error;
      }
      return;
    }
    case "attack": {''',
    "route effect free plays",
)

# Catch nested-play suspension in the resolver.
game = replace_once(
    game,
    '    if (error instanceof RerollResolutionSuspended || error instanceof DamageResolutionSuspended || error instanceof CoinFlipResolutionSuspended) return false;',
    '    if (error instanceof RerollResolutionSuspended || error instanceof DamageResolutionSuspended || error instanceof CoinFlipResolutionSuspended || error instanceof CardPlayResolutionSuspended) return false;',
    "resolver catches play suspension",
)

# Action/Flip cards return to their physical owner, not necessarily their controller.
game = replace_once(
    game,
    '  const player = playerById(state, pending.controllerId);\n  const choices = {',
    '  const player = playerById(state, pending.controllerId);\n  const cardOwner = playerById(state, pending.cardOwnerId ?? pending.controllerId);\n  const choices = {',
    "resolution card owner",
)
game = replace_once(
    game,
    '    player.discard.push(pending.card);\n  } else if (pending.kind === "card" && pending.card.type === "Flip"',
    '    cardOwner.discard.push(pending.card);\n  } else if (pending.kind === "card" && pending.card.type === "Flip"',
    "Action owner discard",
)
game = replace_once(
    game,
    '    player.discard.push(pending.card);\n  }\n  delete player.revealedDeckCardId;',
    '    cardOwner.discard.push(pending.card);\n  }\n  delete player.revealedDeckCardId;',
    "Flip owner discard",
)
# Negated played cards likewise return to physical owner.
game = replace_once(
    game,
    '          const owner = playerById(state, negated.controllerId);\n',
    '          const owner = playerById(state, negated.cardOwnerId ?? negated.controllerId);\n',
    "negated card owner",
)
# Expire turn-long cost permissions at reset.
game = replace_once(
    game,
    '  rules.replacements = rules.replacements.filter((replacement) => replacement.effect.kind !== "prevention");\n  rules.triggerUsage = {};\n',
    '  rules.replacements = rules.replacements.filter((replacement) => replacement.effect.kind !== "prevention");\n  rules.costModifiers = rules.costModifiers.filter((modifier) => modifier.duration !== "turn");\n  rules.triggerUsage = {};\n',
    "reset cost modifiers",
)
write("lib/game.ts", game)


# ---------------------------------------------------------------------------
# Manual damage only decides reveal/skip. Playing the Flip is delegated to the
# exact same transaction used everywhere else.
# ---------------------------------------------------------------------------
manual = read("lib/manualDamage.ts")
manual = replace_once(
    manual,
    '  recordCardPlayedForTurn,\n  revealedFlipCanBePlayed,\n',
    '  prepareRevealedFlipPlay,\n  revealedFlipCanBePlayed,\n',
    "manual game imports",
)
manual = re.sub(r'import \{ beginCardPayment, cardCostAfterFreeBase, commitCardPayment, maximumPayableEnergy, prepareDeclaredEnergyPayment \} from "\.\/rules\/costs";\n', '', manual)
manual = re.sub(r'import \{ ruleDefinitionForCard \} from "\.\/rules\/catalogue";\n', '', manual)
manual = re.sub(r'import \{ createRuleObject \} from "\.\/rules\/objects";\n', '', manual)
manual = manual.replace('const PACT_OF_DARKNESS_ID = "bb-152";\n\n', '')
manual = sub_once(
    manual,
    r'type PactOfDarknessPayment = \{.*?\};\n\n',
    '',
    "remove Pact payment type",
)
manual = re.sub(r'\n  pactOfDarknessPayment\?: PactOfDarknessPayment;', '', manual)
manual = sub_once(
    manual,
    r'\nfunction clearPactOfDarknessPayment\(state: MatchState, cardId\?: string\) \{.*?\n\}\n',
    '\n',
    "remove Pact clear helper",
)
manual = manual.replace('  clearPactOfDarknessPayment(state);\n', '')
# Simplify skip branch by removing Pact state checks/cleanup.
manual = sub_once(
    manual,
    r'  if \(!flipCardId\) \{\n    const existingRules = ensureRulesState\(input\) as DamageResumeRules;\n    if \(flip\.catalogId === PACT_OF_DARKNESS_ID.*?\n    const state = cloneMatch\(input\);',
    '  if (!flipCardId) {\n    const state = cloneMatch(input);',
    "manual skip Pact check",
)
manual = manual.replace('    clearPactOfDarknessPayment(state, flip.id);\n', '')
# Replace all played-Flip/Pact payment logic after legality check.
manual = sub_once(
    manual,
    r'\n  const state = cloneMatch\(input\);\n  const statePlayer = playerById\(state, playerId\)!;\n  const stateFlip = state\.revealedFlip!;.*?\n  return state;\n\}\n\nexport function resumeDamageAfterFlipWindow',
    '\n  return prepareRevealedFlipPlay(input, playerId, flip.id, choices);\n}\n\nexport function resumeDamageAfterFlipWindow',
    "delegate Flip play",
)
write("lib/manualDamage.ts", manual)


# ---------------------------------------------------------------------------
# Card-payment facade now calls the same play commit instead of pre-paying and
# then reconstructing a second play path.
# ---------------------------------------------------------------------------
card_payment = read("lib/cardPayment.ts")
card_payment = re.sub(
    r'import \{\n  activeTappedEnergyIds,\n  availableEnergy,\n  beginCardPayment,\n  cardCostBreakdown,\n  prepareDeclaredEnergyPayment,\n\} from "\.\/rules\/costs";',
    'import { activeTappedEnergyIds, availableEnergy, cardCostBreakdown, prepareDeclaredEnergyPayment } from "./rules/costs";',
    card_payment,
)
card_payment = re.sub(r'import \{ ensureRulesState \} from "\.\/rules\/state";\n', '', card_payment)
card_payment = sub_once(
    card_payment,
    r'\nfunction payAdditionalCosts\(state: MatchState, playerId: string\) \{.*?\n\}\n',
    '\n',
    "remove duplicate additional cost payment",
)
card_payment = sub_once(
    card_payment,
    r'export function playCardWithAutoEnergy\(.*?\n\}',
    '''export function playCardWithAutoEnergy(
  input: MatchState,
  playerId: string,
  cardId: string,
  choices: CardChoices = {},
) {
  if (hasPendingDraws(input)) throw new Error("Complete every pending Draw action before playing another card.");
  const player = playerById(input, playerId);
  const card = player?.hand.find((candidate) => candidate.id === cardId);
  if (card?.type === "Evo") {
    const target = legalEvoTargets(input, playerId, card).find((candidate) => candidate.id === choices.targetBakuganId);
    if (!target) throw new Error("Select the Character identity listed by this Evo card.");
    choices = { ...choices, targetBakuganId: target.id };
  }
  return playCard(input, playerId, cardId, choices);
}''',
    "card payment unified play",
)
write("lib/cardPayment.ts", card_payment)


# ---------------------------------------------------------------------------
# Choice UI exposes unavailable payment methods (with reason) but cannot select
# them. This is how Pact + FrostStrike is explained instead of failing late.
# ---------------------------------------------------------------------------
editor = read("components/game-screen-v2/CardChoiceEditor.tsx")
editor = replace_once(
    editor,
    '  const toggle = (field: ChoiceField, id: string) => {\n    const current = selected(choices, field);',
    '  const toggle = (field: ChoiceField, id: string) => {\n    if (field.options.find((option) => option.id === id)?.disabled) return;\n    const current = selected(choices, field);',
    "editor disabled toggle",
)
editor = replace_once(
    editor,
    'return <button key={item.id} type="button" data-selected={active} aria-pressed={active} onClick={() => toggle(field, item.id)}><strong>{item.label}</strong></button>;',
    'return <button key={item.id} type="button" data-selected={active} aria-pressed={active} disabled={item.disabled} onClick={() => toggle(field, item.id)}><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</button>;',
    "editor disabled option",
)
write("components/game-screen-v2/CardChoiceEditor.tsx", editor)

queue = read("components/game-screen-v2/ChoiceQueueLayer.tsx")
queue = replace_once(
    queue,
    '  const toggle = useCallback((field: ChoiceField, id: string) => {\n    setAnswers((current) => {',
    '  const toggle = useCallback((field: ChoiceField, id: string) => {\n    if (field.options.find((option) => option.id === id)?.disabled) return;\n    setAnswers((current) => {',
    "queue disabled toggle",
)
queue = replace_once(
    queue,
    '    pending?.kind === "card-play"\n    && pending.controllerId === playerId\n',
    '    pending?.kind === "card-play"\n    && pending.cancellable !== false\n    && pending.controllerId === playerId\n',
    "queue cancel mandatory",
)
queue = replace_once(
    queue,
    'disabled={busy} onClick={() => toggle(field, item.id)}>',
    'disabled={busy || item.disabled} onClick={() => toggle(field, item.id)}>',
    "queue disabled option",
)
write("components/game-screen-v2/ChoiceQueueLayer.tsx", queue)


# ---------------------------------------------------------------------------
# Targeted regression tests for the generalized mechanics.
# ---------------------------------------------------------------------------
test_file = r'''import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, submitCardChoice } from "../lib/game";
import { resolveManualDamage } from "../lib/manualDamage";
import { cardCostBreakdown } from "../lib/rules/costs";
import { createRuleObject } from "../lib/rules/objects";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(id: string, instance: string) {
  const template = CARD_BY_ID.get(id);
  assert.ok(template, `Missing ${id}`);
  return { ...structuredClone(template), id: instance };
}

function baseMatch(code = "PLAYPIPE") {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch(code, "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.priority = first.id;
  state.startingPlayer = first.id;
  return { state, first, second };
}

test("Pact of Darkness exposes an unaffordable Sacrifice route instead of allowing a late failed discard", () => {
  const { state, first, second } = baseMatch("PACTFROST");
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;
  const pact = card("bb-152", "pact-frost");
  const fodder = card("bb-1", "pact-fodder");
  first.hand = [fodder];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = [card("bb-1", "energy-a"), card("bb-1", "energy-b")];
  first.maxEnergy = 2;
  const attacker = second.bakugan[0];
  attacker.open = true;
  state.damageOrigin = attacker.id;
  state.frostStrike[attacker.id] = 3;
  state.revealedFlip = pact;

  const next = resolveManualDamage(state, first.id, pact.id);
  const payment = next.pendingChoice?.schema.fields.find((field) => field.id === "paymentMode");
  assert.ok(payment);
  const sacrifice = payment.options.find((option) => option.id.endsWith(":discard-for-free"));
  assert.equal(sacrifice?.disabled, true);
  assert.match(sacrifice?.description ?? "", /3 Energy.*only 2/i);
  assert.throws(() => submitCardChoice(next, first.id, { paymentMode: sacrifice!.id }), /illegal selection/i);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === fodder.id), true);
});

test("Pact of Darkness Sacrifice is a generic atomic alternative cost and free base still pays FrostStrike", () => {
  const { state, first, second } = baseMatch("PACTLEGAL");
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;
  const pact = card("bb-152", "pact-legal");
  const fodder = card("bb-1", "pact-fodder-legal");
  first.hand = [fodder];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = [card("bb-1", "pe-a"), card("bb-1", "pe-b"), card("bb-1", "pe-c")];
  first.maxEnergy = 3;
  const attacker = second.bakugan[0];
  attacker.open = true;
  state.damageOrigin = attacker.id;
  state.frostStrike[attacker.id] = 3;
  state.revealedFlip = pact;

  let next = resolveManualDamage(state, first.id, pact.id);
  const payment = next.pendingChoice!.schema.fields.find((field) => field.id === "paymentMode")!;
  const sacrifice = payment.options.find((option) => option.id.endsWith(":discard-for-free"))!;
  assert.equal(sacrifice.disabled, false);
  next = submitCardChoice(next, first.id, { paymentMode: sacrifice.id });
  assert.equal(next.pendingChoice?.schema.fields[0]?.id, "discardCardIds");
  next = submitCardChoice(next, first.id, { discardCardIds: [fodder.id] });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.players[0].energy, 0);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === fodder.id), false);
  assert.equal(next.players[0].discard.some((candidate) => candidate.id === fodder.id), true);
  assert.equal(next.batch.some((object) => object.card.id === pact.id && object.rulesObjectVersion === 3), true);
  assert.equal(next.revealedFlip, undefined);
});

test("conditional self-free Evos use the normal cost calculation", () => {
  const { state, first } = baseMatch("SELF_FREE");
  const fangzor = card("br-102", "fangzor-free");
  first.hand = [fangzor];
  first.discard = Array.from({ length: 20 }, (_, index) => card("bb-1", `discard-${index}`));
  const breakdown = cardCostBreakdown(state, first.id, fangzor);
  assert.equal(breakdown.freeBase, true);
  assert.equal(breakdown.total, 0);
});

test("Sneak Attack stores a turn-scoped free Evo permission for both players", () => {
  const { state, first, second } = baseMatch("SNEAK_FREE");
  const sneak = card("br-10", "sneak-effect");
  const definition = ruleDefinitionForCard(sneak);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);
  state.batch = [createRuleObject({ controllerId: first.id, card: sneak, ability, kind: "card" })];
  let next = passPriority(state, first.id);
  next = passPriority(next, second.id);
  const firstEvo = card("br-102", "first-evo");
  const secondEvo = card("br-128", "second-evo");
  first.hand = [firstEvo];
  second.hand = [secondEvo];
  const liveFirst = next.players.find((player) => player.id === first.id)!;
  const liveSecond = next.players.find((player) => player.id === second.id)!;
  liveFirst.hand = [firstEvo];
  liveSecond.hand = [secondEvo];
  assert.equal(cardCostBreakdown(next, first.id, firstEvo).freeBase, true);
  assert.equal(cardCostBreakdown(next, second.id, secondEvo).freeBase, true);
});
'''
write("tests/card-play-pipeline.test.ts", test_file)

# Update the old Pact regression to the new generic two-stage transaction: choose
# payment mode, choose its additional cost, and the play commits immediately.
pact_test = read("tests/pact-cubbo-regressions.test.ts")
pact_test = sub_once(
    pact_test,
    r'test\("Pact of Darkness keeps its printed cost until Sacrifice discards a card", \(\) => \{.*?\n\}\);',
    r'''test("Pact of Darkness uses the generic Sacrifice payment route", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("PACT152", "bo1", [first, second]);
  state.turn = 3;
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;

  const pactTemplate = CARD_BY_ID.get("bb-152");
  const discardTemplate = CARD_BY_ID.get("bb-1");
  assert.ok(pactTemplate && discardTemplate);
  const pact = { ...structuredClone(pactTemplate), id: "bb-152-revealed" };
  const sacrificed = { ...structuredClone(discardTemplate), id: "pact-sacrifice-card" };
  first.hand = [sacrificed];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(discardTemplate),
    id: `pact-energy-${index}`,
  }));
  first.maxEnergy = 4;
  state.revealedFlip = pact;

  assert.equal(effectiveCardEnergyCost(state, first.id, pact), 4);
  let next = resolveManualDamage(state, first.id, pact.id);
  const mode = next.pendingChoice?.schema.fields.find((field) => field.id === "paymentMode");
  assert.ok(mode);
  const sacrificeMode = mode.options.find((option) => option.id.endsWith(":discard-for-free"));
  assert.ok(sacrificeMode && !sacrificeMode.disabled);

  next = submitCardChoice(next, first.id, { paymentMode: sacrificeMode.id });
  assert.equal(next.pendingChoice?.schema.fields[0]?.id, "discardCardIds");
  const actions = visibleMatchHudActions({
    match: next,
    playerId: first.id,
    mode: "discard",
    selectedCardId: "",
    selectionPending: false,
  });
  assert.deepEqual(compactMatchHudSlots(actions), ["discard", "skip-flip"]);

  next = submitCardChoice(next, first.id, { discardCardIds: [sacrificed.id] });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.players[0].hand.some((card) => card.id === sacrificed.id), false);
  assert.equal(next.players[0].discard.some((card) => card.id === sacrificed.id), true);
  assert.equal(next.batch.some((effect) => effect.card.id === pact.id), true);
  assert.equal(next.players[0].energy, 0);
  assert.equal(next.revealedFlip, undefined);
});''',
    "update Pact regression",
)
write("tests/pact-cubbo-regressions.test.ts", pact_test)

print("Unified card-play pipeline patch applied.")
