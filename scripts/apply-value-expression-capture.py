from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str, label: str):
    file = ROOT / path
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f"{label}: expected text was not found")
    file.write_text(text.replace(old, new, 1))


# Model: persistent continuous modifiers need the choices and snapshots that
# created them so explicitly captured values remain frozen while live values
# keep evaluating continuously.
patch(
    "lib/rules/model.ts",
    '  sourceCategory?: "card" | "bakucore" | "temporary" | "continuous" | "base-rule";\n};',
    '  sourceCategory?: "card" | "bakucore" | "temporary" | "continuous" | "base-rule";\n  choices?: CardChoices;\n  valueSnapshots?: Record<string, number>;\n};',
    "continuous modifier snapshots",
)

# Costs: card-local expressions need the same snapshot map as the card-play
# request. Dynamic conditions also need the declaration/payment choices.
patch(
    "lib/rules/costs.ts",
    '  selectedAlternativeId?: string;\n};',
    '  selectedAlternativeId?: string;\n  /** Captured announce/pay values from the shared card-play transaction. */\n  capturedValues?: Record<string, number>;\n};',
    "cost context snapshots",
)
patch(
    "lib/rules/costs.ts",
    'function modifierActive(state: MatchState, player: PlayerState, modifier: CostEffect) {\n  return !("condition" in modifier) || ruleConditionActive(state, player, modifier.condition);\n}',
    'function modifierActive(state: MatchState, player: PlayerState, modifier: CostEffect, choices: CardChoices = {}) {\n  return !("condition" in modifier) || ruleConditionActive(state, player, modifier.condition, undefined, choices);\n}',
    "cost condition choices",
)
patch(
    "lib/rules/costs.ts",
    '    if (!modifierActive(state, player, modifier)) continue;',
    '    if (!modifierActive(state, player, modifier, choices)) continue;',
    "self cost condition choices",
)
# Replace all self/controlled modifier value calls in the card-local loop.
for old, new, label in [
    ('costValue(state, playerId, modifier.amount, choices) * variableMultiplier', 'costValue(state, playerId, modifier.amount, choices, context.capturedValues) * variableMultiplier', 'reduction snapshots'),
    ('costValue(state, playerId, modifier.amount, choices);', 'costValue(state, playerId, modifier.amount, choices, context.capturedValues);', 'increase snapshots'),
    ('costValue(state, playerId, modifier.amount, choices)))', 'costValue(state, playerId, modifier.amount, choices, context.capturedValues)))', 'discard snapshots'),
    ('costValue(state, playerId, component.amount, choices)))', 'costValue(state, playerId, component.amount, choices, context.capturedValues)))', 'alternative snapshots'),
]:
    patch("lib/rules/costs.ts", old, new, label)
patch(
    "lib/rules/costs.ts",
    '  context: Pick<CardCostContext, "forcedFreeBase"> = {},',
    '  context: Pick<CardCostContext, "forcedFreeBase" | "capturedValues"> = {},',
    "payment mode context",
)
patch(
    "lib/rules/costs.ts",
    '    const breakdown = cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true });',
    '    const breakdown = cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true, capturedValues: context.capturedValues });',
    "forced free snapshots",
)
patch(
    "lib/rules/costs.ts",
    '  const normal = cardCostBreakdown(state, playerId, card, { ...choices, paymentMode: "normal" });',
    '  const normal = cardCostBreakdown(state, playerId, card, { ...choices, paymentMode: "normal" }, { capturedValues: context.capturedValues });',
    "normal payment snapshots",
)
patch(
    "lib/rules/costs.ts",
    '    modifier.kind === "cost-alternative" && modifierActive(state, player, modifier)',
    '    modifier.kind === "cost-alternative" && modifierActive(state, player, modifier, choices)',
    "alternative condition choices",
)
patch(
    "lib/rules/costs.ts",
    '    const breakdown = cardCostBreakdown(state, playerId, card, alternativeChoices, { selectedAlternativeId: alternative.id });',
    '    const breakdown = cardCostBreakdown(state, playerId, card, alternativeChoices, { selectedAlternativeId: alternative.id, capturedValues: context.capturedValues });',
    "alternative payment snapshots",
)

# Continuous modifiers: live expressions stay live, while `captured` nodes read
# the stored snapshot map from the modifier that created them.
patch(
    "lib/rules/modifiers.ts",
    '    choices: { targetBakuganId: bakugan.id },\n    sourceBakuganId: modifier.source.kind === "bakugan" ? modifier.source.id : undefined,\n    sourceCardId: "instanceId" in modifier.source ? modifier.source.instanceId : undefined,\n    moment: "continuous",\n  });',
    '    choices: { ...(modifier.choices ?? {}), targetBakuganId: bakugan.id },\n    sourceBakuganId: modifier.source.kind === "bakugan" ? modifier.source.id : modifier.choices?.sourceBakuganId,\n    sourceCardId: "instanceId" in modifier.source ? modifier.source.instanceId : undefined,\n    moment: "continuous",\n    capturedValues: modifier.valueSnapshots,\n  });',
    "continuous snapshot evaluation",
)

# Triggers: `event` is a real evaluation boundary. Snapshot every event-captured
# number inside the trigger's instruction program when the trigger object is
# created, before the event can disappear or game state can change.
patch(
    "lib/rules/triggers.ts",
    'import { evaluateNumberValue } from "./values";\n',
    'import { evaluateNumberValue } from "./values";\nimport { captureInstructionValues } from "./value-capture";\n',
    "trigger capture import",
)
old_trigger = '''        collected.push({
          owner,
          object: createRuleObject({
            controllerId: owner.id,
            card: source,
            ability,
            kind: "trigger",
            choices,
            sourceId: source.id,
            createdByEventId: event.id,
          }),
        });'''
new_trigger = '''        const object = createRuleObject({
          controllerId: owner.id,
          card: source,
          ability,
          kind: "trigger",
          choices,
          sourceId: source.id,
          createdByEventId: event.id,
        });
        object.valueSnapshots = ability.instructions.reduce<Record<string, number>>((snapshots, instruction) => (
          captureInstructionValues(state, instruction, "event", {
            controllerId: owner.id,
            chosenPlayerId: choices.targetPlayerId,
            choices,
            sourceCardId: source.id,
            sourceBakuganId,
            event: {
              amount: event.amount,
              playerId: event.actorId,
              sourceId: event.card?.id,
              targetId: event.targetBakuganId,
            },
          }, snapshots)
        ), object.valueSnapshots ?? {});
        collected.push({ owner, object });'''
patch("lib/rules/triggers.ts", old_trigger, new_trigger, "trigger event snapshots")

# Game: capture values at the declaration, payment, and per-clause resolution
# boundaries; pass snapshots into costs and persistent modifiers.
patch(
    "lib/game.ts",
    'import { evaluateNumberValue, type NumberValue } from "./rules/values";\n',
    'import { evaluateNumberValue, type EvaluationMoment, type NumberValue } from "./rules/values";\nimport { captureCardPlayValues, captureInstructionValues, captureRuleConditionValues } from "./rules/value-capture";\n',
    "game capture imports",
)
insert_after = '''function choiceValuePresent(choices: CardChoices, id: keyof CardChoices) {
  const value = choices[id];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}
'''
helper = insert_after + '''
function captureCardPlayMoment(state: MatchState, request: PendingCardPlay, moment: EvaluationMoment) {
  const { card } = playSourceCard(state, request);
  const definition = ruleDefinitionForCard(card);
  request.valueSnapshots = captureCardPlayValues(state, definition.play, moment, {
    controllerId: request.controllerId,
    chosenPlayerId: request.choices.targetPlayerId,
    choices: request.choices,
    sourceCardId: card.id,
  }, request.valueSnapshots ?? {});
  return request.valueSnapshots;
}
'''
patch("lib/game.ts", insert_after, helper, "card play capture helper")
patch(
    "lib/game.ts",
    '  const modes = cardPaymentModes(state, request.controllerId, card, choices, { forcedFreeBase: request.forcedFreeBase });',
    '  const modes = cardPaymentModes(state, request.controllerId, card, choices, { forcedFreeBase: request.forcedFreeBase, capturedValues: request.valueSnapshots });',
    "payment mode snapshots",
)
# Only capture the pay boundary after every additional-cost choice exists.
patch(
    "lib/game.ts",
    '    return "staged";\n  }\n  commitCardPlayMutable(state, request);',
    '    return "staged";\n  }\n  captureCardPlayMoment(state, request, "pay");\n  commitCardPlayMutable(state, request);',
    "pay capture boundary",
)
patch(
    "lib/game.ts",
    '    selectedAlternativeId: mode.id === "normal" || mode.id === "forced-free" ? undefined : mode.id,\n  };',
    '    selectedAlternativeId: mode.id === "normal" || mode.id === "forced-free" ? undefined : mode.id,\n    capturedValues: request.valueSnapshots,\n  };',
    "payment commit snapshots",
)
patch(
    "lib/game.ts",
    '    kind: "card",\n  });\n  state.batch.push(batchObject);',
    '    kind: "card",\n  });\n  batchObject.valueSnapshots = structuredClone(request.valueSnapshots ?? {});\n  state.batch.push(batchObject);',
    "play snapshots transfer",
)
# If declaration needed no UI choices, this exact point is the declaration
# boundary. If choices existed, submitCardChoice captures after they are merged.
patch(
    "lib/game.ts",
    '    return "staged";\n  }\n  return stageAdditionalCardPlayCosts(state, request);\n}\n\nfunction finishNestedCardPlayContinuation',
    '    return "staged";\n  }\n  captureCardPlayMoment(state, request, "announce");\n  return stageAdditionalCardPlayCosts(state, request);\n}\n\nfunction finishNestedCardPlayContinuation',
    "choice-free announce capture",
)
patch(
    "lib/game.ts",
    '    request.irreversibleInformation = Boolean(request.irreversibleInformation || pending.irreversibleInformation);\n    state.pendingChoice = undefined;\n    const result = stageAdditionalCardPlayCosts(state, request);',
    '    request.irreversibleInformation = Boolean(request.irreversibleInformation || pending.irreversibleInformation);\n    state.pendingChoice = undefined;\n    if (pending.playStage === "declare") captureCardPlayMoment(state, request, "announce");\n    const result = stageAdditionalCardPlayCosts(state, request);',
    "choice announce capture",
)
# Persistent continuous modifiers retain the resolving choices/snapshots.
patch(
    "lib/game.ts",
    '        createdTurn: state.turn,\n      };\n      rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== modifier.id);',
    '        createdTurn: state.turn,\n        choices: structuredClone(choices),\n        valueSnapshots: isRuleObject(pending) ? structuredClone(pending.valueSnapshots ?? {}) : undefined,\n      };\n      rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== modifier.id);',
    "persistent modifier snapshots",
)
# Stored turn cost modifiers retain their source choices/snapshots too. This
# replacement hits both free and numeric turn-scoped modifier objects.
patch(
    "lib/game.ts",
    '          playerScope: action.playerScope ?? "controller",\n          createdTurn: state.turn,',
    '          playerScope: action.playerScope ?? "controller",\n          choices: structuredClone(choices),\n          valueSnapshots: isRuleObject(pending) ? structuredClone(pending.valueSnapshots ?? {}) : undefined,\n          createdTurn: state.turn,',
    "stored free cost snapshots",
)
# There may be a second object for reduce/increase. Apply if present.
file = ROOT / "lib/game.ts"
text = file.read_text()
needle = '          playerScope: action.playerScope ?? "controller",\n          createdTurn: state.turn,'
if needle in text:
    text = text.replace(needle, '          playerScope: action.playerScope ?? "controller",\n          choices: structuredClone(choices),\n          valueSnapshots: isRuleObject(pending) ? structuredClone(pending.valueSnapshots ?? {}) : undefined,\n          createdTurn: state.turn,', 1)
    file.write_text(text)

# Resolution captures conditions immediately before condition evaluation and
# captures action/choice values only after the clause's resolution choices are
# complete. This avoids freezing choice-dependent expressions too early.
patch(
    "lib/game.ts",
    '      conditionIsActive: (instruction) => ruleConditionIsActive(state, pending, instruction),',
    '''      conditionIsActive: (instruction) => {
        if (isRuleObject(pending)) {
          pending.valueSnapshots = captureRuleConditionValues(state, instruction.condition, "resolve", {
            controllerId: pending.controllerId,
            chosenPlayerId: pending.choices.targetPlayerId,
            choices: pending.choices,
            sourceCardId: pending.sourceId ?? pending.card.id,
            sourceBakuganId: pending.choices.sourceBakuganId,
          }, pending.valueSnapshots ?? {});
        }
        return ruleConditionIsActive(state, pending, instruction);
      },''',
    "resolution condition capture",
)
patch(
    "lib/game.ts",
    '      const existing = pending.resolvedChoices?.[String(instructionIndex)];\n      if (existing) return existing.confirmed === false ? "skip" : "continue";\n      if (!instruction.effects.some(ruleActionIsExecutable)) return "continue";',
    '''      const captureResolvedInstruction = () => {
        if (!isRuleObject(pending)) return;
        const scopedChoices = instructionChoices(pending, instructionIndex);
        pending.valueSnapshots = captureInstructionValues(state, instruction, "resolve", {
          controllerId: pending.controllerId,
          chosenPlayerId: scopedChoices.targetPlayerId,
          choices: scopedChoices,
          sourceCardId: pending.sourceId ?? pending.card.id,
          sourceBakuganId: scopedChoices.sourceBakuganId,
        }, pending.valueSnapshots ?? {});
      };
      const existing = pending.resolvedChoices?.[String(instructionIndex)];
      if (existing) {
        captureResolvedInstruction();
        return existing.confirmed === false ? "skip" : "continue";
      }
      if (!instruction.effects.some(ruleActionIsExecutable)) {
        captureResolvedInstruction();
        return "continue";
      }''',
    "resolved instruction capture helper",
)
patch(
    "lib/game.ts",
    '      schema.fields = schema.fields.filter((field) => !(field.id === "xValue" && pending.choices.xValue != null));\n      if (!schema.fields.length) return "continue";',
    '      schema.fields = schema.fields.filter((field) => !(field.id === "xValue" && pending.choices.xValue != null));\n      if (!schema.fields.length) {\n        captureResolvedInstruction();\n        return "continue";\n      }',
    "no-choice resolve capture",
)

# Public export for authoring/tooling code.
patch(
    "lib/rules/index.ts",
    'export * from "./values";\n',
    'export * from "./values";\nexport * from "./value-capture";\n',
    "value capture export",
)

# Tests: direct traversal and explicit captured card-cost semantics.
test = ROOT / "tests/value-expressions.test.ts"
text = test.read_text()
text = text.replace(
    'import { ruleConditionActive } from "../lib/rules/modifiers";\n',
    'import { ruleConditionActive } from "../lib/rules/modifiers";\nimport { cardCostBreakdown } from "../lib/rules/costs";\nimport { ruleDefinitionForCard } from "../lib/rules/catalogue";\nimport { captureCardPlayValues, captureInstructionValues } from "../lib/rules/value-capture";\n',
    1,
)
text += r'''

test("card-play capture traverses dynamic cost and choice values at announce and pay boundaries", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 2;
  const play = {
    choices: [{
      id: "handCardIds" as const,
      timing: "announce" as const,
      selector: "hand-card" as const,
      label: "Choose cards",
      chooser: "controller" as const,
      maximum: { kind: "captured" as const, key: "announce-max", at: "announce" as const, value: { kind: "count" as const, source: "cards-played" as const, owner: "controller" as const } },
    }],
    costModifiers: [{
      kind: "cost-reduce" as const,
      amount: { kind: "captured" as const, key: "pay-reduction", at: "pay" as const, value: { kind: "count" as const, source: "cards-played" as const, owner: "controller" as const } },
      duration: "instant" as const,
    }],
    evolvesFrom: [],
    sourceZones: ["hand" as const],
  };
  const snapshots = captureCardPlayValues(state, play, "announce", { controllerId: "first", choices: {} });
  assert.equal(snapshots["announce-max"], 2);
  assert.equal(snapshots["pay-reduction"], undefined);
  state.players[0].cardsPlayedThisTurn = 4;
  captureCardPlayValues(state, play, "pay", { controllerId: "first", choices: {} }, snapshots);
  assert.equal(snapshots["pay-reduction"], 4);
});

test("instruction capture waits for its declared timing and traverses boolean comparisons", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 3;
  const instruction = {
    id: "captured-instruction",
    condition: {
      kind: "expression" as const,
      expression: {
        kind: "compare-number" as const,
        left: { kind: "captured" as const, key: "resolve-count", at: "resolve" as const, value: { kind: "count" as const, source: "cards-played" as const, owner: "controller" as const } },
        operator: ">=" as const,
        right: 1,
      },
    },
    effects: [],
    actions: [],
    choices: [],
    sourceText: "If you played cards this turn.",
  };
  const snapshots = captureInstructionValues(state, instruction, "announce", { controllerId: "first", choices: {} });
  assert.equal(snapshots["resolve-count"], undefined);
  captureInstructionValues(state, instruction, "resolve", { controllerId: "first", choices: {} }, snapshots);
  assert.equal(snapshots["resolve-count"], 3);
});

test("card cost evaluation honors a captured payment value instead of recomputing it", () => {
  const state = stateWithPlayers();
  const card = state.players[0].hand.find((candidate) => candidate.cost !== "X") ?? CARDS.find((candidate) => candidate.cost !== "X")!;
  const definition = ruleDefinitionForCard(card);
  const original = [...definition.play.costModifiers];
  try {
    definition.play.costModifiers.push({
      kind: "cost-reduce",
      amount: { kind: "captured", key: "fixed-reduction", at: "pay", value: { kind: "count", source: "cards-played", owner: "controller" } },
      duration: "instant",
    });
    state.players[0].cardsPlayedThisTurn = 1;
    const snapshots = { "fixed-reduction": 1 };
    state.players[0].cardsPlayedThisTurn = 4;
    const withSnapshot = cardCostBreakdown(state, "first", card, {}, { capturedValues: snapshots });
    const live = cardCostBreakdown(state, "first", card, {});
    assert.equal(live.reductions - withSnapshot.reductions, 3);
  } finally {
    definition.play.costModifiers.splice(0, definition.play.costModifiers.length, ...original);
  }
});
'''
test.write_text(text)

print("Value-expression timing capture integration applied.")
