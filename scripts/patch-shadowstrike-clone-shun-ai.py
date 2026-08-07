from pathlib import Path
import re


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"Missing patch anchor: {label}")
    return source.replace(old, new, 1)


# 1) Compile both "each other card" and "every other card" to the same semantic scale.
path = Path("lib/rules/catalogue-primitives.ts")
source = path.read_text()
source = replace_once(
    source,
    '  if (/for each other card .*played this turn/i.test(text)) return "other-card-played";',
    '  if (/for (?:each|every) other card\\b.*\\bplayed this turn/i.test(text)) return "other-card-played";',
    "other-card semantic scale",
)
path.write_text(source)


# 2) Preserve temporary card modifier identity so ShadowStrike can suppress reductions individually.
path = Path("lib/game.ts")
source = path.read_text()
source = replace_once(
    source,
    'import { ensureRulesState, isRuleObject, normalizeRuleObjects } from "./rules/state";',
    'import { ensureRulesState, isRuleObject, normalizeRuleObjects } from "./rules/state";\nimport type { ContinuousModifier, RulesCardId } from "./rules/model";',
    "rules model import",
)

scale_pattern = re.compile(
    r'''const scaleStat = \(state: MatchState, player: PlayerState, text: string, value: number, stat: "power" \| "damage" \| "frost" \| "draw"\) => \{(?P<body>.*?)\n\};''',
    re.S,
)
match = scale_pattern.search(source)
if not match:
    raise SystemExit("Missing patch anchor: scaleStat")
old_scale = match.group(0)
new_scale = old_scale.replace(
    'const scaleStat = (state: MatchState, player: PlayerState, text: string, value: number, stat: "power" | "damage" | "frost" | "draw") => {',
    'const scaleStat = (state: MatchState, player: PlayerState, text: string, value: number, stat: "power" | "damage" | "frost" | "draw", scale?: string) => {\n  if (scale === "other-card-played") return value * Math.max(0, player.cardsPlayedThisTurn - 1);',
)
new_scale = new_scale.replace(
    'if (/for every other card you played this turn/i.test(text)) return value * Math.max(1, player.cardsPlayedThisTurn - 1);',
    'if (/for (?:each|every) other card (?:you have )?played this turn/i.test(text)) return value * Math.max(0, player.cardsPlayedThisTurn - 1);',
)
if new_scale == old_scale:
    raise SystemExit("scaleStat patch did not change source")
source = source[:match.start()] + new_scale + source[match.end():]

helper_anchor = 'const executeRuleAction = (\n'
helper_index = source.index(helper_anchor)
helper = r'''function recordTemporaryCardStatModifier(
  state: MatchState,
  pending: PendingEffect,
  action: Extract<RuleAction, { kind: "modify-stat" }>,
  targetBakuganId: string,
  amount: number,
  instructionIndex: number,
  actionIndex: number,
) {
  const rules = ensureRulesState(state);
  const id = `${pending.id}:legacy-mirror:${instructionIndex}:${actionIndex}:${targetBakuganId}:${action.stat}`;
  const base = {
    id,
    source: {
      kind: "card" as const,
      instanceId: pending.sourceId ?? pending.card.id,
      catalogId: pending.card.catalogId as RulesCardId,
    },
    controllerId: pending.controllerId,
    target: "chosen-bakugan" as const,
    targetBakuganId,
    amount,
    layer: "temporary" as const,
    duration: "turn" as const,
    createdTurn: state.turn,
    sourceCategory: "card" as const,
  };
  const modifier: ContinuousModifier = action.stat === "frost"
    ? { ...base, keyword: "FrostStrike" }
    : { ...base, stat: action.stat };
  rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== id);
  rules.modifiers.push(modifier);
}

'''
source = source[:helper_index] + helper + source[helper_index:]

source = replace_once(
    source,
    '  instructionIndex: number,\n) => {',
    '  instructionIndex: number,\n  actionIndex: number,\n) => {',
    "executeRuleAction action index",
)
source = replace_once(
    source,
    '      let amount = scaleStat(state, player, text, action.amount, action.stat);',
    '      let amount = scaleStat(state, player, text, action.amount, action.stat, action.scale);',
    "modify-stat semantic scaling",
)
old_loop = '''      for (const selected of targets) {
        if (action.stat === "power") state.powerBoost[selected.id] = (state.powerBoost[selected.id] ?? 0) + amount;
        else if (action.stat === "damage") state.damageBoost[selected.id] = (state.damageBoost[selected.id] ?? 0) + amount;
        else state.frostStrike[selected.id] = (state.frostStrike[selected.id] ?? 0) + amount;
      }
'''
new_loop = '''      for (const selected of targets) {
        // Keep the legacy aggregate maps for snapshot/UI compatibility, but
        // also retain each card modifier as an independently filterable rules
        // object. The modifier evaluator subtracts these mirrored entries from
        // the aggregate before applying them, so positive and negative effects
        // never collapse into a single number for ShadowStrike.
        if (action.stat === "power") state.powerBoost[selected.id] = (state.powerBoost[selected.id] ?? 0) + amount;
        else if (action.stat === "damage") state.damageBoost[selected.id] = (state.damageBoost[selected.id] ?? 0) + amount;
        else state.frostStrike[selected.id] = (state.frostStrike[selected.id] ?? 0) + amount;
        recordTemporaryCardStatModifier(
          state,
          pending,
          action,
          selected.id,
          amount,
          instructionIndex,
          actionIndex,
        );
      }
'''
source = replace_once(source, old_loop, new_loop, "temporary card modifier ledger")
source = replace_once(
    source,
    'const amount = action.scale ? Math.max(0, scaleStat(state, player, text, action.amount, "draw")) : action.amount;',
    'const amount = action.scale ? Math.max(0, scaleStat(state, player, text, action.amount, "draw", action.scale)) : action.amount;',
    "draw semantic scaling",
)
source = replace_once(
    source,
    'executeRuleAction(state, pending, instruction, action, cursor.instructionIndex);',
    'executeRuleAction(state, pending, instruction, action, cursor.instructionIndex, cursor.effectIndex);',
    "executor cursor index",
)
path.write_text(source)


# 3) De-duplicate mirrored legacy aggregates inside the characteristic layer.
path = Path("lib/rules/modifiers.ts")
source = path.read_text()
old_block = '''  const temporary: ContinuousModifier[] = [
    { id: `${bakugan.id}:legacy-power`, source: { kind: "system", id: "temporary-power" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "power", amount: state.powerBoost[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-damage`, source: { kind: "system", id: "temporary-damage" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "damage", amount: state.damageBoost[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-frost`, source: { kind: "system", id: "temporary-frost" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, keyword: "FrostStrike", amount: state.frostStrike[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
  ];

  const storedModifiers = ensureRulesState(state).modifiers.filter((modifier) => !(
    modifier.duration === "while-source-active" && modifier.source.kind === "card"
  ));
'''
new_block = '''  const storedModifiers = ensureRulesState(state).modifiers.filter((modifier) => !(
    modifier.duration === "while-source-active" && modifier.source.kind === "card"
  ));
  const mirrored = storedModifiers.filter((modifier) => (
    modifier.id.includes(":legacy-mirror:") && modifier.targetBakuganId === bakugan.id
  ));
  const mirroredPower = mirrored.reduce((sum, modifier) => (
    sum + (modifier.stat === "power" ? modifier.amount : 0)
  ), 0);
  const mirroredDamage = mirrored.reduce((sum, modifier) => (
    sum + (modifier.stat === "damage" ? modifier.amount : 0)
  ), 0);
  const mirroredFrost = mirrored.reduce((sum, modifier) => (
    sum + (modifier.keyword === "FrostStrike" ? modifier.amount : 0)
  ), 0);
  const temporary: ContinuousModifier[] = [
    { id: `${bakugan.id}:legacy-power`, source: { kind: "system", id: "temporary-power" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "power", amount: (state.powerBoost[bakugan.id] ?? 0) - mirroredPower, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-damage`, source: { kind: "system", id: "temporary-damage" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "damage", amount: (state.damageBoost[bakugan.id] ?? 0) - mirroredDamage, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-frost`, source: { kind: "system", id: "temporary-frost" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, keyword: "FrostStrike", amount: (state.frostStrike[bakugan.id] ?? 0) - mirroredFrost, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
  ];
'''
source = replace_once(source, old_block, new_block, "legacy mirror de-duplication")
path.write_text(source)


# 4) Trigger relationships are relationships to the event actor, not to whoever
# happened to control/create the event object.
path = Path("lib/rules/triggers.ts")
source = path.read_text()
source = replace_once(
    source,
    '''function relationshipMatches(trigger: TriggerDefinition, ownerId: string, event: RuleEvent) {
  if (trigger.relationship === "any") return true;
  if (trigger.relationship === "controller") return event.actorId === ownerId || event.controllerId === ownerId;
  return event.actorId !== ownerId && event.controllerId !== ownerId;
}
''',
    '''function relationshipMatches(trigger: TriggerDefinition, ownerId: string, event: RuleEvent) {
  if (trigger.relationship === "any") return true;
  if (trigger.relationship === "controller") return event.actorId === ownerId;
  return event.actorId !== ownerId;
}
''',
    "trigger actor relationship",
)
path.write_text(source)


# 5) Base AI: value card reductions at zero when ShadowStrike prevents them,
# and avoid explicitly selecting a protected Bakugan when alternatives exist.
path = Path("lib/opponentAiBase.ts")
source = path.read_text()
anchor = '''function combatRelevance(
'''
index = source.index(anchor)
helpers = r'''function bakuganOwner(match: MatchState, bakuganId: string) {
  return match.players.find((player) => player.bakugan.some((candidate) => candidate.id === bakuganId));
}

function bakuganHasShadowStrike(match: MatchState, bakuganId: string) {
  const owner = bakuganOwner(match, bakuganId);
  const bakugan = owner?.bakugan.find((candidate) => candidate.id === bakuganId);
  return Boolean(owner && bakugan
    && evaluateBakuganCharacteristics(match, bakugan, owner).shadowStrike);
}

function implicitActionTargetId(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  sourceText: string,
) {
  if (action.kind === "modify-stat" && action.targetChoiceId) {
    const selected = choices[action.targetChoiceId];
    if (typeof selected === "string") return selected;
  }
  if (choices.targetBakuganId) return choices.targetBakuganId;
  const targetPlayer = actionTargetsEnemy(match, playerId, choices, action, sourceText)
    ? opponentOf(match, playerId)
    : playerById(match, playerId);
  return targetPlayer?.bakugan.find((bakugan) => bakugan.id === match.selected[targetPlayer.id])?.id
    ?? targetPlayer?.bakugan.find((bakugan) => bakugan.open)?.id
    ?? targetPlayer?.bakugan[0]?.id;
}

function shadowStrikeBlocksReduction(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  sourceText: string,
) {
  if (action.kind !== "modify-stat" || action.amount >= 0
    || (action.stat !== "power" && action.stat !== "damage")) return false;
  const targetId = implicitActionTargetId(match, playerId, choices, action, sourceText);
  return Boolean(targetId && bakuganHasShadowStrike(match, targetId));
}

function cardHasReduciveStatEffect(card: GameCard) {
  return cardLeafActions(card).some((action) => (
    action.kind === "modify-stat"
    && action.amount < 0
    && (action.stat === "power" || action.stat === "damage")
  ));
}

'''
source = source[:index] + helpers + source[index:]

source = replace_once(
    source,
    '''      const strategic = raw * (targetsEnemy ? -1 : 1);
      value += strategic * combatRelevance(match, playerId, action, targetsEnemy) - raw;
''',
    '''      const blocked = shadowStrikeBlocksReduction(
        match,
        playerId,
        choices,
        action,
        instruction.sourceText,
      );
      const strategic = blocked ? 0 : raw * (targetsEnemy ? -1 : 1);
      value += strategic * combatRelevance(match, playerId, action, targetsEnemy) - raw;
''',
    "cardValue ShadowStrike reduction",
)

source = replace_once(
    source,
    '''      value += raw * (targetsEnemy ? -1 : 1)
        * combatRelevance(match, playerId, action, targetsEnemy);
''',
    '''      const blocked = shadowStrikeBlocksReduction(
        match,
        playerId,
        {},
        action,
        actionText,
      );
      value += (blocked ? 0 : raw * (targetsEnemy ? -1 : 1))
        * combatRelevance(match, playerId, action, targetsEnemy);
''',
    "optional effect ShadowStrike reduction",
)

source = replace_once(
    source,
    '''    if (!bakugan) return -100;
    const strength = printedBakuganValue(bakugan) + bakugan.heldCoreCells.length * 1.2;
    return objectUtilityForChooser(owner?.id, chooserId, polarity, strength);
''',
    '''    if (!bakugan) return -100;
    if (owner?.id !== controllerId
      && cardHasReduciveStatEffect(card)
      && bakuganHasShadowStrike(match, bakugan.id)) return -100;
    const strength = printedBakuganValue(bakugan) + bakugan.heldCoreCells.length * 1.2;
    return objectUtilityForChooser(owner?.id, chooserId, polarity, strength);
''',
    "AI target selection ShadowStrike",
)
path.write_text(source)


# 6) High-level combat policy: project ShadowStrike correctly and choose a
# minimum-resource sufficient B-Power plan instead of leaving every winning
# overkill option available to the base scorer.
path = Path("lib/opponentAi.ts")
source = path.read_text()
source = replace_once(
    source,
    'import { bestAiRollTarget } from "./aiRollForecast";',
    'import { bestAiRollTarget } from "./aiRollForecast";\nimport { cardEnergyPaymentState } from "./cardPayment";\nimport { evaluateBakuganCharacteristics } from "./rules/modifiers";',
    "AI rules imports",
)

old_restore_start = source.index('function restoreShadowStrikePenalty(')
old_restore_end = source.index('\nfunction applyProjectedAction(', old_restore_start)
new_restore = r'''function bakuganHasShadowStrike(match: MatchState, bakuganId: string) {
  const owner = match.players.find((player) => player.bakugan.some((candidate) => candidate.id === bakuganId));
  const bakugan = owner?.bakugan.find((candidate) => candidate.id === bakuganId);
  return Boolean(owner && bakugan
    && evaluateBakuganCharacteristics(match, bakugan, owner).shadowStrike);
}

function activeTargetBakugan(match: MatchState, playerId: string, targetsEnemy: boolean) {
  const targetPlayer = targetsEnemy ? opponentOf(match, playerId) : playerById(match, playerId);
  if (!targetPlayer) return undefined;
  return targetPlayer.bakugan.find((bakugan) => bakugan.id === match.selected[targetPlayer.id])
    ?? targetPlayer.bakugan.find((bakugan) => bakugan.open)
    ?? targetPlayer.bakugan[0];
}

function projectShadowStrikeGain(
  match: MatchState,
  playerId: string,
  targetsEnemy: boolean,
  power: { own: number; enemy: number },
  damage: { own: number; enemy: number },
) {
  const targetPlayer = targetsEnemy ? opponentOf(match, playerId) : playerById(match, playerId);
  const target = activeTargetBakugan(match, playerId, targetsEnemy);
  if (!targetPlayer || !target) return;
  const projected = cloneMatch(match);
  projected.shadowStrike[target.id] = true;
  if (targetsEnemy) {
    power.enemy = totalPower(projected, targetPlayer.id);
    damage.enemy = totalDamage(projected, targetPlayer.id);
  } else {
    power.own = totalPower(projected, targetPlayer.id);
    damage.own = totalDamage(projected, targetPlayer.id);
  }
}
'''
source = source[:old_restore_start] + new_restore + source[old_restore_end:]

source = replace_once(
    source,
    '''  if (action.kind === "modify-stat") {
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy += action.amount;
      else power.own += action.amount;
    } else if (action.stat === "damage") {
      if (targetsEnemy) damage.enemy += action.amount;
      else damage.own += action.amount;
    }
    return;
  }
''',
    '''  if (action.kind === "modify-stat") {
    const target = activeTargetBakugan(match, playerId, targetsEnemy);
    const prevented = action.amount < 0
      && (action.stat === "power" || action.stat === "damage")
      && Boolean(target && bakuganHasShadowStrike(match, target.id));
    if (prevented) return;
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy += action.amount;
      else power.own += action.amount;
    } else if (action.stat === "damage") {
      if (targetsEnemy) damage.enemy += action.amount;
      else damage.own += action.amount;
    }
    return;
  }
''',
    "projected modify-stat ShadowStrike",
)
source = replace_once(
    source,
    '''  if (action.kind === "set-stat") {
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy = action.value;
      else power.own = action.value;
    } else {
      if (targetsEnemy) damage.enemy = action.value;
      else damage.own = action.value;
    }
    return;
  }
''',
    '''  if (action.kind === "set-stat") {
    const target = activeTargetBakugan(match, playerId, targetsEnemy);
    const current = action.stat === "power"
      ? (targetsEnemy ? power.enemy : power.own)
      : (targetsEnemy ? damage.enemy : damage.own);
    if (action.value < current && target && bakuganHasShadowStrike(match, target.id)) return;
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy = action.value;
      else power.own = action.value;
    } else {
      if (targetsEnemy) damage.enemy = action.value;
      else damage.own = action.value;
    }
    return;
  }
''',
    "projected set-stat ShadowStrike",
)
source = replace_once(
    source,
    '    restoreShadowStrikePenalty(match, playerId, targetsEnemy, power, damage);',
    '    projectShadowStrikeGain(match, playerId, targetsEnemy, power, damage);',
    "projected ShadowStrike gain",
)

# Restrict the optimization plan to effects whose only payoff is changing B-Power.
insert_at = source.index('type TemporaryPowerCandidate = {')
pure_power_helper = r'''function pureTemporaryPowerProgram(card: GameCard) {
  const actions = cardLeafActions(card);
  return actions.length > 0 && actions.every((action) => (
    isTemporaryCombatAction(action)
    && (
      (action.kind === "modify-stat" && action.stat === "power")
      || (action.kind === "set-stat" && action.stat === "power")
    )
  ));
}

'''
source = source[:insert_at] + pure_power_helper + source[insert_at:]

source = replace_once(
    source,
    '''    if (action.kind === "modify-stat" && action.stat === "power") {
      swing += targetsEnemy ? -action.amount : action.amount;
''',
    '''    if (action.kind === "modify-stat" && action.stat === "power") {
      const target = activeTargetBakugan(match, playerId, targetsEnemy);
      if (action.amount < 0 && target && bakuganHasShadowStrike(match, target.id)) continue;
      swing += targetsEnemy ? -action.amount : action.amount;
''',
    "power swing ShadowStrike",
)

start = source.index('function jointlyWinningTemporaryPowerCards(')
end = source.index('\nfunction advanceWithCombatPolicy(', start)
replacement = r'''function minimumWinningTemporaryPowerCards(
  match: MatchState,
  playerId: string,
) {
  const result = new Set<string>();
  if (match.phase !== "power" || match.victorByDamage) return result;
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  if (!player || !opponent) return result;
  if (!participatesInBrawl(match, playerId) || !participatesInBrawl(match, opponent.id)) {
    return result;
  }
  const deficit = totalPower(match, opponent.id) - totalPower(match, playerId);
  if (deficit < 0) return result;
  const budget = currentEnergyCapacity(match, playerId);
  if (budget <= 0) return result;

  const candidates: TemporaryPowerCandidate[] = player.hand
    .filter((card) => pureTemporaryPowerProgram(card))
    .map((card) => {
      const choices = chooseBaseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      return {
        card,
        cost: payment?.kind === "insufficient" ? budget + 1 : payment?.cost ?? budget + 1,
        swing: temporaryPowerSwing(match, playerId, card),
      };
    })
    .filter((candidate) => candidate.swing > 0 && candidate.cost <= budget)
    .sort((a, b) => (
      a.cost - b.cost
      || a.swing - b.swing
      || a.card.id.localeCompare(b.card.id)
    ))
    .slice(0, 12);
  if (!candidates.length) return result;

  type Combination = { ids: string[]; cost: number; swing: number };
  const combinations: Combination[] = [{ ids: [], cost: 0, swing: 0 }];
  for (const candidate of candidates) {
    const existing = [...combinations];
    for (const combination of existing) {
      const next = {
        ids: [...combination.ids, candidate.card.id],
        cost: combination.cost + candidate.cost,
        swing: combination.swing + candidate.swing,
      };
      if (next.cost <= budget) combinations.push(next);
    }
  }

  let best: Combination | undefined;
  for (const combination of combinations) {
    if (!combination.ids.length || combination.swing <= deficit) continue;
    const overshoot = combination.swing - deficit;
    const bestOvershoot = best ? best.swing - deficit : Number.POSITIVE_INFINITY;
    if (
      !best
      || combination.cost < best.cost
      || (combination.cost === best.cost && combination.ids.length < best.ids.length)
      || (combination.cost === best.cost && combination.ids.length === best.ids.length && overshoot < bestOvershoot)
    ) best = combination;
  }
  for (const id of best?.ids ?? []) result.add(id);
  return result;
}
'''
source = source[:start] + replacement + source[end:]

source = replace_once(
    source,
    '''  const winningPowerCombo = jointlyWinningTemporaryPowerCards(input, playerId);
  const suppressed = new Set(
    player.hand
      .filter((card) => (
        (input.phase !== "preRoll"
&& !winningPowerCombo.has(card.id)
&& shouldSuppressTemporaryCombatCard(input, playerId, card))
        || shouldReserveDrawRerollCard(input, card)
      ))
      .map((card) => card.id),
  );
''',
    '''  const winningPowerPlan = minimumWinningTemporaryPowerCards(input, playerId);
  const suppressed = new Set(
    player.hand
      .filter((card) => {
        const unneededPowerAlternative = input.phase === "power"
          && winningPowerPlan.size > 0
          && pureTemporaryPowerProgram(card)
          && !winningPowerPlan.has(card.id);
        const tacticallySuppressed = input.phase !== "preRoll"
          && !winningPowerPlan.has(card.id)
          && shouldSuppressTemporaryCombatCard(input, playerId, card);
        return unneededPowerAlternative || tacticallySuppressed || shouldReserveDrawRerollCard(input, card);
      })
      .map((card) => card.id),
  );
''',
    "minimum winning power plan",
)
path.write_text(source)


# 7) Focused conformance tests.
path = Path("tests/rules-shadowstrike-clone-shun.test.ts")
path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  emitGameEvent,
  passPriority,
  playCard,
  totalDamage,
  totalPower,
  type Bakugan,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";

let serial = 0;
function card(catalogId: string, id = `${catalogId}-${++serial}`): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing ${catalogId}`);
  return { ...source, id };
}

function bakugan(id: string, faction: Faction, bPower = 500, damage = 5): Bakugan {
  const source = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);
  assert.ok(source);
  const character = { ...source, id: `${id}-character`, bPower, damage };
  return {
    id,
    name: id,
    faction,
    bPower,
    damage,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character,
    open: true,
    heldCoreCells: [],
    evoStack: [],
  };
}

function player(id: string, active: Bakugan, hand: GameCard[] = []): PlayerState {
  return {
    id,
    name: id,
    bakugan: [active],
    cores: [],
    deck: 0,
    deckCards: [],
    hand,
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    maxEnergy: 0,
    ready: true,
    connected: true,
    lastSeen: Date.now(),
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
  };
}

function addEnergy(owner: PlayerState, amount: number) {
  owner.energyZone = Array.from({ length: amount }, (_, index) => card("bb-10", `${owner.id}-energy-${index}`));
  owner.maxEnergy = amount;
}

function roll(playerId: string, bakuganId: string): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result: "open-no-core",
    cores: [],
    accuracyRoll: 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 100,
    doubleCore: false,
    path: [],
    note: "test",
  };
}

function matchWith(a: PlayerState, b: PlayerState): MatchState {
  const match = createMatch("RULE-REGRESSION", "bo1", [a, b]);
  match.turn = 3;
  match.phase = "power";
  match.startingPlayer = a.id;
  match.initialStartingPlayer = a.id;
  match.priority = a.id;
  match.selected[a.id] = a.bakugan[0].id;
  match.selected[b.id] = b.bakugan[0].id;
  match.rolls[a.id] = roll(a.id, a.bakugan[0].id);
  match.rolls[b.id] = roll(b.id, b.bakugan[0].id);
  return match;
}

function resolveSimpleCard(state: MatchState, controllerId: string, opponentId: string, cardId: string) {
  let next = playCard(state, controllerId, cardId);
  next = passPriority(next, controllerId);
  next = passPriority(next, opponentId);
  return next;
}

test("ShadowStrike filters each negative card modifier without reducing positive modifiers", () => {
  const positive = card("bb-42", "positive-prismatic-bolt"); // +300 B, +6 Damage.
  const negative = card("br-58", "negative-ventus-shield"); // -200 B, -2 Damage.
  const protectedBakugan = bakugan("protected", "Darkus", 500, 5);
  const defender = player("defender", protectedBakugan, [positive]);
  const attacker = player("attacker", bakugan("attacker-b", "Ventus", 500, 5), [negative]);
  addEnergy(defender, 4);
  addEnergy(attacker, 2);
  let state = matchWith(defender, attacker);
  state.shadowStrike[protectedBakugan.id] = true;

  state = resolveSimpleCard(state, defender.id, attacker.id, positive.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);

  state.priority = attacker.id;
  state = resolveSimpleCard(state, attacker.id, defender.id, negative.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);
  const evaluated = evaluateBakuganCharacteristics(state, state.players[0].bakugan[0], state.players[0]);
  assert.ok(evaluated.applied.some((modifier) => modifier.amount === 300 && modifier.stat === "power"));
  assert.ok(evaluated.applied.some((modifier) => modifier.amount === 6 && modifier.stat === "damage"));
  assert.ok(evaluated.prevented.some((modifier) => modifier.amount === -200 && modifier.stat === "power"));
  assert.ok(evaluated.prevented.some((modifier) => modifier.amount === -2 && modifier.stat === "damage"));
});

test("Clone Army FrostStrike equals the number of other cards played this turn", () => {
  for (const otherCards of [0, 1, 3]) {
    const cloneArmy = card("aa-3", `clone-army-${otherCards}`);
    const ai = player(`ai-${otherCards}`, bakugan(`ai-b-${otherCards}`, "Aquos"), [cloneArmy]);
    const human = player(`human-${otherCards}`, bakugan(`human-b-${otherCards}`, "Pyrus"));
    addEnergy(ai, 2);
    ai.cardsPlayedThisTurn = otherCards;
    ai.deckCards = [card("bb-10", `draw-filler-${otherCards}`)];
    ai.deck = 1;
    let state = matchWith(ai, human);
    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
    const currentBakugan = currentAi.bakugan[0];
    const evaluated = evaluateBakuganCharacteristics(state, currentBakugan, currentAi);
    assert.equal(evaluated.frostStrike, otherCards, `expected ${otherCards} FrostStrike after ${otherCards} other cards`);
  }
});

test("controller-open triggers ignore the opponent opening", () => {
  const controllerTriggerIds = ["br-77", "br-78", "br-79", "bb-207", "bb-209", "bb-215"];
  for (const catalogId of controllerTriggerIds) {
    const owner = player(`owner-${catalogId}`, bakugan(`owner-b-${catalogId}`, "Aquos"));
    const opponent = player(`opponent-${catalogId}`, bakugan(`opponent-b-${catalogId}`, "Pyrus"));
    owner.heroes = [card(catalogId, `hero-${catalogId}`)];
    const match = matchWith(owner, opponent);

    const opponentTriggers = emitGameEvent(match, {
      id: `opponent-open-${catalogId}`,
      type: "open",
      playerId: opponent.id,
      playerIds: [opponent.id],
      targetBakuganId: opponent.bakugan[0].id,
    });
    assert.equal(opponentTriggers.some((trigger) => trigger.card.catalogId === catalogId), false, `${catalogId} triggered on opponent open`);

    const ownMatch = matchWith(owner, opponent);
    ownMatch.players[0].heroes = [card(catalogId, `own-hero-${catalogId}`)];
    const ownTriggers = emitGameEvent(ownMatch, {
      id: `owner-open-${catalogId}`,
      type: "open",
      playerId: owner.id,
      playerIds: [owner.id],
      targetBakuganId: owner.bakugan[0].id,
    });
    assert.equal(ownTriggers.some((trigger) => trigger.card.catalogId === catalogId), true, `${catalogId} did not trigger on controller open`);
  }
});
''')

# Append focused AI tests to the existing tactics suite.
path = Path("tests/opponent-ai-tactics.test.ts")
tests = path.read_text()
if 'AI chooses the minimum-resource sufficient B-Power card' not in tests:
    tests += r'''

test("AI chooses the minimum-resource sufficient B-Power card", () => {
  const efficient = catalogueCard("bb-43", "efficient-prismatic-shield"); // +200 B, 1 Energy.
  const overkill = catalogueCard("bb-49", "overkill-smoke-armor"); // +500 B, 3 Energy.
  const ai = player("efficient-ai", [bakugan("efficient-ai-b", "Aquos", 500, 5)], [], [efficient, overkill]);
  const human = player("efficient-human", [bakugan("efficient-human-b", "Pyrus", 650, 5)]);
  addEnergy(ai, 3);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, efficient.id);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === overkill.id), true);
});

test("AI does not spend a debuff whose B-Power reduction is blocked by ShadowStrike", () => {
  const debuff = catalogueCard("aa-45", "shadowstrike-wild-roar"); // -300 B.
  const ai = player("shadow-ai", [bakugan("shadow-ai-b", "Ventus", 500, 5)], [], [debuff]);
  const human = player("shadow-human", [bakugan("shadow-human-b", "Darkus", 700, 5)]);
  addEnergy(ai, 1);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);
  match.shadowStrike[human.bakugan[0].id] = true;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === debuff.id), true);
});
'''
path.write_text(tests)
