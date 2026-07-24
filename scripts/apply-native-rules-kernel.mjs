import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../lib/game.ts", import.meta.url);
let source = await readFile(path, "utf8");

function exact(before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing migration anchor: ${label}`);
  source = source.replace(before, after);
}

function between(start, end, replacement, label) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Missing migration range: ${label}`);
  source = source.slice(0, first) + replacement + source.slice(last);
}

exact(
  "  buildChoiceSchema,\n",
  "  buildChoiceSchema,\n  buildChoiceSchemaFromSpecs,\n",
  "typed choice import",
);
exact(
  'import { compileCardEffect, type RuleAction, type RuleInstruction } from "./rules/effects";\n',
  'import { compileCardEffect, type RuleAction, type RuleInstruction } from "./rules/effects";\n'
    + 'import { ruleDefinitionForCard } from "./rules/catalogue";\n'
    + 'import { cardCostBreakdown } from "./rules/costs";\n'
    + 'import { canonicalEvoTargetAllowed } from "./rules/identity";\n'
    + 'import { evaluateBakuganCharacteristics, ruleConditionActive } from "./rules/modifiers";\n'
    + 'import { beginRuleObjectResolution, completeRuleObject, copyRuleObject, createRuleObject, negateRuleObject } from "./rules/objects";\n'
    + 'import { registerReplacement } from "./rules/replacements";\n'
    + 'import { ensureRulesState, isRuleObject, normalizeRuleObjects } from "./rules/state";\n'
    + 'import { collectRuleTriggers } from "./rules/triggers";\n',
  "native rules imports",
);
exact(
  "  const state = cloneMatch(input);\n  state.triggerOrders",
  "  const state = cloneMatch(input);\n  ensureRulesState(state);\n  normalizeRuleObjects(state);\n  state.triggerOrders",
  "snapshot rules normalization",
);

between(
  "export const cardChoiceSpec =",
  "const queueTrigger =",
  `export const cardChoiceSpec = (state: MatchState, playerId: string, card: GameCard) => {
  const mapping: Record<string, string> = {
    bakugan: "targetBakugan", player: "targetPlayer", hero: "targetHero", evo: "targetEvo",
    energy: "targetEnergy", core: "core", "hand-cards": "multiHand", "deck-card": "deckCard",
    number: "xValue", mode: "mode", confirm: "mode", "batch-object": "batchObject",
  };
  const definition = ruleDefinitionForCard(card);
  const schemas = (["announce", "pay"] as const).map((timing) => (
    buildChoiceSchemaFromSpecs(state, playerId, card, definition.play.choices, timing)
  ));
  return [...new Set(schemas.flatMap((schema) => schema.fields).map((item) => (
    item.id === "discardCardIds" ? "discard" : mapping[item.kind]
  )))];
};

`,
  "card choice specification",
);

between(
  "const queueTrigger =",
  "const stageSimultaneousTriggers =",
  "const stageSimultaneousTriggers =",
  "remove legacy direct trigger queue",
);

between(
  "const triggerMatchesEvent =",
  "export const emitGameEvent =",
  `/** Collect typed triggered abilities for one authoritative game event. */
export const collectTriggersForEvent = (state: MatchState, event: GameEvent) => {
  if (state.collectedEventKeys.includes(event.id)) return [];
  state.collectedEventKeys.push(event.id);
  const names = {
    select: "BAKUGAN_SELECTED", open: "BAKUGAN_OPENED", discard: "CARD_DISCARDED",
    "card-play": "CARD_PLAYED", victor: "VICTOR_DECLARED", attack: "ATTACK_CREATED",
    "damage-taken": "DAMAGE_TAKEN", "hand-empty": "HAND_EMPTIED", "end-turn": "TURN_ENDED",
  } as const;
  return collectRuleTriggers(state, {
    id: event.id,
    name: names[event.type],
    actorId: event.playerId === "*" ? state.startingPlayer : event.playerId,
    controllerId: event.playerId === "*" ? undefined : event.playerId,
    card: event.sourceCards?.[0],
    cardType: event.cardType,
    targetBakuganId: event.targetBakuganId,
    amount: event.type === "attack" ? state.pendingDamage : undefined,
    createdAt: Date.now(),
  }) as PendingEffect[];
};

`,
  "declarative trigger collection",
);

between(
  "const effectiveCost =",
  "const payEnergy =",
  `const effectiveCost = (state: MatchState, player: PlayerState, card: GameCard, choices: CardChoices) => (
  cardCostBreakdown(state, player.id, card, choices).total
);

`,
  "unified cost calculation",
);

exact(
  `  // Targets, modes, optional clauses and opponent decisions are chosen only
  // when the relevant instruction resolves. X is a payment parameter and is
  // therefore the sole choice made before the card enters the batch.
  const paymentCard = card.cost === "X" ? { ...card, type: "Action" as const } : card;
  const schema = buildChoiceSchema(state, playerId, paymentCard, card.cost === "X" ? "Choose a value for X." : "");
`,
  `  const definition = ruleDefinitionForCard(card);
  const announce = buildChoiceSchemaFromSpecs(state, playerId, card, definition.play.choices, "announce");
  const payment = buildChoiceSchemaFromSpecs(state, playerId, card, definition.play.choices, "pay");
  const schema = { ...announce, fields: [...announce.fields, ...payment.fields] };
`,
  "announcement and payment choices",
);

exact(
  `  const split = splitWhenPlayedEffect(card.effect);
  const batchObject: PendingEffect = { id: uid(), controllerId: playerId, card, effect: split.cardEffect, choices, kind: "card" };
  state.batch.push(batchObject); state.passes = [];
  if (split.triggerEffect) queueTrigger(state, playerId, card, split.triggerEffect, choices);
  if (card.type === "Action") {
    const toshi = player.heroes.find((hero) => hero.name === "Toshi");
    if (toshi && player.cardsPlayedThisTurn === 1) state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:\`${card.id}-toshi-copy\` }, choices, kind:"copy" });
    if ((state.copyNextAction[playerId] ?? 0) > 0) { state.copyNextAction[playerId] -= 1; state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:\`${card.id}-next-copy\` }, choices, kind:"copy" }); }
  }
`,
  `  const definition = ruleDefinitionForCard(card);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered") ?? definition.abilities[0];
  const batchObject = createRuleObject({ controllerId: playerId, card, ability, choices, kind: "card" });
  state.batch.push(batchObject); state.passes = [];
  if (card.type === "Action") {
    const toshi = player.heroes.find((hero) => hero.name === "Toshi");
    if (toshi && player.cardsPlayedThisTurn === 1) state.batch.push(copyRuleObject(batchObject, playerId));
    if ((state.copyNextAction[playerId] ?? 0) > 0) {
      state.copyNextAction[playerId] -= 1;
      state.batch.push(copyRuleObject(batchObject, playerId));
    }
  }
`,
  "native rule-object card play",
);

between(
  "const ruleConditionIsActive =",
  "const executeRuleAction =",
  `const ruleConditionIsActive = (
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
) => {
  const player = playerById(state, pending.controllerId);
  const choices = instructionChoices(pending, pending.instructionIndex ?? 0);
  if (instruction.condition.kind === "selection-made") return Boolean(choices[instruction.condition.choiceId]);
  if (instruction.condition.kind === "printed") return conditionActive(state, player, instruction.condition.text, choices);
  if (instruction.condition.kind === "faction") {
    return chooseBakugan(state, pending.controllerId, choices)?.faction === instruction.condition.faction;
  }
  return ruleConditionActive(state, player, instruction.condition);
};

`,
  "typed condition evaluation",
);

exact(
  `    case "choice":
    case "trigger":
    case "continuous":
    case "cost":
      return;
`,
  `    case "choice":
    case "trigger":
    case "cost":
      return;
    case "continuous": {
      const rules = ensureRulesState(state);
      const modifier = {
        ...structuredClone(action.modifier),
        id: \`${pending.id}:${action.modifier.id}\`,
        controllerId,
        source: pending.sourceId
          ? { kind: "card" as const, instanceId: pending.sourceId, catalogId: pending.card.catalogId as \`bb-\${number}\` }
          : action.modifier.source,
        createdTurn: state.turn,
      };
      rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== modifier.id);
      rules.modifiers.push(modifier);
      return;
    }
    case "replacement":
    case "prevention":
      registerReplacement(state, {
        id: \`${pending.id}:${instructionIndex}:${action.kind}\`,
        source: pending.sourceId
          ? { kind: "card", instanceId: pending.sourceId, catalogId: pending.card.catalogId as \`bb-\${number}\` }
          : { kind: "card", instanceId: pending.card.id, catalogId: pending.card.catalogId as \`bb-\${number}\` },
        controllerId,
        effect: action,
      });
      return;
`,
  "continuous and replacement execution",
);

between(
  "    case \"negate\": {",
  "    case \"search\": {",
  `    case "negate": {
      const selectedId = typeof choices.mode === "string" ? choices.mode : undefined;
      const index = state.batch.findIndex((effect) => (
        effect.id !== pending.id
        && (!selectedId || effect.id === selectedId)
        && (action.cardType === "any" || effect.card.type === action.cardType)
      ));
      if (index >= 0) {
        const [negated] = state.batch.splice(index, 1);
        if (isRuleObject(negated)) negateRuleObject(negated);
        if (negated.kind === "card" && ["Action", "Flip"].includes(negated.card.type)) {
          const owner = playerById(state, negated.controllerId);
          if (!owner.discard.some((candidate) => candidate.id === negated.card.id)) owner.discard.push(negated.card);
        }
        if (action.copy) {
          const typed = isRuleObject(negated) ? negated : normalizeRuleObjects({ ...state, batch: [negated] }).batch[0];
          if (isRuleObject(typed)) state.batch.push(copyRuleObject(typed, controllerId));
        }
      }
      return;
    }
`,
  "exact batch-object negation",
);

exact(
  `  } else if (pending.kind === "card" && pending.card.type === "Evo") {
    const target = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId);
    const normalizedName = (value: string | null | undefined) => String(value ?? "")
      .replace(/\\s*\\(Battle Brawlers\\)\\s*$/i, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
    if (target
      && normalizedName(target.name) === normalizedName(pending.card.evolvesFrom)
      && target.faction === pending.card.faction) {
`,
  `  } else if (pending.kind === "card" && pending.card.type === "Evo") {
    const target = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId);
    if (target && canonicalEvoTargetAllowed(ruleDefinitionForCard(pending.card), target)) {
`,
  "canonical Evo resolution",
);

between(
  "const staticModifier =",
  "export const totalPower =",
  `const staticModifier = (state: MatchState, bakugan: Bakugan, owner: PlayerState) => {
  const evaluated = evaluateBakuganCharacteristics(state, bakugan, owner);
  return {
    power: evaluated.power,
    damage: evaluated.damage,
    frost: evaluated.frostStrike,
    double: evaluated.doubleStrike,
    shadow: evaluated.shadowStrike,
  };
};

`,
  "layered characteristic evaluation",
);

exact(
  "function resolvePendingEffect(state: MatchState, pending: PendingEffect) {\n  const program = compileCardEffect",
  "function resolvePendingEffect(state: MatchState, pending: PendingEffect) {\n  if (isRuleObject(pending)) beginRuleObjectResolution(pending);\n  const program = compileCardEffect",
  "rule object resolution start",
);
exact(
  "  entry(state, \"game\", `${pending.card.name} finished resolving its structured RuleAction program.`);\n  return true;\n}",
  "  if (isRuleObject(pending)) completeRuleObject(pending);\n  entry(state, \"game\", `${pending.card.name} finished resolving its typed rule program.`);\n  return true;\n}",
  "rule object resolution completion",
);

exact(
  `    state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {}; state.doubleStrike = {}; state.shadowStrike = {};
`,
  `    state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {}; state.doubleStrike = {}; state.shadowStrike = {};
    const rules = ensureRulesState(state);
    rules.modifiers = rules.modifiers.filter((modifier) => modifier.duration !== "turn");
    rules.replacements = rules.replacements.filter((replacement) => replacement.effect.kind !== "prevention");
    rules.triggerUsage = {};
`,
  "turn-duration rules reset",
);

await writeFile(path, source);
console.log("Applied native typed-rules kernel migration to lib/game.ts");
