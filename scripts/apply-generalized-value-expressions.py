from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_optional(text: str, old: str, new: str) -> str:
    return text.replace(old, new, 1) if old in text else text


def regex_once(text: str, pattern: str, replacement, label: str, flags: int = 0) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


# ---------------------------------------------------------------------------
# Stage 2: make the typed rules model consume the generalized value language.
# ---------------------------------------------------------------------------
model_path = "lib/rules/model.ts"
model = read(model_path)
model = replace_once(
    model,
    'import type { AmountExpression, ChooserOwner, PlayerScope, ZoneOwner } from "./primitives";\n',
    'import type { AmountExpression, ChooserOwner, PlayerScope, ZoneOwner } from "./primitives";\nimport type { BooleanExpression, NumberValue } from "./values";\n',
    "model value imports",
)

condition_replacements = {
    '| { kind: "cards-played"; comparison: "at-least" | "more-than"; amount: number }': '| { kind: "cards-played"; comparison: "at-least" | "more-than"; amount: NumberValue }',
    '| { kind: "factions-played"; comparison: "at-least"; amount: number }': '| { kind: "factions-played"; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "hero-count"; comparison: "at-least"; amount: number }': '| { kind: "hero-count"; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "energy-count"; comparison: "at-least"; amount: number }': '| { kind: "energy-count"; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "discard-count"; comparison: "at-least"; amount: number }': '| { kind: "discard-count"; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "played-card-cost"; comparison: "at-least"; amount: number }': '| { kind: "played-card-cost"; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "card-count"; catalogId: RulesCardId; comparison: "at-least"; amount: number }': '| { kind: "card-count"; catalogId: RulesCardId; comparison: "at-least"; amount: NumberValue }',
    '| { kind: "core-count"; relationship: "more-than-opponent" | "at-least"; amount?: number }': '| { kind: "core-count"; relationship: "more-than-opponent" | "at-least"; amount?: NumberValue }',
    '| { kind: "open-bakugan-count"; comparison: "exactly" | "at-least" | "at-most" | "more-than" | "fewer-than"; amount: number }': '| { kind: "open-bakugan-count"; comparison: "exactly" | "at-least" | "at-most" | "more-than" | "fewer-than"; amount: NumberValue }',
}
for old, new in condition_replacements.items():
    if old in model:
        model = model.replace(old, new)

model = replace_once(
    model,
    '  | { kind: "coin-result"; result: "heads" | "tails" }\n  | { kind: "printed"; text: string };',
    '  | { kind: "coin-result"; result: "heads" | "tails" }\n  | { kind: "expression"; expression: BooleanExpression }\n  | { kind: "printed"; text: string };',
    "generic boolean condition",
)

for field in ["minimum", "maximum", "maximumCost", "minimumCost"]:
    model = model.replace(f"  {field}?: number;", f"  {field}?: NumberValue;")
model = model.replace("  minimumEventAmount?: number;", "  minimumEventAmount?: NumberValue;")

cost_replacements = {
    '| { kind: "cost-reduce"; amount: number;': '| { kind: "cost-reduce"; amount: NumberValue;',
    '| { kind: "cost-increase"; amount: number;': '| { kind: "cost-increase"; amount: NumberValue;',
    '| { kind: "cost-discard"; amount: number;': '| { kind: "cost-discard"; amount: NumberValue;',
}
for old, new in cost_replacements.items():
    model = model.replace(old, new)

action_replacements = {
    'kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: number;': 'kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: NumberValue;',
    'kind: "grant-keyword"; keyword: "DoubleStrike" | "ShadowStrike" | "FrostStrike" | "Victor" | "Stop"; value?: number;': 'kind: "grant-keyword"; keyword: "DoubleStrike" | "ShadowStrike" | "FrostStrike" | "Victor" | "Stop"; value?: NumberValue;',
    'kind: "draw"; amount: number;': 'kind: "draw"; amount: NumberValue;',
    'kind: "discard"; amount: number; amountExpression?: AmountExpression; minimum: number; maximum: number;': 'kind: "discard"; amount: NumberValue; amountExpression?: AmountExpression; minimum: NumberValue; maximum: NumberValue;',
    'kind: "energize"; amount: number;': 'kind: "energize"; amount: NumberValue;',
    'kind: "generate-energy"; amount: number;': 'kind: "generate-energy"; amount: NumberValue;',
    'kind: "recharge-energy"; amount: number | "all"': 'kind: "recharge-energy"; amount: NumberValue | "all"',
    'kind: "set-stat"; stat: "power" | "damage"; value: number': 'kind: "set-stat"; stat: "power" | "damage"; value: NumberValue',
    'verb: "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control"; amount: number': 'verb: "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control"; amount: NumberValue',
    'kind: "reveal"; object: "bakucore" | "deck-top"; amount: number': 'kind: "reveal"; object: "bakucore" | "deck-top"; amount: NumberValue',
    'kind: "reorder-deck"; amount: number': 'kind: "reorder-deck"; amount: NumberValue',
    'cardName?: string; maximumCost?: number;': 'cardName?: string; maximumCost?: NumberValue;',
    'kind: "attack"; amount: number;': 'kind: "attack"; amount: NumberValue;',
    'targetChoiceId?: keyof CardChoices; maximumCost?: number;': 'targetChoiceId?: keyof CardChoices; maximumCost?: NumberValue;',
    'kind: "search"; cardType?: string; amount: number': 'kind: "search"; cardType?: string; amount: NumberValue',
    'count?: AmountExpression;': 'count?: NumberValue;',
    'kind: "cost"; amount: number;': 'kind: "cost"; amount: NumberValue;',
    'kind: "prevention"; event: ProposedEvent["kind"]; amount?: number;': 'kind: "prevention"; event: ProposedEvent["kind"]; amount?: NumberValue;',
}
for old, new in action_replacements.items():
    model = model.replace(old, new)

model = model.replace("  amount: number;\n  layer: ModifierLayer;", "  amount: NumberValue;\n  layer: ModifierLayer;")
model = replace_optional(
    model,
    "  copiedFromObjectId?: string;\n};",
    "  copiedFromObjectId?: string;\n  /** Values captured at announce/pay/resolve boundaries for deterministic evaluation. */\n  valueSnapshots?: Record<string, number>;\n};",
)
model = replace_optional(
    model,
    "  irreversibleInformation?: boolean;\n};\n\nexport type StoredCostModifier",
    "  irreversibleInformation?: boolean;\n  valueSnapshots?: Record<string, number>;\n};\n\nexport type StoredCostModifier",
)
model = model.replace(
    "  amount: number;\n  duration: \"turn\" | \"next-card\";\n  cardType?: CardType;\n  playerScope: PlayerScope;",
    "  amount: NumberValue;\n  duration: \"turn\" | \"next-card\";\n  cardType?: CardType;\n  playerScope: PlayerScope;\n  choices?: CardChoices;\n  valueSnapshots?: Record<string, number>;",
)
write(model_path, model)


# ---------------------------------------------------------------------------
# Stage 3a: dynamic cost expressions.
# ---------------------------------------------------------------------------
costs_path = "lib/rules/costs.ts"
costs = read(costs_path)
costs = replace_once(
    costs,
    'import { ensureRulesState } from "./state";\n',
    'import { ensureRulesState } from "./state";\nimport { evaluateNumberValue, type NumberValue } from "./values";\n',
    "cost evaluator import",
)
costs = replace_once(
    costs,
    'function choiceHasValue(choices: CardChoices, id: keyof CardChoices) {\n  const selected = choices[id];\n  return Array.isArray(selected) ? selected.length > 0 : selected !== undefined && selected !== false && selected !== "";\n}\n',
    'function choiceHasValue(choices: CardChoices, id: keyof CardChoices) {\n  const selected = choices[id];\n  return Array.isArray(selected) ? selected.length > 0 : selected !== undefined && selected !== false && selected !== "";\n}\n\nfunction costValue(state: MatchState, playerId: string, value: NumberValue, choices: CardChoices = {}, capturedValues?: Record<string, number>) {\n  return evaluateNumberValue(state, value, {\n    controllerId: playerId,\n    chosenPlayerId: choices.targetPlayerId,\n    choices,\n    moment: "pay",\n    capturedValues,\n  });\n}\n',
    "cost value helper",
)
costs = costs.replace("      reductions += modifier.amount * variableMultiplier;", "      reductions += costValue(state, playerId, modifier.amount, choices) * variableMultiplier;")
costs = costs.replace("    } else if (modifier.kind === \"cost-increase\") increases += modifier.amount;", "    } else if (modifier.kind === \"cost-increase\") increases += costValue(state, playerId, modifier.amount, choices);")
costs = costs.replace("      additionalCosts.push({ kind: \"discard\", amount: modifier.amount, choiceId: modifier.choiceId });", "      additionalCosts.push({ kind: \"discard\", amount: Math.max(0, Math.floor(costValue(state, playerId, modifier.amount, choices))), choiceId: modifier.choiceId });")
costs = costs.replace("        additionalCosts.push({ kind: \"discard\", amount: component.amount, choiceId: component.choiceId });", "        additionalCosts.push({ kind: \"discard\", amount: Math.max(0, Math.floor(costValue(state, playerId, component.amount, choices))), choiceId: component.choiceId });")
costs = costs.replace("    else if (modifier.kind === \"reduce\") reductions += modifier.amount;\n    else increases += modifier.amount;", "    else if (modifier.kind === \"reduce\") reductions += costValue(state, playerId, modifier.amount, modifier.choices ?? choices, modifier.valueSnapshots);\n    else increases += costValue(state, playerId, modifier.amount, modifier.choices ?? choices, modifier.valueSnapshots);")
write(costs_path, costs)


# ---------------------------------------------------------------------------
# Stage 3b: dynamic choice bounds and card-cost filters.
# ---------------------------------------------------------------------------
choices_path = "lib/rules/choices.ts"
choices = read(choices_path)
choices = replace_once(
    choices,
    'import { chooserIdsFor, zoneOwnerIdsFor } from "./primitives";\n',
    'import { chooserIdsFor, zoneOwnerIdsFor } from "./primitives";\nimport { evaluateNumberValue, type NumberValue } from "./values";\n',
    "choice evaluator import",
)
choices = regex_once(
    choices,
    r'function rangeFor\(spec: ChoiceSpec, available: number\) \{.*?\n\}\nfunction topDeckCount\(spec: ChoiceSpec\) \{.*?\n\}\n',
    '''function choiceNumber(\n  match: MatchState,\n  controllerId: string,\n  value: NumberValue | undefined,\n  priorChoices: CardChoices,\n  chooserId = controllerId,\n  fallback = 0,\n) {\n  if (value == null) return fallback;\n  return evaluateNumberValue(match, value, {\n    controllerId,\n    chooserId,\n    chosenPlayerId: priorChoices.targetPlayerId,\n    choices: priorChoices,\n    moment: "announce",\n  });\n}\nfunction rangeFor(\n  match: MatchState,\n  controllerId: string,\n  spec: ChoiceSpec,\n  available: number,\n  priorChoices: CardChoices,\n  chooserId: string,\n) {\n  const printedMinimum = Math.max(0, Math.floor(choiceNumber(match, controllerId, spec.minimum, priorChoices, chooserId, spec.optional ? 0 : 1)));\n  const printedMaximum = Math.max(printedMinimum, Math.floor(choiceNumber(match, controllerId, spec.maximum, priorChoices, chooserId, 1)));\n  const scarcityBounded = spec.selector === "deck-card" && topDeckCount(match, controllerId, spec, priorChoices, chooserId) > 0;\n  const availableMaximum = Math.min(available, printedMaximum);\n  const maximum = scarcityBounded\n    ? availableMaximum\n    : Math.max(printedMinimum, availableMaximum);\n  const minimum = scarcityBounded ? Math.min(printedMinimum, maximum) : printedMinimum;\n  return { minimum, maximum };\n}\nfunction topDeckCount(\n  match: MatchState,\n  controllerId: string,\n  spec: ChoiceSpec,\n  priorChoices: CardChoices,\n  chooserId = controllerId,\n) {\n  if (spec.id === "orderedCardIds" && spec.maximum != null) {\n    return Math.max(0, Math.floor(choiceNumber(match, controllerId, spec.maximum, priorChoices, chooserId)));\n  }\n  const numeric = spec.label.match(/\\btop\\s+(\\d+)\\s+cards?\\b/i)?.[1];\n  return numeric ? Math.max(0, Number(numeric)) : 0;\n}\n''',
    "dynamic choice ranges",
    flags=re.S,
)
choices = choices.replace("function cardMatchesSpec(candidate: GameCard, spec: ChoiceSpec) {", "function cardMatchesSpecValue(\n  match: MatchState,\n  controllerId: string,\n  candidate: GameCard,\n  spec: ChoiceSpec,\n  priorChoices: CardChoices,\n  chooserId: string,\n) {")
choices = choices.replace(
    "  if (spec.maximumCost != null && printedCost > spec.maximumCost) return false;\n  if (spec.minimumCost != null && printedCost < spec.minimumCost) return false;",
    "  const maximumCost = spec.maximumCost == null ? undefined : choiceNumber(match, controllerId, spec.maximumCost, priorChoices, chooserId);\n  const minimumCost = spec.minimumCost == null ? undefined : choiceNumber(match, controllerId, spec.minimumCost, priorChoices, chooserId);\n  if (maximumCost != null && printedCost > maximumCost) return false;\n  if (minimumCost != null && printedCost < minimumCost) return false;",
)
choices = replace_once(
    choices,
    "  const controller = playerById(match, controllerId);\n  const opponent = opponentOf(match, controllerId);\n  switch (spec.selector) {",
    "  const controller = playerById(match, controllerId);\n  const opponent = opponentOf(match, controllerId);\n  const cardMatchesSpec = (candidate: GameCard, candidateSpec: ChoiceSpec = spec) => cardMatchesSpecValue(\n    match, controllerId, candidate, candidateSpec, priorChoices, chooserId,\n  );\n  switch (spec.selector) {",
    "choice card matcher closure",
)
choices = choices.replace("      const count = topDeckCount(spec);", "      const count = topDeckCount(match, controllerId, spec, priorChoices, chooserId);")
choices = choices.replace("      const range = rangeFor(spec, options.length);", "      const range = rangeFor(match, controllerId, spec, options.length, priorChoices, chooserId);")
choices = choices.replace(
    '        ...(kindFor(spec) === "deck-order" && topDeckCount(spec) > 0\n          ? { requestedWindowSize: topDeckCount(spec) }',
    '        ...(kindFor(spec) === "deck-order" && topDeckCount(match, controllerId, spec, priorChoices, chooserId) > 0\n          ? { requestedWindowSize: topDeckCount(match, controllerId, spec, priorChoices, chooserId) }',
)
write(choices_path, choices)


# ---------------------------------------------------------------------------
# Stage 3c: conditions and continuous modifiers consume expressions.
# ---------------------------------------------------------------------------
modifiers_path = "lib/rules/modifiers.ts"
modifiers = read(modifiers_path)
modifiers = replace_once(
    modifiers,
    'import { ensureRulesState } from "./state";\n',
    'import { ensureRulesState } from "./state";\nimport { evaluateBooleanValue, evaluateNumberValue } from "./values";\nimport type { CardChoices } from "../game";\n',
    "modifier evaluator imports",
)
modifiers = modifiers.replace(
    "export function ruleConditionActive(state: MatchState, player: PlayerState, condition: RuleCondition | undefined, bakugan?: Bakugan) {",
    "export function ruleConditionActive(\n  state: MatchState,\n  player: PlayerState,\n  condition: RuleCondition | undefined,\n  bakugan?: Bakugan,\n  choices: CardChoices = {},\n) {",
)
modifiers = replace_once(
    modifiers,
    "  const opponent = opponentOf(state, player);\n  switch (condition.kind) {",
    "  const opponent = opponentOf(state, player);\n  const conditionValue = (value: import(\"./values\").NumberValue) => evaluateNumberValue(state, value, {\n    controllerId: player.id,\n    chosenPlayerId: choices.targetPlayerId,\n    choices,\n    sourceBakuganId: choices.sourceBakuganId ?? bakugan?.id,\n    moment: \"resolve\",\n    characteristics: (candidate, owner) => evaluateBakuganCharacteristics(state, candidate, owner),\n  });\n  switch (condition.kind) {",
    "condition numeric helper",
)
condition_numeric = {
    "player.cardsPlayedThisTurn >= condition.amount": "player.cardsPlayedThisTurn >= conditionValue(condition.amount)",
    "player.cardsPlayedThisTurn > condition.amount": "player.cardsPlayedThisTurn > conditionValue(condition.amount)",
    "new Set(player.factionsPlayedThisTurn ?? []).size >= condition.amount": "new Set(player.factionsPlayedThisTurn ?? []).size >= conditionValue(condition.amount)",
    "player.heroes.length >= condition.amount": "player.heroes.length >= conditionValue(condition.amount)",
    "player.maxEnergy >= condition.amount": "player.maxEnergy >= conditionValue(condition.amount)",
    "player.discard.length >= condition.amount": "player.discard.length >= conditionValue(condition.amount)",
    "Math.max(0, ...(player.playedCardCostsThisTurn ?? [])) >= condition.amount": "Math.max(0, ...(player.playedCardCostsThisTurn ?? [])) >= conditionValue(condition.amount)",
    "player.heroes.filter((hero) => hero.catalogId === condition.catalogId).length >= condition.amount": "player.heroes.filter((hero) => hero.catalogId === condition.catalogId).length >= conditionValue(condition.amount)",
    "held >= (condition.amount ?? 0)": "held >= conditionValue(condition.amount ?? 0)",
    "open === condition.amount": "open === conditionValue(condition.amount)",
    "open >= condition.amount": "open >= conditionValue(condition.amount)",
    "open <= condition.amount": "open <= conditionValue(condition.amount)",
    "open > condition.amount": "open > conditionValue(condition.amount)",
    "open < condition.amount": "open < conditionValue(condition.amount)",
}
for old, new in condition_numeric.items():
    modifiers = modifiers.replace(old, new)
modifiers = replace_once(
    modifiers,
    '    case "coin-result": return false;\n    case "printed": return false;',
    '    case "coin-result": return false;\n    case "expression": return evaluateBooleanValue(state, condition.expression, {\n      controllerId: player.id,\n      chosenPlayerId: choices.targetPlayerId,\n      choices,\n      sourceBakuganId: choices.sourceBakuganId ?? bakugan?.id,\n      moment: "resolve",\n      characteristics: (candidate, owner) => evaluateBakuganCharacteristics(state, candidate, owner),\n    });\n    case "printed": return false;',
    "generic boolean condition runtime",
)
# Continuous modifiers may remain live expressions. Resolve them against the target immediately before layer application.
modifiers = modifiers.replace(
    "  const mirroredPower = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.stat === \"power\" ? modifier.amount : 0)\n  ), 0);\n  const mirroredDamage = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.stat === \"damage\" ? modifier.amount : 0)\n  ), 0);\n  const mirroredFrost = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.keyword === \"FrostStrike\" ? modifier.amount : 0)\n  ), 0);",
    "  const liveModifierAmount = (modifier: ContinuousModifier) => evaluateNumberValue(state, modifier.amount, {\n    controllerId: modifier.controllerId,\n    chosenPlayerId: owner.id,\n    choices: { targetBakuganId: bakugan.id },\n    sourceBakuganId: modifier.source.kind === \"bakugan\" ? modifier.source.id : undefined,\n    sourceCardId: \"instanceId\" in modifier.source ? modifier.source.instanceId : undefined,\n    moment: \"continuous\",\n  });\n  const mirroredPower = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.stat === \"power\" ? liveModifierAmount(modifier) : 0)\n  ), 0);\n  const mirroredDamage = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.stat === \"damage\" ? liveModifierAmount(modifier) : 0)\n  ), 0);\n  const mirroredFrost = mirrored.reduce((sum, modifier) => (\n    sum + (modifier.keyword === \"FrostStrike\" ? liveModifierAmount(modifier) : 0)\n  ), 0);",
)
modifiers = replace_once(
    modifiers,
    "  const modifiers = [...coreModifiers, ...activePrintedModifiers(state, owner, bakugan), ...storedModifiers, ...temporary]\n    .filter((modifier) => targetMatches(state, modifier, bakugan, owner) && ruleConditionActive(state, owner, modifier.condition, bakugan))\n    .sort((left, right) => LAYER_ORDER[left.layer] - LAYER_ORDER[right.layer] || left.id.localeCompare(right.id));",
    "  const modifiers = [...coreModifiers, ...activePrintedModifiers(state, owner, bakugan), ...storedModifiers, ...temporary]\n    .filter((modifier) => targetMatches(state, modifier, bakugan, owner) && ruleConditionActive(state, owner, modifier.condition, bakugan))\n    .map((modifier) => ({ ...modifier, amount: liveModifierAmount(modifier) }))\n    .sort((left, right) => LAYER_ORDER[left.layer] - LAYER_ORDER[right.layer] || left.id.localeCompare(right.id));",
    "resolve continuous modifier amounts",
)
# Printed continuous actions need to evaluate NumberValue rather than multiply objects.
modifiers = modifiers.replace(
    '    amount: action.kind === "grant-keyword" ? action.value ?? 1 : action.amount * printedScaleMultiplier(action.scale, player),',
    '    amount: action.kind === "grant-keyword"\n      ? evaluateNumberValue(state, action.value ?? 1, { controllerId: player.id, choices: { targetBakuganId: bakugan.id }, moment: "continuous" })\n      : evaluateNumberValue(state, action.amount, { controllerId: player.id, choices: { targetBakuganId: bakugan.id }, moment: "continuous" }) * printedScaleMultiplier(action.scale, player),',
)
write(modifiers_path, modifiers)


# ---------------------------------------------------------------------------
# Stage 3d: triggers and replacement/prevention amounts.
# ---------------------------------------------------------------------------
triggers_path = "lib/rules/triggers.ts"
triggers = read(triggers_path)
triggers = replace_once(
    triggers,
    'import { ensureRulesState } from "./state";\n',
    'import { ensureRulesState } from "./state";\nimport { evaluateNumberValue } from "./values";\n',
    "trigger evaluator import",
)
triggers = triggers.replace(
    '  if (trigger.minimumEventAmount != null && (event.amount ?? 0) < trigger.minimumEventAmount) return false;',
    '  if (trigger.minimumEventAmount != null && (event.amount ?? 0) < evaluateNumberValue(state, trigger.minimumEventAmount, {\n    controllerId: owner.id,\n    choices: event.choices,\n    sourceCardId: source.id,\n    sourceBakuganId: sourceBakuganFor(owner, source)?.id,\n    event: { amount: event.amount, playerId: event.actorId, sourceId: event.card?.id, targetId: event.targetBakuganId },\n    moment: "event",\n  })) return false;',
)
triggers = triggers.replace(
    "  if (trigger.interveningCondition && !ruleConditionActive(state, owner, trigger.interveningCondition, target)) return false;",
    "  if (trigger.interveningCondition && !ruleConditionActive(state, owner, trigger.interveningCondition, target, event.choices ?? {})) return false;",
)
triggers = triggers.replace(
    "  return Boolean(owner && ruleConditionActive(state, owner, ability.trigger.interveningCondition, target));",
    "  return Boolean(owner && ruleConditionActive(state, owner, ability.trigger.interveningCondition, target, object.choices));",
)
write(triggers_path, triggers)

replacements_path = "lib/rules/replacements.ts"
replacements = read(replacements_path)
replacements = replace_once(
    replacements,
    'import { ensureRulesState } from "./state";\n',
    'import { ensureRulesState } from "./state";\nimport { evaluateNumberValue } from "./values";\n',
    "replacement evaluator import",
)
replacements = replacements.replace(
    "function eventFromActions(event: ProposedEvent, actions: RuleAction[]) {",
    "function eventFromActions(state: MatchState, controllerId: string, event: ProposedEvent, actions: RuleAction[]) {",
)
replacements = replacements.replace(
    '    else if (action.kind === "prevention" && action.event === next.kind) next.amount = Math.max(0, (next.amount ?? 0) - (action.amount ?? next.amount ?? 0));',
    '    else if (action.kind === "prevention" && action.event === next.kind) {\n      const amount = action.amount == null ? next.amount ?? 0 : evaluateNumberValue(state, action.amount, {\n        controllerId,\n        event: { amount: next.amount, playerId: next.actorId, sourceId: next.sourceId, targetId: next.targetId },\n        moment: "event",\n      });\n      next.amount = Math.max(0, (next.amount ?? 0) - amount);\n    }',
)
replacements = replacements.replace(
    '    else if (action.kind === "replacement" && action.event === next.kind) next = eventFromActions(next, action.replaceWith);\n    else if (action.kind === "sequence") next = eventFromActions(next, action.effects);',
    '    else if (action.kind === "replacement" && action.event === next.kind) next = eventFromActions(state, controllerId, next, action.replaceWith);\n    else if (action.kind === "sequence") next = eventFromActions(state, controllerId, next, action.effects);',
)
replacements = replacements.replace(
    "      const amount = selected.effect.amount ?? event.amount ?? 0;",
    "      const amount = selected.effect.amount == null\n        ? event.amount ?? 0\n        : evaluateNumberValue(state, selected.effect.amount, {\n          controllerId: selected.controllerId,\n          event: { amount: event.amount, playerId: event.actorId, sourceId: event.sourceId, targetId: event.targetId },\n          moment: \"event\",\n        });",
)
replacements = replacements.replace(
    "      event = eventFromActions(event, selected.effect.replaceWith);",
    "      event = eventFromActions(state, selected.controllerId, event, selected.effect.replaceWith);",
)
write(replacements_path, replacements)


# ---------------------------------------------------------------------------
# Stage 3e: route every action's numeric field through one evaluator.
# ---------------------------------------------------------------------------
game_path = "lib/game.ts"
game = read(game_path)
game = replace_once(
    game,
    'import { evaluateAmountExpression, playerIdsForScope, zoneOwnerIdsFor } from "./rules/primitives";\n',
    'import { evaluateAmountExpression, playerIdsForScope, zoneOwnerIdsFor } from "./rules/primitives";\nimport { evaluateNumberValue, type NumberValue } from "./rules/values";\n',
    "game value imports",
)
game = replace_once(
    game,
    "  const target = allBakugan.find((bakugan) => bakugan.id === rerollTargetId)\n    ?? chooseBakugan(state, controllerId, choices, preferEnemy);\n\n  switch (action.kind) {",
    "  const target = allBakugan.find((bakugan) => bakugan.id === rerollTargetId)\n    ?? chooseBakugan(state, controllerId, choices, preferEnemy);\n  const resolveNumber = (value: NumberValue, scopedChoices: CardChoices = choices, chooserId?: string) => evaluateNumberValue(state, value, {\n    controllerId,\n    chooserId,\n    chosenPlayerId: scopedChoices.targetPlayerId,\n    choices: scopedChoices,\n    sourceBakuganId: scopedChoices.sourceBakuganId,\n    sourceCardId: pending.sourceId ?? pending.card.id,\n    moment: \"resolve\",\n    capturedValues: isRuleObject(pending) ? pending.valueSnapshots : undefined,\n  });\n\n  switch (action.kind) {",
    "game action value helper",
)
game = game.replace(" + action.amount;", " + resolveNumber(action.amount);")
game = game.replace(" - action.amount;", " - resolveNumber(action.amount);")
game = game.replace(
    "      let amount = action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : scaleStat(state, player, text, action.amount, action.stat, action.scale);",
    "      const baseAmount = resolveNumber(action.amount);\n      let amount = action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : action.scale ? scaleStat(state, player, text, baseAmount, action.stat, action.scale) : baseAmount;",
)
game = game.replace(
    "      else if (action.keyword === \"FrostStrike\") state.frostStrike[target.id] = (state.frostStrike[target.id] ?? 0) + (action.value ?? 1);",
    "      else if (action.keyword === \"FrostStrike\") state.frostStrike[target.id] = (state.frostStrike[target.id] ?? 0) + resolveNumber(action.value ?? 1);",
)
game = game.replace(
    "      const amount = Math.max(0, Math.floor(action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : action.scale ? scaleStat(state, player, text, action.amount, \"draw\", action.scale) : action.amount));",
    "      const baseAmount = resolveNumber(action.amount);\n      const amount = Math.max(0, Math.floor(action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : action.scale ? scaleStat(state, player, text, baseAmount, \"draw\", action.scale) : baseAmount));",
)
game = game.replace(
    "        const expressionAmount = action.amountExpression\n          ? Math.max(0, Math.floor(evaluateAmountExpression(state, action.amountExpression, { controllerId, chooserId: affectedId, chosenPlayerId: affectedId, choices: scopedChoices })))\n          : action.amount;\n        const amount = action.minimum === 0 ? selected.length : selected.length || expressionAmount;\n        if (amount > 0) discardFromHand(state, affected, Math.min(action.maximum, amount), selected);",
    "        const expressionAmount = action.amountExpression\n          ? Math.max(0, Math.floor(evaluateAmountExpression(state, action.amountExpression, { controllerId, chooserId: affectedId, chosenPlayerId: affectedId, choices: scopedChoices })))\n          : Math.max(0, Math.floor(resolveNumber(action.amount, scopedChoices, affectedId)));\n        const minimum = Math.max(0, Math.floor(resolveNumber(action.minimum, scopedChoices, affectedId)));\n        const maximum = Math.max(minimum, Math.floor(resolveNumber(action.maximum, scopedChoices, affectedId)));\n        const amount = minimum === 0 ? selected.length : selected.length || expressionAmount;\n        if (amount > 0) discardFromHand(state, affected, Math.min(maximum, amount), selected);",
)
# Energize block: evaluate once and use the resolved integer in every source branch.
game = replace_once(
    game,
    '    case "energize": {\n      if (choices.confirmed === false) return;',
    '    case "energize": {\n      if (choices.confirmed === false) return;\n      const amount = Math.max(0, Math.floor(resolveNumber(action.amount)));',
    "energize value",
)
energize_pattern = r'(case "energize": \{.*?\n    \}\n    case "generate-energy":)'
def energize_repl(match: re.Match[str]) -> str:
    block = match.group(1).replace("action.amount", "amount")
    return block
game = regex_once(game, energize_pattern, energize_repl, "energize amount uses", flags=re.S)
game = game.replace(
    '          : scaleStat(state, player, text, action.amount, "draw", action.scale);',
    '          : action.scale ? scaleStat(state, player, text, resolveNumber(action.amount, choices, recipientId), "draw", action.scale) : resolveNumber(action.amount, choices, recipientId);',
)
game = game.replace(
    '      const selected = action.amount === "all" ? undefined : (choices.targetEnergyIds ?? []).slice(0, action.amount);',
    '      const selected = action.amount === "all" ? undefined : (choices.targetEnergyIds ?? []).slice(0, Math.max(0, Math.floor(resolveNumber(action.amount))));',
)
game = game.replace(
    '        if (action.stat === "power") state.powerBoost[target.id] = action.value - (topCard(target).bPower ?? target.bPower);\n        else state.damageBoost[target.id] = action.value - (topCard(target).damage ?? target.damage);',
    '        const value = resolveNumber(action.value);\n        if (action.stat === "power") state.powerBoost[target.id] = value - (topCard(target).bPower ?? target.bPower);\n        else state.damageBoost[target.id] = value - (topCard(target).damage ?? target.damage);',
)
# Move case has several historical >2 sentinels; preserve semantics after resolving the expression.
move_pattern = r'(    case "move": \{)(.*?)(\n      return;\n    \}\n    case "reveal": \{)'
def move_repl(match: re.Match[str]) -> str:
    body = match.group(2).replace("action.amount", "actionAmount")
    return match.group(1) + '\n      const actionAmount = Math.max(0, Math.floor(resolveNumber(action.amount)));' + body + match.group(3)
game = regex_once(game, move_pattern, move_repl, "move numeric amount", flags=re.S)
# Reveal currently has fixed single-object semantics, but any future count is resolved when the action executes.
reveal_pattern = r'(    case "reveal": \{)(.*?)(\n      return;\n    \}\n    case "reorder-deck":)'
def reveal_repl(match: re.Match[str]) -> str:
    body = match.group(2).replace("action.amount", "revealAmount")
    return match.group(1) + '\n      const revealAmount = Math.max(0, Math.floor(resolveNumber(action.amount)));' + body + match.group(3)
game = regex_once(game, reveal_pattern, reveal_repl, "reveal numeric amount", flags=re.S)
game = game.replace(
    '      const top = player.deckCards.slice(0, action.amount);',
    '      const top = player.deckCards.slice(0, Math.max(0, Math.floor(resolveNumber(action.amount))));',
)
game = game.replace(
    '      if (action.maximumCost != null && printedCost > action.maximumCost) return;',
    '      if (action.maximumCost != null && printedCost > resolveNumber(action.maximumCost)) return;',
)
game = game.replace(
    '          && (action.maximumCost == null || printedCost <= action.maximumCost);',
    '          && (action.maximumCost == null || printedCost <= resolveNumber(action.maximumCost));',
)
game = game.replace(
    '      const count = Math.max(0, Math.floor(action.count\n        ? evaluateAmountExpression(state, action.count, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : 1));',
    '      const count = Math.max(0, Math.floor(action.count == null ? 1 : resolveNumber(action.count)));',
)
# Separate attacks use a real runtime value and snapshot it into pendingDamage/log text.
attack_pattern = r'(    case "attack": \{)(.*?)(\n      throw new DamageResolutionSuspended\(\);\n    \})'
def attack_repl(match: re.Match[str]) -> str:
    body = match.group(2).replace("action.amount", "attackAmount")
    return match.group(1) + '\n      const attackAmount = Math.max(0, Math.floor(resolveNumber(action.amount)));' + body + match.group(3)
game = regex_once(game, attack_pattern, attack_repl, "attack numeric amount", flags=re.S)
# Resolution-time condition evaluation receives the same clause choices as its expressions.
game = game.replace(
    "  return ruleConditionActive(state, player, instruction.condition, conditionTarget);",
    "  return ruleConditionActive(state, player, instruction.condition, conditionTarget, choices);",
)
write(game_path, game)


# ---------------------------------------------------------------------------
# Stage 4: make the catalogue compiler emit NumberValue/BooleanExpression nodes.
# ---------------------------------------------------------------------------
primitives_path = "lib/rules/catalogue-primitives.ts"
primitives = read(primitives_path)
# Scale-based values now occupy the ordinary `amount` slot. Keep `scale` only as a fallback for grammar not yet recognized.
primitives = primitives.replace(
    '      amount: Number(match[1]),\n      scale: scaleForStat(text, match),\n      amountExpression: amountExpressionForScale(text, Number(match[1]), scaleForStat(text, match)),',
    '      amount: amountExpressionForScale(text, Number(match[1]), scaleForStat(text, match)) ?? Number(match[1]),\n      scale: amountExpressionForScale(text, Number(match[1]), scaleForStat(text, match)) ? undefined : scaleForStat(text, match),',
)
primitives = primitives.replace(
    '    actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale: frostScale, amountExpression: amountExpressionForScale(text, Number(match[1]), frostScale), duration, scope });',
    '    actions.push({ kind: "modify-stat", stat: "frost", amount: amountExpressionForScale(text, Number(match[1]), frostScale) ?? Number(match[1]), scale: amountExpressionForScale(text, Number(match[1]), frostScale) ? undefined : frostScale, duration, scope });',
)
primitives = primitives.replace(
    '      amount: fixedAmount,\n      scale,\n      amountExpression: /^x$/i.test(draw[1])\n        ? { kind: "choice-value", choiceId: "xValue" }\n        : amountExpressionForScale(text, fixedAmount, scale),',
    '      amount: /^x$/i.test(draw[1])\n        ? { kind: "choice-value", choiceId: "xValue" }\n        : amountExpressionForScale(text, fixedAmount, scale) ?? fixedAmount,\n      scale: /^x$/i.test(draw[1]) || amountExpressionForScale(text, fixedAmount, scale) ? undefined : scale,',
)
primitives = primitives.replace(
    '  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: Number(generatedEnergy[1]), scale, amountExpression: amountExpressionForScale(text, Number(generatedEnergy[1]), scale), playerScope: playerScopeForText(text) });',
    '  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: amountExpressionForScale(text, Number(generatedEnergy[1]), scale) ?? Number(generatedEnergy[1]), scale: amountExpressionForScale(text, Number(generatedEnergy[1]), scale) ? undefined : scale, playerScope: playerScopeForText(text) });',
)
# Common numeric conditions now compile to the generic boolean-expression language.
primitives = primitives.replace(
    '  if (/two or more cards this turn/i.test(text)) return { kind: "cards-played", comparison: "at-least", amount: 2 };',
    '  if (/two or more cards this turn/i.test(text)) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "cards-played", owner: "controller" }, operator: ">=", right: 2 } };',
)
primitives = primitives.replace(
    '  if (playedFactionCount) return { kind: "factions-played", comparison: "at-least", amount: numberValue(playedFactionCount[1], 1) };',
    '  if (playedFactionCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "factions-played", owner: "controller" }, operator: ">=", right: numberValue(playedFactionCount[1], 1) } };',
)
primitives = primitives.replace(
    '  if (heroCount) return { kind: "hero-count", comparison: "at-least", amount: numberValue(heroCount[1], 1) };',
    '  if (heroCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "hero", owner: "controller" }, operator: ">=", right: numberValue(heroCount[1], 1) } };',
)
primitives = primitives.replace(
    '  if (energyCount) return { kind: "energy-count", comparison: "at-least", amount: numberValue(energyCount[1], 1) };',
    '  if (energyCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "energy", owner: "controller" }, operator: ">=", right: numberValue(energyCount[1], 1) } };',
)
primitives = primitives.replace(
    '  if (discardCount) return { kind: "discard-count", comparison: "at-least", amount: numberValue(discardCount[1], 1) };',
    '  if (discardCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "discard", owner: "controller" }, operator: ">=", right: numberValue(discardCount[1], 1) } };',
)
primitives = primitives.replace(
    '  if (playedCost) return { kind: "played-card-cost", comparison: "at-least", amount: numberValue(playedCost[1], 1) };',
    '  if (playedCost) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "maximum-played-card-cost" }, operator: ">=", right: numberValue(playedCost[1], 1) } };',
)
# Replace the open-Bakugan legacy condition with a comparison expression while retaining the parser grammar.
old_open = '''    return { kind: "open-bakugan-count", comparison, amount };'''
new_open = '''    const operator = comparison === "exactly" ? "=="\n      : comparison === "at-least" ? ">="\n        : comparison === "at-most" ? "<="\n          : comparison === "more-than" ? ">"\n            : "<";\n    return { kind: "expression", expression: {\n      kind: "compare-number",\n      left: { kind: "count", source: "open-bakugan", owner: "controller" },\n      operator,\n      right: amount,\n    } };'''
primitives = primitives.replace(old_open, new_open)
write(primitives_path, primitives)

structure_path = "lib/rules/catalogue-structure.ts"
structure = read(structure_path)
# Cost reductions that scale with game state now carry their expression directly instead of a side-channel scale enum.
structure = replace_once(
    structure,
    'function reductionScaleFor(text: string): Extract<CostEffect, { kind: "cost-reduce" }>["scale"] {\n  if (/for each card you (?:have )?played this turn/i.test(text)) return "cards-played-this-turn";\n  if (/for each BakuCore that your Bakugan hold/i.test(text)) return "held-bakucore";\n  return undefined;\n}\n',
    'function reductionScaleFor(text: string): Extract<CostEffect, { kind: "cost-reduce" }>["scale"] {\n  if (/for each card you (?:have )?played this turn/i.test(text)) return "cards-played-this-turn";\n  if (/for each BakuCore that your Bakugan hold/i.test(text)) return "held-bakucore";\n  return undefined;\n}\n\nfunction reductionAmountFor(text: string, amount: number): CostEffect extends infer _ ? import("./values").NumberValue : never {\n  const scale = reductionScaleFor(text);\n  if (scale === "cards-played-this-turn") return { kind: "product", factors: [amount, { kind: "count", source: "cards-played", owner: "controller" }] };\n  if (scale === "held-bakucore") return { kind: "product", factors: [amount, { kind: "count", source: "held-bakucore", owner: "controller" }] };\n  return amount;\n}\n',
    "dynamic cost reduction helper",
)
structure = structure.replace(
    '      amount: Number(match[1]),\n      duration: "instant",\n      condition: conditionFor(text),\n      appliesTo: "self",\n      scale: reductionScaleFor(match[0]),',
    '      amount: reductionAmountFor(match[0], Number(match[1])),\n      duration: "instant",\n      condition: conditionFor(text),\n      appliesTo: "self",',
)
write(structure_path, structure)


# ---------------------------------------------------------------------------
# Stage 5: public exports and regression coverage.
# ---------------------------------------------------------------------------
index_path = "lib/rules/index.ts"
index = read(index_path)
if 'export * from "./values";' not in index:
    index = index.replace('export * from "./primitives";\n', 'export * from "./primitives";\nexport * from "./values";\n')
write(index_path, index)

test_path = ROOT / "tests/value-expressions.test.ts"
test_path.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard, type MatchState } from "../lib/game";
import { conditionFor, parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { ruleConditionActive } from "../lib/rules/modifiers";
import type { ChoiceSpec } from "../lib/rules/model";
import {
  captureNumberValue,
  evaluateBooleanValue,
  evaluateNumberValue,
  type NumberExpression,
} from "../lib/rules/values";

function stateWithPlayers(): MatchState {
  return createMatch("VALUES", "bo1", [
    makePlayer("first", "First", STARTER_DECKS[0]),
    makePlayer("second", "Second", STARTER_DECKS[1]),
  ]);
}

function instance(card: GameCard, id: string): GameCard {
  return { ...card, id };
}

test("number expressions compose arithmetic, counts, choice values and clamps", () => {
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  const expression: NumberExpression = {
    kind: "clamp",
    minimum: 0,
    maximum: 1000,
    value: {
      kind: "subtract",
      left: {
        kind: "product",
        factors: [100, { kind: "count", source: "hero", owner: "controller" }],
      },
      right: { kind: "choice-value", choiceId: "xValue" },
    },
  };
  assert.equal(evaluateNumberValue(state, expression, { controllerId: "first", choices: { xValue: 25 } }), 175);
  assert.equal(evaluateNumberValue(state, { kind: "divide", numerator: 9, denominator: 2 }, { controllerId: "first" }), 4.5);
  assert.equal(evaluateNumberValue(state, { kind: "divide", numerator: 9, denominator: 0 }, { controllerId: "first" }), 0);
});

test("entity properties and boolean comparisons can compare two live players", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 3;
  state.players[1].cardsPlayedThisTurn = 1;
  assert.equal(evaluateBooleanValue(state, {
    kind: "compare-number",
    left: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "cards-played" },
    operator: ">",
    right: { kind: "property", subject: { kind: "player", owner: "opponent" }, property: "cards-played" },
  }, { controllerId: "first" }), true);
});

test("generic expression conditions run through ruleConditionActive", () => {
  const state = stateWithPlayers();
  state.players[0].discard = [instance(CARDS[0], "discard-a"), instance(CARDS[1], "discard-b")];
  assert.equal(ruleConditionActive(state, state.players[0], {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "discard", owner: "controller" },
      operator: ">=",
      right: 2,
    },
  }), true);
});

test("choice minimum and maximum values are evaluated from the current game state", () => {
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  state.players[0].hand = [instance(CARDS[0], "hand-a"), instance(CARDS[1], "hand-b"), instance(CARDS[2], "hand-c")];
  const source = instance(CARDS[3], "source");
  const spec: ChoiceSpec = {
    id: "handCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Choose up to one card for each Hero",
    chooser: "controller",
    owner: "controller",
    optional: true,
    minimum: 0,
    maximum: { kind: "count", source: "hero", owner: "controller" },
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.fields[0].minimum, 0);
  assert.equal(schema.fields[0].maximum, 2);
});

test("captured expressions freeze at their requested timing boundary", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 2;
  const value: NumberExpression = {
    kind: "captured",
    key: "played-at-announce",
    at: "announce",
    value: { kind: "count", source: "cards-played", owner: "controller" },
  };
  const snapshots = captureNumberValue(state, value, { controllerId: "first", moment: "announce" });
  state.players[0].cardsPlayedThisTurn = 5;
  assert.equal(evaluateNumberValue(state, value, { controllerId: "first", moment: "resolve", capturedValues: snapshots }), 2);
});

test("catalogue compiler emits dynamic values in ordinary numeric action slots", () => {
  const base = CARDS[0];
  const card = { ...base, effect: "+100 [B] for each Hero you have in play." };
  const action = parseAtomicEffects(card, card.effect).find((candidate) => candidate.kind === "modify-stat");
  assert.ok(action && action.kind === "modify-stat");
  assert.equal(typeof action.amount, "object");
  assert.equal(action.amountExpression, undefined);

  const state = stateWithPlayers();
  const hero = CARDS.find((candidate) => candidate.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-scale")];
  assert.equal(evaluateNumberValue(state, action.amount, { controllerId: "first" }), 100);
});

test("catalogue count conditions compile to generic boolean expressions", () => {
  const condition = conditionFor("If you have two or more Hero cards in play, draw a card.");
  assert.equal(condition.kind, "expression");
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  assert.equal(ruleConditionActive(state, state.players[0], condition), true);
});
''')

print("Generalized value-expression stages applied.")
