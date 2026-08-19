from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def edit(path, replacements):
    p = ROOT / path
    text = p.read_text()
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"{path} {label}: expected one match, found {count}")
        text = text.replace(old, new, 1)
    p.write_text(text)


edit("lib/rules/costs.ts", [
    (
        '    reasons.push(`${breakdown.total} Energy is still required after modifiers, but only ${payable} is available.`);',
        '    reasons.push(`Not enough Energy: ${breakdown.total} required after modifiers, ${payable} available.`);',
        "preserve public insufficient-Energy wording",
    ),
])

edit("lib/rules/catalogue-primitives.ts", [
    (
'''  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay) actions.push({''',
'''  const persistentFreePermission = /for the rest of the turn,\\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission) actions.push({''',
        "do not compile persistent free permission as immediate play",
    ),
    (
'''  if (/for the rest of the turn,\\s*both players may play Evo cards from their hand for free/i.test(text)) actions.push({''',
'''  if (persistentFreePermission) actions.push({''',
        "reuse persistent permission predicate",
    ),
])

edit("lib/rules/catalogue-structure.ts", [
    (
'''    if (ruleCardId(card) === "bb-152") effects = effects.filter((effect) => effect.kind !== "discard");
''',
'''    // Alternative play costs are represented in CardPlayDefinition rather than
    // erased or recognized by a printing-specific exception here.
''',
        "remove Pact card-id exception",
    ),
    (
'''  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay) {''',
'''  const persistentFreePermission = /for the rest of the turn,\\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission) {''',
        "do not request an immediate card for persistent permissions",
    ),
    (
'''  if (!discardForFree && /play this for free|this is free/i.test(text)) {
    result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });
  }''',
'''  const optionalSelfFree = !discardForFree && /you may play this(?: card)? for free/i.test(text);
  if (optionalSelfFree) {
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(card)}:self-free`,
      label: "Play for free",
      setsBaseFree: true,
      components: [],
      condition: conditionFor(text),
    });
  } else if (!discardForFree && /play this for free|this is free/i.test(text)) {
    result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });
  }''',
        "model optional self-free as a payment route",
    ),
])

edit("lib/game.ts", [
    (
'''        if (candidate) childChoices.sourceBakuganId = candidate.id;''',
'''        if (candidate) {
          // The generic Evo declaration uses targetBakuganId while some
          // effect-originated plays historically carried sourceBakuganId.
          // Populate both aliases so the nested play does not reopen a target
          // choice that the parent effect has already determined.
          childChoices.sourceBakuganId = candidate.id;
          childChoices.targetBakuganId = candidate.id;
        }''',
        "carry resolved Evo target into nested declaration",
    ),
])

# Expand the focused regression suite.
p = ROOT / "tests/card-play-pipeline.test.ts"
text = p.read_text()
text = text.replace(
'import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";',
'import { CARD_BY_ID, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";',
)
text = text.replace(
'import { createMatch, passPriority, submitCardChoice } from "../lib/game";',
'import { createMatch, passPriority, resolveStructuredEffect, submitCardChoice } from "../lib/game";',
)
text = text.replace(
'import { cardCostBreakdown } from "../lib/rules/costs";',
'import { cardCostBreakdown, cardPaymentModes } from "../lib/rules/costs";',
)
text = text.replace(
'import { ruleDefinitionForCard } from "../lib/rules/catalogue";',
'import { ruleDefinitionForCard } from "../lib/rules/catalogue";\nimport { compileCardEffect } from "../lib/rules/effects";\nimport type { RuleAction } from "../lib/rules/model";',
)
old = '''test("conditional self-free Evos use the normal cost calculation", () => {
  const { state, first } = baseMatch("SELF_FREE");
  const fangzor = card("br-102", "fangzor-free");
  first.hand = [fangzor];
  first.discard = Array.from({ length: 20 }, (_, index) => card("bb-1", `discard-${index}`));
  const breakdown = cardCostBreakdown(state, first.id, fangzor);
  assert.equal(breakdown.freeBase, true);
  assert.equal(breakdown.total, 0);
});'''
new = '''test("conditional self-free cards expose normal and free payment routes", () => {
  const { state, first } = baseMatch("SELF_FREE");
  const fangzor = card("br-102", "fangzor-free");
  first.hand = [fangzor];
  first.discard = Array.from({ length: 20 }, (_, index) => card("bb-1", `discard-${index}`));
  const modes = cardPaymentModes(state, first.id, fangzor);
  const normal = modes.find((mode) => mode.id === "normal");
  const free = modes.find((mode) => mode.id === "br-102:self-free");
  assert.ok(normal && free);
  assert.equal(normal.freeBase, false);
  assert.equal(free.freeBase, true);
  assert.equal(free.energyCost, 0);
  const selected = cardCostBreakdown(state, first.id, fangzor, { paymentMode: free.id }, { selectedAlternativeId: free.id });
  assert.equal(selected.freeBase, true);
  assert.equal(selected.total, 0);
});'''
if old not in text:
    raise RuntimeError("conditional self-free test not found")
text = text.replace(old, new, 1)

text += r'''

function containsFreePlayPrimitive(actions: RuleAction[]): boolean {
  return actions.some((action) => {
    if (action.kind === "play") return action.free;
    if (action.kind === "cost") return action.operation === "free";
    if (action.kind === "sequence") return containsFreePlayPrimitive(action.effects);
    if (action.kind === "conditional") return containsFreePlayPrimitive(action.whenTrue) || containsFreePlayPrimitive(action.whenFalse ?? []);
    if (action.kind === "replacement") return containsFreePlayPrimitive(action.replaceWith);
    return false;
  });
}

test("every printed free-play card maps to the shared play or payment primitives", () => {
  const printed = CARDS.filter((candidate) => /for free|this is free/i.test(candidate.effect));
  assert.ok(printed.length > 0);
  for (const candidate of printed) {
    const definition = ruleDefinitionForCard(candidate);
    const paymentPrimitive = definition.play.costModifiers.some((modifier) => (
      modifier.kind === "cost-free" || modifier.kind === "cost-alternative"
    ));
    const programPrimitive = compileCardEffect(candidate).instructions.some((instruction) => containsFreePlayPrimitive(instruction.effects));
    assert.ok(paymentPrimitive || programPrimitive, `${candidate.catalogId} ${candidate.name} is missing a generalized free-play primitive`);
  }
});

test("Luck Aura's free play becomes a normal typed card play without paying the printed base cost", () => {
  const { state, first } = baseMatch("LUCK_AURA");
  const luck = card("bb-163", "luck-aura-effect");
  const playableTemplate = CARDS.find((candidate) => (
    candidate.type === "Action"
    && candidate.cost !== "X"
    && candidate.cost > 0
    && ruleDefinitionForCard(candidate).play.choices.every((choice) => !["announce", "pay"].includes(choice.timing))
    && !/must Reroll/i.test(candidate.effect)
  ));
  assert.ok(playableTemplate);
  const played = { ...structuredClone(playableTemplate), id: "luck-aura-free-card" };
  first.hand = [played];
  first.energy = 0;
  first.energyZone = [];
  first.maxEnergy = 0;
  const definition = ruleDefinitionForCard(luck);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);

  let next = resolveStructuredEffect(state, createRuleObject({ controllerId: first.id, card: luck, ability, kind: "card" }));
  const hand = next.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds");
  assert.ok(hand?.options.some((option) => option.id === played.id));
  next = submitCardChoice(next, first.id, { handCardIds: [played.id], confirmed: true });
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === played.id), false);
  const object = next.batch.find((candidate) => candidate.card.id === played.id);
  assert.ok(object);
  assert.equal(object.rulesObjectVersion, 3);
  assert.equal(object.controllerId, first.id);
  assert.equal(next.players[0].cardsPlayedThisTurn, 1);
  assert.ok(next.log.some((entry) => entry.cardInstanceId === played.id && entry.cardEvent === "played"));
});

test("free-play compiler preserves Mind Control source and physical destination ownership", () => {
  const mind = card("br-19", "mind-control-model");
  const actions = compileCardEffect(mind).instructions.flatMap((instruction) => instruction.effects);
  const play = actions.find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.free, true);
  assert.equal(play.source, "hand");
  assert.equal(play.sourceOwner, "opponent");
  assert.equal(play.destinationOwner, "opponent");
});

test("Trick Trap's shared free-play selector retains Hero type and printed-cost ceiling", () => {
  const trick = card("br-70", "trick-trap-model");
  const actions = compileCardEffect(trick).instructions.flatMap((instruction) => instruction.effects);
  const play = actions.find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.cardType, "Hero");
  assert.equal(play.maximumCost, 3);
});
'''
p.write_text(text)
print("Focused unified card-play fixes applied.")
